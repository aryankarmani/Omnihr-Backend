import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { getIO } from '../socket/socketHandler';

const prisma: any = new PrismaClient();

// Helper to sanitize employee/user info
const userSelect = {
    id: true,
    name: true,
    email: true,
    role: { select: { name: true } },
    employeeProfile: {
        select: {
            title: true,
            department: true,
            avatar: true,
            phone: true,
        }
    }
};

// 1. Bootstrap all communication data for the current user
export const getCommunicationBootstrap = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const tenantId = req.user!.tenantId;

        // Fetch or create "General" channel if tenant has none
        let generalChannel = await prisma.commChannel.findFirst({
            where: { tenantId, name: 'general' }
        });

        if (!generalChannel) {
            generalChannel = await prisma.commChannel.create({
                data: {
                    tenantId,
                    name: 'general',
                    description: 'Company-wide general discussions',
                    createdById: userId,
                    members: {
                        create: { userId, role: 'ADMIN' }
                    }
                }
            });
        }

        // Fetch user's channels
        const channels = await prisma.commChannel.findMany({
            where: {
                tenantId,
                OR: [
                    { isPrivate: false },
                    { members: { some: { userId } } }
                ]
            },
            include: {
                team: { select: { id: true, name: true } },
                members: {
                    include: {
                        user: { select: userSelect }
                    }
                },
                messages: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    include: { sender: { select: { id: true, name: true } } }
                }
            },
            orderBy: { createdAt: 'asc' }
        });

        // Fetch user's direct conversations (1:1 and Group chats)
        const conversations = await prisma.directConversation.findMany({
            where: {
                tenantId,
                participants: { some: { userId } }
            },
            include: {
                participants: {
                    include: {
                        user: { select: userSelect }
                    }
                },
                messages: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    include: { sender: { select: { id: true, name: true } } }
                }
            },
            orderBy: { updatedAt: 'desc' }
        });

        // Deduplicate conversations so there is strictly at most 1 conversation between any two users / group set
        const seenPairs = new Set<string>();
        const seenGroups = new Set<string>();
        const uniqueConversations = conversations.filter((c) => {
            if (c.isGroup) {
                const groupKey = `${c.title || 'group'}_${c.participants.map((p) => p.userId).sort((a, b) => a - b).join('_')}`;
                if (seenGroups.has(groupKey)) return false;
                seenGroups.add(groupKey);
                return true;
            }
            const ids = c.participants.map((p) => p.userId).sort((a, b) => a - b).join('_');
            if (seenPairs.has(ids)) return false;
            seenPairs.add(ids);
            return true;
        });

        // Fetch all active employees in tenant for directory/search/adding members
        const employees = await prisma.user.findMany({
            where: { tenantId, isActive: true },
            select: userSelect,
            orderBy: { name: 'asc' }
        });

        // Fetch organizational teams
        const teams = await prisma.team.findMany({
            where: { tenantId },
            select: { id: true, name: true }
        });

        res.json({
            channels,
            conversations: uniqueConversations,
            employees,
            teams,
            currentUserId: userId,
        });
    } catch (err: any) {
        console.error('[Communication bootstrap error]', err);
        res.status(500).json({ message: 'Failed to load communication data', error: err.message });
    }
};

// 2. Create a Channel
export const createChannel = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const tenantId = req.user!.tenantId;
        const { name, description, teamId, isPrivate, memberIds } = req.body;

        if (!name || typeof name !== 'string') {
            return res.status(400).json({ message: 'Channel name is required' });
        }

        const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-');

        const existing = await prisma.commChannel.findFirst({
            where: { tenantId, name: cleanName, teamId: teamId ? Number(teamId) : null }
        });

        if (existing) {
            return res.status(400).json({ message: 'Channel with this name already exists' });
        }

        const uniqueMembers = Array.from(new Set([userId, ...(Array.isArray(memberIds) ? memberIds.map(Number) : [])]));

        const channel = await prisma.commChannel.create({
            data: {
                tenantId,
                name: cleanName,
                description: description?.trim() || null,
                teamId: teamId ? Number(teamId) : null,
                isPrivate: !!isPrivate,
                createdById: userId,
                members: {
                    create: uniqueMembers.map((mId) => ({
                        userId: mId,
                        role: mId === userId ? 'ADMIN' : 'MEMBER'
                    }))
                }
            },
            include: {
                team: { select: { id: true, name: true } },
                members: {
                    include: { user: { select: userSelect } }
                }
            }
        });

        try {
            const io = getIO();
            io.to(`tenant_${tenantId}`).emit('channel_created', channel);
        } catch (_) {}

        res.status(201).json(channel);
    } catch (err: any) {
        console.error('[Create channel error]', err);
        res.status(500).json({ message: 'Failed to create channel', error: err.message });
    }
};

