import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma: any = new PrismaClient();

export interface SocketUser {
    id: number;
    email: string;
    tenantId: string;
    name: string;
    role?: string;
}

export interface AuthenticatedSocket extends Socket {
    data: {
        user: SocketUser;
    };
}

// Track online users per tenant: tenantId -> Map<userId, socketCount>
const onlineUsers = new Map<string, Map<number, number>>();

let ioInstance: SocketIOServer | null = null;

export const getIO = (): SocketIOServer => {
    if (!ioInstance) {
        throw new Error('Socket.IO has not been initialized');
    }
    return ioInstance;
};

export const initSocket = (httpServer: HttpServer) => {
    const io = new SocketIOServer(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST', 'PATCH', 'DELETE'],
            credentials: true,
        },
        pingTimeout: 30000,
        pingInterval: 10000,
    });

    ioInstance = io;

    // Authentication middleware
    io.use(async (rawSocket: Socket, next) => {
        const socket = rawSocket as AuthenticatedSocket;
        try {
            const token =
                socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
                socket.handshake.query?.token;

            if (!token || typeof token !== 'string') {
                return next(new Error('Authentication error: Token required'));
            }

            const decoded = jwt.verify(
                token,
                process.env.JWT_SECRET || 'secret'
            ) as any;

            if (!decoded || !decoded.id || !decoded.tenantId) {
                return next(new Error('Authentication error: Invalid payload'));
            }

            // Fetch user basic info
            const user = await prisma.user.findUnique({
                where: { id: decoded.id },
                select: { id: true, email: true, name: true, tenantId: true, isActive: true }
            });

            if (!user || !user.isActive) {
                return next(new Error('Authentication error: User inactive or not found'));
            }

            socket.data.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                tenantId: user.tenantId,
                role: decoded.role,
            };

            next();
        } catch (err: any) {
            return next(new Error(`Authentication failed: ${err.message}`));
        }
    });

    io.on('connection', (rawSocket: Socket) => {
        const socket = rawSocket as AuthenticatedSocket;
        const user = socket.data.user;
        if (!user) {
            socket.disconnect(true);
            return;
        }

        const tenantId = user.tenantId;
        const userId = user.id;

        // Join tenant room and personal user room
        socket.join(`tenant_${tenantId}`);
        socket.join(`user_${userId}`);

        // Update online presence
        if (!onlineUsers.has(tenantId)) {
            onlineUsers.set(tenantId, new Map());
        }
        const tenantMap = onlineUsers.get(tenantId)!;
        const currentCount = tenantMap.get(userId) || 0;
        tenantMap.set(userId, currentCount + 1);

        // Notify tenant members if newly online
        if (currentCount === 0) {
            socket.to(`tenant_${tenantId}`).emit('user_status_changed', {
                userId,
                status: 'ONLINE',
            });
        }

        // Return current list of online users in this tenant to the connected client
        socket.emit('online_users_list', Array.from(tenantMap.keys()));

        // Allow client to fetch current online users at any time (e.g. ChatHub mount, page navigation)
        socket.on('get_online_users', () => {
            const currentTenantMap = onlineUsers.get(tenantId);
            socket.emit('online_users_list', currentTenantMap ? Array.from(currentTenantMap.keys()) : []);
        });

        // --- Room Join / Leave ---
        socket.on('join_channel', (channelId: number) => {
            socket.join(`channel_${channelId}`);
        });

        socket.on('leave_channel', (channelId: number) => {
            socket.leave(`channel_${channelId}`);
        });

        socket.on('join_conversation', (conversationId: number) => {
            socket.join(`conv_${conversationId}`);
        });

        socket.on('leave_conversation', (conversationId: number) => {
            socket.leave(`conv_${conversationId}`);
        });

        // --- Typing Indicators ---
        socket.on('typing_start', (data: { targetType: 'channel' | 'conversation'; targetId: number }) => {
            const room = data.targetType === 'channel' ? `channel_${data.targetId}` : `conv_${data.targetId}`;
            socket.to(room).emit('user_typing', {
                userId: user.id,
                name: user.name,
                targetType: data.targetType,
                targetId: data.targetId,
            });
        });

        socket.on('typing_stop', (data: { targetType: 'channel' | 'conversation'; targetId: number }) => {
            const room = data.targetType === 'channel' ? `channel_${data.targetId}` : `conv_${data.targetId}`;
            socket.to(room).emit('user_stop_typing', {
                userId: user.id,
                targetType: data.targetType,
                targetId: data.targetId,
            });
        });

        // --- Read Receipts ---
        socket.on('mark_read', async (data: { messageId?: number; conversationId?: number; channelId?: number }) => {
            try {
                if (data && data.conversationId) {
                    const convId: number = data.conversationId;
                    await prisma.directConversationMember.updateMany({
                        where: { conversationId: convId, userId: user.id },
                        data: { lastReadAt: new Date() }
                    });
                    socket.to(`conv_${convId}`).emit('conversation_read', {
                        conversationId: convId,
                        userId: user.id,
                        readAt: new Date()
                    });
                }
            } catch (err) {
                console.error('[Socket mark_read error]', err);
            }
        });

        // --- WebRTC 1:1 Voice & Video Calling Signaling ---
        socket.on('call_user', async (data: {
            receiverId: number;
            callType: 'VOICE' | 'VIDEO';
            callerName?: string;
            callerAvatar?: string | null;
        }) => {
            try {
                // Check granular permission for caller
                const callerRole = String(user.role || '').toUpperCase();
                if (callerRole !== 'SUPER_ADMIN') {
                    const dbCaller = await prisma.user.findUnique({
                        where: { id: user.id },
                        select: { role: { select: { permissions: { select: { code: true } } } } }
                    });
                    const hasCallPerm = dbCaller?.role?.permissions.some(p => p.code === 'CHAT_CALL');
                    if (!hasCallPerm) {
                        socket.emit('call_failed', { reason: 'You do not have permission to initiate calls (CHAT_CALL required).' });
                        return;
                    }
                }

                // Ensure receiver belongs to same tenant
                const receiver = await prisma.user.findFirst({
                    where: { id: data.receiverId, tenantId: user.tenantId, isActive: true },
                    include: { employeeProfile: { select: { avatar: true } } }
                });

                if (!receiver) {
                    socket.emit('call_failed', { reason: 'User not found or offline' });
                    return;
                }

                // Create CallRecord in DB
                const callRecord = await prisma.callRecord.create({
                    data: {
                        tenantId: user.tenantId,
                        callerId: user.id,
                        callType: data.callType,
                        status: 'INITIATED',
                        participants: {
                            create: {
                                userId: receiver.id,
                                status: 'JOINED'
                            }
                        }
                    }
                });

                // Forward incoming call event to receiver's private room
                io.to(`user_${receiver.id}`).emit('incoming_call', {
                    callId: callRecord.id,
                    callerId: user.id,
                    callerName: user.name,
                    callerAvatar: data.callerAvatar || null,
                    callType: data.callType,
                });

                // Join caller to call room
                socket.join(`call_room_${callRecord.id}`);

                // Acknowledge to caller that ringing started
                socket.emit('call_ringing', { callId: callRecord.id });
            } catch (err) {
                console.error('[Socket call_user error]', err);
                socket.emit('call_failed', { reason: 'Could not initiate call' });
            }
        });

        // Group Call initiation to multiple members
        socket.on('group_call_user', async (data: { groupTitle: string; participantIds: number[]; callType: 'VOICE' | 'VIDEO'; callerAvatar?: string; conversationId?: number }) => {
            try {
                // Check granular permission for caller
                const callerRole = String(user.role || '').toUpperCase();
                if (callerRole !== 'SUPER_ADMIN') {
                    const dbCaller = await prisma.user.findUnique({
                        where: { id: user.id },
                        select: { role: { select: { permissions: { select: { code: true } } } } }
                    });
                    const hasCallPerm = dbCaller?.role?.permissions.some(p => p.code === 'CHAT_CALL');
                    if (!hasCallPerm) {
                        socket.emit('call_failed', { reason: 'You do not have permission to initiate calls (CHAT_CALL required).' });
                        return;
                    }
                }

                const callRecord = await prisma.callRecord.create({
                    data: {
                        tenantId: user.tenantId,
                        callerId: user.id,
                        callType: data.callType,
                        status: 'INITIATED',
                        participants: {
                            create: (data.participantIds || []).filter(id => id !== user.id).map(receiverId => ({
                                userId: receiverId,
                                status: 'JOINED'
                            }))
                        }
                    }
                });

                // Join host to call room
                socket.join(`call_room_${callRecord.id}`);

                (data.participantIds || []).forEach(receiverId => {
                    if (receiverId !== user.id) {
                        io.to(`user_${receiverId}`).emit('incoming_call', {
                            callId: callRecord.id,
                            callerId: user.id,
                            callerName: `${user.name} (${data.groupTitle || 'Group'})`,
                            callerAvatar: data.callerAvatar || null,
                            callType: data.callType,
                            isGroup: true,
                            conversationId: data.conversationId,
                        });
                    }
                });

                socket.emit('call_ringing', { callId: callRecord.id });
            } catch (err) {
                console.error('[Socket group_call_user error]', err);
                socket.emit('call_failed', { reason: 'Could not initiate group call' });
            }
        });

        // Invite additional user into active call
        socket.on('invite_to_call', (data: { callId?: number; targetUserId: number; callType?: 'VOICE' | 'VIDEO'; callerAvatar?: string; callTitle?: string }) => {
            io.to(`user_${data.targetUserId}`).emit('incoming_call', {
                callId: data.callId || 0,
                callerId: user.id,
                callerName: data.callTitle ? `${user.name} (${data.callTitle})` : user.name,
                callerAvatar: data.callerAvatar || null,
                callType: data.callType || 'VIDEO',
                isGroup: true,
            });
        });

        // In-call chat messages
        socket.on('call_chat_message', (data: { targetUserIds?: number[]; text: string; senderName?: string; senderAvatar?: string }) => {
            const payload = {
                id: 'incall_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                senderId: user.id,
                senderName: data.senderName || user.name,
                senderAvatar: data.senderAvatar || null,
                text: data.text,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
            if (data.targetUserIds && Array.isArray(data.targetUserIds)) {
                data.targetUserIds.forEach(targetId => {
                    if (targetId !== user.id) {
                        io.to(`user_${targetId}`).emit('call_chat_message', payload);
                    }
                });
            }
            socket.emit('call_chat_message', payload);
        });

        socket.on('accept_call', async (data: { callId: number; callerId: number; isGroup?: boolean }) => {
            try {
                socket.join(`call_room_${data.callId}`);

                await prisma.callRecord.update({
                    where: { id: data.callId },
                    data: { status: 'CONNECTED', startedAt: new Date() }
                }).catch(() => {});

                await prisma.callRecordParticipant.updateMany({
                    where: { callId: data.callId, userId: user.id },
                    data: { status: 'JOINED' }
                }).catch(() => {});

                // Notify call room that this participant joined
                io.to(`call_room_${data.callId}`).emit('participant_joined', {
                    callId: data.callId,
                    userId: user.id,
                    userName: user.name,
                    userAvatar: (user as any).avatar || null,
                });

                // Also emit call_accepted to caller (backward compatibility & 1:1)
                io.to(`user_${data.callerId}`).emit('call_accepted', {
                    callId: data.callId,
                    receiverId: user.id,
                    receiverName: user.name,
                });
            } catch (err) {
                console.error('[Socket accept_call error]', err);
            }
        });

        socket.on('reject_call', async (data: { callId: number; callerId: number; reason?: string; isGroup?: boolean }) => {
            try {
                if (data.isGroup) {
                    await prisma.callRecordParticipant.updateMany({
                        where: { callId: data.callId, userId: user.id },
                        data: { status: 'REJECTED' }
                    }).catch(() => {});

                    // Only notify the host/caller that this user declined without dropping the call
                    io.to(`user_${data.callerId}`).emit('participant_declined', {
                        callId: data.callId,
                        userId: user.id,
                        userName: user.name,
                        reason: data.reason || 'User busy',
                    });
                    return;
                }

                await prisma.callRecord.update({
                    where: { id: data.callId },
                    data: { status: 'REJECTED', endedAt: new Date() }
                }).catch(() => {});

                io.to(`user_${data.callerId}`).emit('call_rejected', {
                    callId: data.callId,
                    reason: data.reason || 'User busy',
                });
            } catch (err) {
                console.error('[Socket reject_call error]', err);
            }
        });

        socket.on('cancel_call', async (data: { callId: number; receiverId: number }) => {
            try {
                await prisma.callRecord.update({
                    where: { id: data.callId },
                    data: { status: 'MISSED', endedAt: new Date() }
                }).catch(() => {});

                io.to(`user_${data.receiverId}`).emit('call_cancelled', {
                    callId: data.callId,
                });
            } catch (err) {
                console.error('[Socket cancel_call error]', err);
            }
        });

        // WhatsApp-style leave group call: only this user leaves
        socket.on('leave_group_call', async (data: { callId: number }) => {
            try {
                socket.leave(`call_room_${data.callId}`);

                await prisma.callRecordParticipant.updateMany({
                    where: { callId: data.callId, userId: user.id },
                    data: { status: 'LEFT' }
                }).catch(() => {});

                // Notify all remaining members in the room
                socket.to(`call_room_${data.callId}`).emit('participant_left', {
                    callId: data.callId,
                    userId: user.id,
                    userName: user.name,
                });

                // Check remaining active sockets in this room
                const roomSockets = await io.in(`call_room_${data.callId}`).fetchSockets();
                if (roomSockets.length <= 1) {
                    await prisma.callRecord.update({
                        where: { id: data.callId },
                        data: { status: 'COMPLETED', endedAt: new Date() }
                    }).catch(() => {});
                }
            } catch (err) {
                console.error('[Socket leave_group_call error]', err);
            }
        });

        socket.on('end_call', async (data: { callId: number; targetUserId?: number; duration?: number; isGroup?: boolean }) => {
            try {
                const duration = data.duration || 0;
                await prisma.callRecord.update({
                    where: { id: data.callId },
                    data: {
                        status: 'COMPLETED',
                        endedAt: new Date(),
                        duration
                    }
                }).catch(() => {});

                if (data.isGroup) {
                    // Host ended call for everyone in room
                    io.to(`call_room_${data.callId}`).emit('call_ended', {
                        callId: data.callId,
                        duration
                    });
                } else if (data.targetUserId) {
                    io.to(`user_${data.targetUserId}`).emit('call_ended', {
                        callId: data.callId,
                        duration
                    });
                }
            } catch (err) {
                console.error('[Socket end_call error]', err);
            }
        });

        // WebRTC Signaling Passthrough
        socket.on('webrtc_offer', (data: { targetUserId: number; offer: any; callId?: number }) => {
            io.to(`user_${data.targetUserId}`).emit('webrtc_offer', {
                senderId: user.id,
                offer: data.offer,
                callId: data.callId,
            });
        });

        socket.on('webrtc_answer', (data: { targetUserId: number; answer: any; callId?: number }) => {
            io.to(`user_${data.targetUserId}`).emit('webrtc_answer', {
                senderId: user.id,
                answer: data.answer,
                callId: data.callId,
            });
        });

        socket.on('webrtc_ice_candidate', (data: { targetUserId: number; candidate: any }) => {
            io.to(`user_${data.targetUserId}`).emit('webrtc_ice_candidate', {
                senderId: user.id,
                candidate: data.candidate,
            });
        });

        // Screen share toggle notification
        socket.on('screen_share_status', (data: { callId?: number; targetUserId?: number; isSharing: boolean }) => {
            if (data.callId) {
                socket.to(`call_room_${data.callId}`).emit('screen_share_status', {
                    callId: data.callId,
                    senderId: user.id,
                    isSharing: data.isSharing,
                });
            } else if (data.targetUserId) {
                io.to(`user_${data.targetUserId}`).emit('screen_share_status', {
                    senderId: user.id,
                    isSharing: data.isSharing,
                });
            }
        });

        // Rejoin active group call (Google Meet style)
        socket.on('rejoin_group_call', async (data: { callId: number }) => {
            try {
                const call = await prisma.callRecord.findUnique({
                    where: { id: data.callId }
                });

                if (!call || call.status === 'COMPLETED' || call.status === 'REJECTED' || call.status === 'MISSED') {
                    socket.emit('call_failed', { reason: 'This call has already ended' });
                    return;
                }

                // Join socket back to call room
                socket.join(`call_room_${data.callId}`);

                await prisma.callRecordParticipant.upsert({
                    where: {
                        callId_userId: {
                            callId: data.callId,
                            userId: user.id
                        }
                    },
                    update: { status: 'JOINED' },
                    create: {
                        callId: data.callId,
                        userId: user.id,
                        status: 'JOINED'
                    }
                }).catch(() => {});

                // Notify room members that user rejoined
                io.to(`call_room_${data.callId}`).emit('participant_joined', {
                    callId: data.callId,
                    userId: user.id,
                    userName: user.name,
                    userAvatar: (user as any).avatar || null,
                });

                socket.emit('rejoin_success', {
                    callId: data.callId,
                    callType: call.callType,
                });
            } catch (err) {
                console.error('[Socket rejoin_group_call error]', err);
                socket.emit('call_failed', { reason: 'Could not rejoin call' });
            }
        });

        // Hand raise toggle (Google Meet style)
        socket.on('call_hand_raise', (data: { callId?: number; targetUserId?: number; isRaised: boolean }) => {
            const payload = {
                callId: data.callId,
                userId: user.id,
                userName: user.name,
                isRaised: data.isRaised,
            };
            if (data.callId) {
                io.to(`call_room_${data.callId}`).emit('call_hand_raise', payload);
            } else if (data.targetUserId) {
                io.to(`user_${data.targetUserId}`).emit('call_hand_raise', payload);
                socket.emit('call_hand_raise', payload);
            }
        });

        // Disconnect
        socket.on('disconnect', () => {
            const tenantMap = onlineUsers.get(tenantId);
            if (tenantMap) {
                const count = (tenantMap.get(userId) || 1) - 1;
                if (count <= 0) {
                    tenantMap.delete(userId);
                    io.to(`tenant_${tenantId}`).emit('user_status_changed', {
                        userId,
                        status: 'OFFLINE',
                    });
                } else {
                    tenantMap.set(userId, count);
                }
            }
        });
    });

    return io;
};