// 3. Update Channel
export const updateChannel = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const tenantId = req.user!.tenantId;
        const channelId = Number(req.params.id);
        const { name, description } = req.body;

        const channel = await prisma.commChannel.findFirst({
            where: { id: channelId, tenantId },
            include: { members: true }
        });

        if (!channel) return res.status(404).json({ message: 'Channel not found' });

        // Must be admin of channel or tenant HR_ADMIN/SYSTEM_ADMIN
        const isChannelAdmin = channel.members.some(m => m.userId === userId && m.role === 'ADMIN') || channel.createdById === userId;
        const isPlatformAdmin = req.user!.role === 'HR_ADMIN' || req.user!.role === 'SYSTEM_ADMIN';

        if (!isChannelAdmin && !isPlatformAdmin) {
            return res.status(403).json({ message: 'Only channel admins can edit this channel' });
        }

        const updated = await prisma.commChannel.update({
            where: { id: channelId },
            data: {
                name: name ? name.trim().toLowerCase().replace(/\s+/g, '-') : channel.name,
                description: description !== undefined ? description?.trim() : channel.description
            },
            include: {
                team: { select: { id: true, name: true } },
                members: { include: { user: { select: userSelect } } }
            }
        });

        try {
            const io = getIO();
            io.to(`channel_${channelId}`).emit('channel_updated', updated);
        } catch (_) {}

        res.json(updated);
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to update channel', error: err.message });
    }
};

// 4. Delete Channel
export const deleteChannel = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const tenantId = req.user!.tenantId;
        const channelId = Number(req.params.id);

        const channel = await prisma.commChannel.findFirst({
            where: { id: channelId, tenantId },
            include: { members: true }
        });

        if (!channel) return res.status(404).json({ message: 'Channel not found' });
        if (channel.name === 'general') {
            return res.status(400).json({ message: 'The general channel cannot be deleted' });
        }

        const isChannelAdmin = channel.members.some(m => m.userId === userId && m.role === 'ADMIN') || channel.createdById === userId;
        const isPlatformAdmin = req.user!.role === 'HR_ADMIN' || req.user!.role === 'SYSTEM_ADMIN';

        if (!isChannelAdmin && !isPlatformAdmin) {
            return res.status(403).json({ message: 'Only channel admins can delete this channel' });
        }

        await prisma.commChannel.delete({ where: { id: channelId } });

        try {
            const io = getIO();
            io.to(`tenant_${tenantId}`).emit('channel_deleted', { channelId });
        } catch (_) {}

        res.json({ message: 'Channel deleted successfully' });
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to delete channel', error: err.message });
    }
};

// 5. Add / Remove Channel Members
export const addChannelMember = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId;
        const channelId = Number(req.params.id);
        const { userId, role } = req.body;

        const channel = await prisma.commChannel.findFirst({
            where: { id: channelId, tenantId }
        });
        if (!channel) return res.status(404).json({ message: 'Channel not found' });

        const member = await prisma.commChannelMember.upsert({
            where: { channelId_userId: { channelId, userId: Number(userId) } },
            create: {
                channelId,
                userId: Number(userId),
                role: role === 'ADMIN' ? 'ADMIN' : 'MEMBER'
            },
            update: {
                role: role === 'ADMIN' ? 'ADMIN' : 'MEMBER'
            },
            include: { user: { select: userSelect } }
        });

        try {
            const io = getIO();
            io.to(`channel_${channelId}`).emit('channel_member_added', { channelId, member });
        } catch (_) {}

        res.status(201).json(member);
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to add member', error: err.message });
    }
};

export const removeChannelMember = async (req: AuthRequest, res: Response) => {
    try {
        const channelId = Number(req.params.id);
        const targetUserId = Number(req.params.userId);

        await prisma.commChannelMember.deleteMany({
            where: { channelId, userId: targetUserId }
        });

        try {
            const io = getIO();
            io.to(`channel_${channelId}`).emit('channel_member_removed', { channelId, userId: targetUserId });
        } catch (_) {}

        res.json({ message: 'Member removed from channel' });
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to remove member', error: err.message });
    }
};

// 6. Direct & Group Conversations
export const getOrCreateConversation = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const tenantId = req.user!.tenantId;
        const { targetUserId, isGroup, title, participantIds } = req.body;

        if (!isGroup && targetUserId) {
            const targetIdNum = Number(targetUserId);
            if (!targetIdNum || targetIdNum === userId) {
                return res.status(400).json({ message: 'Invalid recipient for direct conversation' });
            }

            // Find existing 1:1 conversation between these two users
            const existing = await prisma.directConversation.findFirst({
                where: {
                    tenantId,
                    isGroup: false,
                    AND: [
                        { participants: { some: { userId } } },
                        { participants: { some: { userId: targetIdNum } } }
                    ]
                },
                include: {
                    participants: { include: { user: { select: userSelect } } },
                    messages: {
                        take: 1,
                        orderBy: { createdAt: 'desc' }
                    }
                }
            });

            if (existing) {
                return res.json(existing);
            }

            // Create new 1:1
            const conv = await prisma.directConversation.create({
                data: {
                    tenantId,
                    isGroup: false,
                    participants: {
                        create: [
                            { userId },
                            { userId: targetIdNum }
                        ]
                    }
                },
                include: {
                    participants: { include: { user: { select: userSelect } } },
                    messages: true
                }
            });

            return res.status(201).json(conv);
        }

        // Group conversation
        const members = Array.from(new Set([userId, ...(Array.isArray(participantIds) ? participantIds.map(Number) : [])]));
        const groupConv = await prisma.directConversation.create({
            data: {
                tenantId,
                isGroup: true,
                title: title?.trim() || 'Group Chat',
                participants: {
                    create: members.map(mId => ({ userId: mId }))
                }
            },
            include: {
                participants: { include: { user: { select: userSelect } } },
                messages: true
            }
        });

        res.status(201).json(groupConv);
    } catch (err: any) {
        console.error('[Get/create conversation error]', err);
        res.status(500).json({ message: 'Failed to initiate conversation', error: err.message });
    }
};

// 7. Get Messages (Channel or Conversation)
export const getMessages = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId;
        const { channelId, conversationId, limit = 50, before } = req.query;

        const where: any = { tenantId, isDeleted: false };
        if (channelId) where.channelId = Number(channelId);
        if (conversationId) where.conversationId = Number(conversationId);
        if (before) where.id = { lt: Number(before) };

        const messages = await prisma.chatMessage.findMany({
            where,
            take: Number(limit),
            orderBy: { createdAt: 'desc' },
            include: {
                sender: { select: userSelect },
                attachments: true,
                replyTo: {
                    select: {
                        id: true,
                        content: true,
                        sender: { select: { id: true, name: true } }
                    }
                },
                readReceipts: {
                    select: { userId: true, readAt: true }
                }
            }
        });

        res.json(messages.reverse());
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to fetch messages', error: err.message });
    }
};

// 8. Send Message
export const sendMessage = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const tenantId = req.user!.tenantId;
        const { channelId, conversationId, content, replyToId, attachments } = req.body;

        if (!content?.trim() && (!attachments || attachments.length === 0)) {
            return res.status(400).json({ message: 'Message content or attachment is required' });
        }

        const message = await prisma.chatMessage.create({
            data: {
                tenantId,
                senderId: userId,
                channelId: channelId ? Number(channelId) : null,
                conversationId: conversationId ? Number(conversationId) : null,
                content: content?.trim() || '',
                replyToId: replyToId ? Number(replyToId) : null,
                attachments: attachments && Array.isArray(attachments) ? {
                    create: attachments.map((a: any) => ({
                        fileName: a.fileName,
                        fileUrl: a.fileUrl,
                        fileType: a.fileType || 'file',
                        fileSize: a.fileSize || 0
                    }))
                } : undefined,
                readReceipts: {
                    create: { userId, readAt: new Date() }
                }
            },
            include: {
                sender: { select: userSelect },
                attachments: true,
                replyTo: {
                    select: {
                        id: true,
                        content: true,
                        sender: { select: { id: true, name: true } }
                    }
                },
                readReceipts: true
            }
        });

        // Update conversation's updatedAt
        if (conversationId) {
            await prisma.directConversation.update({
                where: { id: Number(conversationId) },
                data: { updatedAt: new Date() }
            });
        }

        // Real-time broadcast via Socket.IO
        try {
            const io = getIO();
            if (channelId) {
                io.to(`channel_${channelId}`).emit('new_message', message);
            } else if (conversationId) {
                io.to(`conv_${conversationId}`).emit('new_message', message);
                // Also notify conversation participants directly in user room
                const conv = await prisma.directConversation.findUnique({
                    where: { id: Number(conversationId) },
                    include: { participants: true }
                });
                conv?.participants.forEach(p => {
                    if (p.userId !== userId) {
                        io.to(`user_${p.userId}`).emit('new_conversation_message', {
                            conversationId,
                            message
                        });
                    }
                });
            }
        } catch (_) {}

        res.status(201).json(message);
    } catch (err: any) {
        console.error('[Send message error]', err);
        res.status(500).json({ message: 'Failed to send message', error: err.message });
    }
};

// 9. Edit Message
export const editMessage = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const messageId = Number(req.params.id);
        const { content } = req.body;

        const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
        if (!message) return res.status(404).json({ message: 'Message not found' });
        if (message.senderId !== userId) {
            return res.status(403).json({ message: 'You can only edit your own messages' });
        }

        const updated = await prisma.chatMessage.update({
            where: { id: messageId },
            data: {
                content: content.trim(),
                isEdited: true
            },
            include: {
                sender: { select: userSelect },
                attachments: true
            }
        });

        try {
            const io = getIO();
            const room = message.channelId ? `channel_${message.channelId}` : `conv_${message.conversationId}`;
            io.to(room).emit('message_edited', updated);
        } catch (_) {}

        res.json(updated);
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to edit message', error: err.message });
    }
};

// 10. Delete Message
export const deleteMessage = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const messageId = Number(req.params.id);

        const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
        if (!message) return res.status(404).json({ message: 'Message not found' });

        const isOwner = message.senderId === userId;
        const isPlatformAdmin = req.user!.role === 'HR_ADMIN' || req.user!.role === 'SYSTEM_ADMIN';
        if (!isOwner && !isPlatformAdmin) {
            return res.status(403).json({ message: 'Unauthorized to delete this message' });
        }

        await prisma.chatMessage.update({
            where: { id: messageId },
            data: { isDeleted: true, content: 'This message was deleted' }
        });

        try {
            const io = getIO();
            const room = message.channelId ? `channel_${message.channelId}` : `conv_${message.conversationId}`;
            io.to(room).emit('message_deleted', { messageId });
        } catch (_) {}

        res.json({ message: 'Message deleted' });
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to delete message', error: err.message });
    }
};

// 11. Call History
export const getCallHistory = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const tenantId = req.user!.tenantId;

        const calls = await prisma.callRecord.findMany({
            where: {
                tenantId,
                OR: [
                    { callerId: userId },
                    { participants: { some: { userId } } }
                ]
            },
            take: 30,
            orderBy: { startedAt: 'desc' },
            include: {
                caller: { select: userSelect },
                participants: { include: { user: { select: userSelect } } }
            }
        });

        res.json(calls);
    } catch (err: any) {
        res.status(500).json({ message: 'Failed to fetch call history', error: err.message });
    }
};

// 12. Search
export const searchCommunication = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user!.tenantId;
        const userId = req.user!.id;
        const q = String(req.query.q || '').trim();

        if (!q) {
            return res.json({ people: [], channels: [], messages: [] });
        }

        const [people, channels, messages] = await Promise.all([
            prisma.user.findMany({
                where: {
                    tenantId,
                    isActive: true,
                    OR: [
                        { name: { contains: q, mode: 'insensitive' } },
                        { email: { contains: q, mode: 'insensitive' } }
                    ]
                },
                select: userSelect,
                take: 10
            }),
            prisma.commChannel.findMany({
                where: {
                    tenantId,
                    name: { contains: q, mode: 'insensitive' }
                },
                take: 10
            }),
            prisma.chatMessage.findMany({
                where: {
                    tenantId,
                    content: { contains: q, mode: 'insensitive' },
                    isDeleted: false,
                    OR: [
                        { channelId: { not: null } },
                        { conversation: { participants: { some: { userId } } } }
                    ]
                },
                include: { sender: { select: userSelect } },
                take: 20
            })
        ]);

        res.json({ people, channels, messages });
    } catch (err: any) {
        res.status(500).json({ message: 'Search failed', error: err.message });
    }
};
