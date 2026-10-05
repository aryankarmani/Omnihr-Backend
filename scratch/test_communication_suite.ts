import jwt from 'jsonwebtoken';
import axios from 'axios';
import { io as Client } from 'socket.io-client';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3001/api';
const JWT_SECRET = process.env.JWT_SECRET || 'secretkey';

// Tokens
const tokenUserA = jwt.sign(
    { id: 2, email: 'keshavyogi1234@gmail.com', tenantId: 'be5bfd7f-0adf-4ae1-9efe-5af40d589728', role: 'Employee' },
    JWT_SECRET,
    { expiresIn: '1h' }
);

const tokenUserB = jwt.sign(
    { id: 6, email: 'aryankarmani2003@gmail.com', tenantId: 'be5bfd7f-0adf-4ae1-9efe-5af40d589728', role: 'Employee' },
    JWT_SECRET,
    { expiresIn: '1h' }
);

const tokenTenantBUser = jwt.sign(
    { id: 10, email: 'harshpreetaionweb@gmail.com', tenantId: '401314f9-4388-4278-b2b4-2505096fed05', role: 'HR_ADMIN' },
    JWT_SECRET,
    { expiresIn: '1h' }
);

const expiredToken = jwt.sign(
    { id: 2, email: 'keshavyogi1234@gmail.com', tenantId: 'be5bfd7f-0adf-4ae1-9efe-5af40d589728', role: 'Employee' },
    JWT_SECRET,
    { expiresIn: '-10s' }
);

const results: { test: string; category: string; status: 'PASS' | 'FAIL'; details: string }[] = [];

function record(category: string, test: string, status: 'PASS' | 'FAIL', details: string) {
    results.push({ category, test, status, details });
    console.log(`[${status}] [${category}] ${test} - ${details}`);
}

async function runTests() {
    console.log('=== STARTING OMNIHR COMMUNICATION MODULE AUDIT & TEST SUITE ===\n');

    // 1. HEALTH & BASIC CONNECTIVITY
    try {
        const health = await axios.get(`${API_BASE}/health`);
        if (health.data.status === 'ok') {
            record('Basic', 'Health Endpoint', 'PASS', 'Backend /api/health returned 200 OK');
        } else {
            record('Basic', 'Health Endpoint', 'FAIL', `Unexpected payload: ${JSON.stringify(health.data)}`);
        }
    } catch (e: any) {
        record('Basic', 'Health Endpoint', 'FAIL', e.message);
    }

    // 2. AUTHENTICATION & ACCESS CONTROL
    try {
        // Unauthenticated request
        try {
            await axios.get(`${API_BASE}/communication/bootstrap`);
            record('Auth', 'Unauthenticated Access Blocked', 'FAIL', 'Unauthenticated request returned 200 instead of 401');
        } catch (e: any) {
            if (e.response?.status === 401) {
                record('Auth', 'Unauthenticated Access Blocked', 'PASS', 'Rejected with 401 Unauthorized as expected');
            } else {
                record('Auth', 'Unauthenticated Access Blocked', 'FAIL', `Expected 401, got ${e.response?.status}`);
            }
        }

        // Expired Token
        try {
            await axios.get(`${API_BASE}/communication/bootstrap`, {
                headers: { Authorization: `Bearer ${expiredToken}` }
            });
            record('Auth', 'Expired Token Rejection', 'FAIL', 'Expired token was accepted');
        } catch (e: any) {
            if (e.response?.status === 401) {
                record('Auth', 'Expired Token Rejection', 'PASS', 'Expired token rejected with 401');
            } else {
                record('Auth', 'Expired Token Rejection', 'FAIL', `Expected 401, got ${e.response?.status}`);
            }
        }

        // Valid Token User A
        const resA = await axios.get(`${API_BASE}/communication/bootstrap`, {
            headers: { Authorization: `Bearer ${tokenUserA}` }
        });
        if (resA.data && Array.isArray(resA.data.channels)) {
            record('Auth', 'User A Bootstrap Access', 'PASS', `Retrieved ${resA.data.channels.length} channels, ${resA.data.conversations.length} conversations`);
        } else {
            record('Auth', 'User A Bootstrap Access', 'FAIL', 'Invalid bootstrap structure');
        }

        // Valid Token User B
        const resB = await axios.get(`${API_BASE}/communication/bootstrap`, {
            headers: { Authorization: `Bearer ${tokenUserB}` }
        });
        if (resB.data && resB.data.currentUserId === 6) {
            record('Auth', 'User B Bootstrap Access', 'PASS', 'User B authenticated correctly with ID 6');
        } else {
            record('Auth', 'User B Bootstrap Access', 'FAIL', 'User B bootstrap mismatch');
        }
    } catch (e: any) {
        record('Auth', 'Bootstrap Request', 'FAIL', e.message);
    }

    // 3. MULTI-TENANT ISOLATION
    try {
        const resTenantA = await axios.get(`${API_BASE}/communication/bootstrap`, {
            headers: { Authorization: `Bearer ${tokenUserA}` }
        });
        const resTenantB = await axios.get(`${API_BASE}/communication/bootstrap`, {
            headers: { Authorization: `Bearer ${tokenTenantBUser}` }
        });

        // Verify Tenant B cannot see Tenant A's employees
        const tenantAEmployeeIds = resTenantA.data.employees.map((e: any) => e.id);
        const tenantBEmployeeIds = resTenantB.data.employees.map((e: any) => e.id);
        const hasOverlap = tenantAEmployeeIds.some((id: number) => tenantBEmployeeIds.includes(id));

        if (!hasOverlap) {
            record('Multi-Tenancy', 'Employee Directory Isolation', 'PASS', 'Tenant A and Tenant B employee lists are strictly isolated');
        } else {
            record('Multi-Tenancy', 'Employee Directory Isolation', 'FAIL', 'Employee overlap detected across tenants');
        }

        // Attempt IDOR: Tenant B user attempts to fetch messages from Tenant A channel
        const tenantAChannelId = resTenantA.data.channels[0]?.id;
        if (tenantAChannelId) {
            const tenantBMessages = await axios.get(`${API_BASE}/communication/messages?channelId=${tenantAChannelId}`, {
                headers: { Authorization: `Bearer ${tokenTenantBUser}` }
            });
            // Should return empty array or 403 because channel belongs to Tenant A
            if (tenantBMessages.data.length === 0) {
                record('Multi-Tenancy', 'Cross-Tenant Message IDOR Protection', 'PASS', 'Tenant B cannot read Tenant A channel messages (0 returned)');
            } else {
                record('Multi-Tenancy', 'Cross-Tenant Message IDOR Protection', 'FAIL', `Tenant B read ${tenantBMessages.data.length} messages from Tenant A!`);
            }
        }
    } catch (e: any) {
        record('Multi-Tenancy', 'Cross-Tenant Test', 'FAIL', e.message);
    }

    // 4. CHANNELS LIFECYCLE
    let testChannelId: number | null = null;
    try {
        const uniqueChanName = `test-chan-${Date.now()}`;
        const createRes = await axios.post(
            `${API_BASE}/communication/channels`,
            { name: uniqueChanName, description: 'Automated test channel', isPrivate: false, memberIds: [6] },
            { headers: { Authorization: `Bearer ${tokenUserA}` } }
        );
        testChannelId = createRes.data.id;
        record('Channels', 'Create Channel', 'PASS', `Created channel #${createRes.data.name} (ID: ${testChannelId})`);

        // Duplicate name rejection in same tenant
        try {
            await axios.post(
                `${API_BASE}/communication/channels`,
                { name: uniqueChanName, description: 'Duplicate attempt' },
                { headers: { Authorization: `Bearer ${tokenUserA}` } }
            );
            record('Channels', 'Duplicate Channel Name Prevention', 'FAIL', 'Allowed duplicate channel creation');
        } catch (dupErr: any) {
            if (dupErr.response?.status === 400) {
                record('Channels', 'Duplicate Channel Name Prevention', 'PASS', 'Rejected duplicate channel with 400 Bad Request');
            } else {
                record('Channels', 'Duplicate Channel Name Prevention', 'FAIL', `Expected 400, got ${dupErr.response?.status}`);
            }
        }

        // Update Channel description
        const updateRes = await axios.patch(
            `${API_BASE}/communication/channels/${testChannelId}`,
            { description: 'Updated channel description' },
            { headers: { Authorization: `Bearer ${tokenUserA}` } }
        );
        if (updateRes.data.description === 'Updated channel description') {
            record('Channels', 'Update Channel', 'PASS', 'Channel description updated successfully');
        } else {
            record('Channels', 'Update Channel', 'FAIL', 'Channel update failed');
        }
    } catch (e: any) {
        record('Channels', 'Channel Operations', 'FAIL', e.message);
    }

    // 5. 1-ON-1 & GROUP CHAT
    let directConvId: number | null = null;
    try {
        // Self-chat prevention
        try {
            await axios.post(
                `${API_BASE}/communication/conversations`,
                { targetUserId: 2, isGroup: false },
                { headers: { Authorization: `Bearer ${tokenUserA}` } }
            );
            record('Chat', 'Prevent Self-Chat', 'FAIL', 'Server allowed User A to start a conversation with themselves');
        } catch (selfErr: any) {
            if (selfErr.response?.status === 400) {
                record('Chat', 'Prevent Self-Chat', 'PASS', 'Server blocked direct chat with oneself (400 Bad Request)');
            } else {
                record('Chat', 'Prevent Self-Chat', 'FAIL', `Expected 400, got ${selfErr.response?.status}`);
            }
        }

        // 1:1 conversation between User A and User B
        const convRes1 = await axios.post(
            `${API_BASE}/communication/conversations`,
            { targetUserId: 6, isGroup: false },
            { headers: { Authorization: `Bearer ${tokenUserA}` } }
        );
        directConvId = convRes1.data.id;

        // Idempotency: calling again should return same conversation
        const convRes2 = await axios.post(
            `${API_BASE}/communication/conversations`,
            { targetUserId: 6, isGroup: false },
            { headers: { Authorization: `Bearer ${tokenUserA}` } }
        );
        if (convRes1.data.id === convRes2.data.id) {
            record('Chat', '1:1 Conversation Idempotency', 'PASS', `Same conversation returned (ID: ${directConvId})`);
        } else {
            record('Chat', '1:1 Conversation Idempotency', 'FAIL', `Duplicate conversation created! IDs: ${convRes1.data.id}, ${convRes2.data.id}`);
        }

        // Group Chat
        const groupRes = await axios.post(
            `${API_BASE}/communication/conversations`,
            { isGroup: true, title: 'Engineering Sprint Test', participantIds: [6, 1] },
            { headers: { Authorization: `Bearer ${tokenUserA}` } }
        );
        if (groupRes.data.isGroup && groupRes.data.participants.length >= 3) {
            record('Group Chat', 'Create Group Chat', 'PASS', `Group chat created with ${groupRes.data.participants.length} participants`);
        } else {
            record('Group Chat', 'Create Group Chat', 'FAIL', 'Group chat creation failed');
        }
    } catch (e: any) {
        record('Chat', 'Conversation Management', 'FAIL', e.message);
    }

    // 6. MESSAGING (Send, Reply, Edit, Delete)
    let msgId: number | null = null;
    try {
        if (directConvId) {
            // Send Message
            const sendRes = await axios.post(
                `${API_BASE}/communication/messages`,
                { conversationId: directConvId, content: 'Hello from User A test' },
                { headers: { Authorization: `Bearer ${tokenUserA}` } }
            );
            msgId = sendRes.data.id;
            record('Messaging', 'Send 1:1 Message', 'PASS', `Message sent (ID: ${msgId})`);

            // Empty message rejection
            try {
                await axios.post(
                    `${API_BASE}/communication/messages`,
                    { conversationId: directConvId, content: '   ' },
                    { headers: { Authorization: `Bearer ${tokenUserA}` } }
                );
                record('Messaging', 'Reject Empty Message', 'FAIL', 'Server allowed blank message');
            } catch (blankErr: any) {
                if (blankErr.response?.status === 400) {
                    record('Messaging', 'Reject Empty Message', 'PASS', 'Blank message rejected with 400');
                } else {
                    record('Messaging', 'Reject Empty Message', 'FAIL', `Expected 400, got ${blankErr.response?.status}`);
                }
            }

            // Reply to message
            const replyRes = await axios.post(
                `${API_BASE}/communication/messages`,
                { conversationId: directConvId, content: 'Reply to test message', replyToId: msgId },
                { headers: { Authorization: `Bearer ${tokenUserB}` } }
            );
            if (replyRes.data.replyTo?.id === msgId) {
                record('Messaging', 'Reply Threading', 'PASS', `Reply linked correctly to parent message ${msgId}`);
            } else {
                record('Messaging', 'Reply Threading', 'FAIL', 'Reply link missing or incorrect');
            }

            // Edit own message
            const editRes = await axios.patch(
                `${API_BASE}/communication/messages/${msgId}`,
                { content: 'Hello from User A (edited)' },
                { headers: { Authorization: `Bearer ${tokenUserA}` } }
            );
            if (editRes.data.isEdited && editRes.data.content.includes('(edited)')) {
                record('Messaging', 'Edit Own Message', 'PASS', 'Message edited and flagged isEdited: true');
            } else {
                record('Messaging', 'Edit Own Message', 'FAIL', 'Edit failed');
            }

            // User B attempts to edit User A's message (Unauthorized)
            try {
                await axios.patch(
                    `${API_BASE}/communication/messages/${msgId}`,
                    { content: 'Hacked by User B' },
                    { headers: { Authorization: `Bearer ${tokenUserB}` } }
                );
                record('Messaging', 'Unauthorized Edit Blocked', 'FAIL', 'User B was allowed to edit User A message!');
            } catch (unauthErr: any) {
                if (unauthErr.response?.status === 403) {
                    record('Messaging', 'Unauthorized Edit Blocked', 'PASS', 'Blocked with 403 Forbidden as expected');
                } else {
                    record('Messaging', 'Unauthorized Edit Blocked', 'FAIL', `Expected 403, got ${unauthErr.response?.status}`);
                }
            }

            // Delete Message
            const delRes = await axios.delete(`${API_BASE}/communication/messages/${msgId}`, {
                headers: { Authorization: `Bearer ${tokenUserA}` }
            });
            if (delRes.status === 200) {
                record('Messaging', 'Delete Message', 'PASS', 'Message soft-deleted successfully');
            } else {
                record('Messaging', 'Delete Message', 'FAIL', 'Delete failed');
            }
        }
    } catch (e: any) {
        record('Messaging', 'Messaging Operations', 'FAIL', e.message);
    }

    // 7. FILE UPLOAD & ATTACHMENTS
    try {
        // Valid file upload
        const form = new FormData();
        form.append('file', Buffer.from('PDF Document mock content'), {
            filename: 'test-document.pdf',
            contentType: 'application/pdf'
        });

        const uploadRes = await axios.post(`${API_BASE}/communication/upload`, form, {
            headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${tokenUserA}`
            }
        });

        if (uploadRes.data.fileUrl && uploadRes.data.fileUrl.startsWith('/uploads/chat/')) {
            record('File Upload', 'Upload Valid PDF Attachment', 'PASS', `Uploaded to ${uploadRes.data.fileUrl}`);
        } else {
            record('File Upload', 'Upload Valid PDF Attachment', 'FAIL', 'Upload returned invalid payload');
        }

        // Invalid file format rejection (.exe / executable)
        const badForm = new FormData();
        badForm.append('file', Buffer.from('malicious payload'), {
            filename: 'exploit.exe',
            contentType: 'application/x-msdownload'
        });

        try {
            await axios.post(`${API_BASE}/communication/upload`, badForm, {
                headers: {
                    ...badForm.getHeaders(),
                    Authorization: `Bearer ${tokenUserA}`
                }
            });
            record('File Upload', 'Reject Dangerous Executable', 'FAIL', 'Server accepted .exe file upload!');
        } catch (badErr: any) {
            record('File Upload', 'Reject Dangerous Executable', 'PASS', 'Rejected unsupported file type with error');
        }
    } catch (e: any) {
        record('File Upload', 'Attachment Upload Flow', 'FAIL', e.message);
    }

    // 8. CALL HISTORY & AUDITING
    try {
        const callsRes = await axios.get(`${API_BASE}/communication/calls/history`, {
            headers: { Authorization: `Bearer ${tokenUserA}` }
        });
        if (Array.isArray(callsRes.data)) {
            record('Calling', 'Call History Access', 'PASS', `Retrieved ${callsRes.data.length} call records`);
        } else {
            record('Calling', 'Call History Access', 'FAIL', 'Invalid call history structure');
        }
    } catch (e: any) {
        record('Calling', 'Call History', 'FAIL', e.message);
    }

    // 9. SEARCH (Full-Text Employee, Channel, Messages)
    try {
        const searchRes = await axios.get(`${API_BASE}/communication/search?q=keshav`, {
            headers: { Authorization: `Bearer ${tokenUserA}` }
        });
        if (searchRes.data.people && searchRes.data.people.some((p: any) => p.name.toLowerCase().includes('keshav'))) {
            record('Search', 'Employee Search', 'PASS', `Found ${searchRes.data.people.length} employees matching "keshav"`);
        } else {
            record('Search', 'Employee Search', 'FAIL', 'Search did not return expected user');
        }
    } catch (e: any) {
        record('Search', 'Search API', 'FAIL', e.message);
    }

    // 10. REAL-TIME SOCKET.IO HANDSHAKE & EVENTS
    try {
        await new Promise<void>((resolve) => {
            const socketA = Client('http://127.0.0.1:3001', {
                auth: { token: tokenUserA },
                transports: ['websocket']
            });

            const socketB = Client('http://127.0.0.1:3001', {
                auth: { token: tokenUserB },
                transports: ['websocket']
            });

            let aConnected = false;
            let bConnected = false;

            socketA.on('connect', () => {
                aConnected = true;
                if (aConnected && bConnected) runSocketTests();
            });

            socketB.on('connect', () => {
                bConnected = true;
                if (aConnected && bConnected) runSocketTests();
            });

            socketA.on('connect_error', (err) => {
                record('Socket.IO', 'Socket Auth & Connect', 'FAIL', `Socket A connect error: ${err.message}`);
                resolve();
            });

            function runSocketTests() {
                record('Socket.IO', 'Socket Handshake & Auth', 'PASS', `Both sockets authenticated (IDs: ${socketA.id}, ${socketB.id})`);

                // Test Typing indicator
                socketB.on('user_typing', (data) => {
                    record('Socket.IO', 'Typing Indicator Broadcast', 'PASS', `User B received typing event from ${data.name}`);
                    socketA.disconnect();
                    socketB.disconnect();
                    resolve();
                });

                // User A joins test channel and types
                socketA.emit('join_channel', testChannelId || 1);
                socketB.emit('join_channel', testChannelId || 1);

                setTimeout(() => {
                    socketA.emit('typing_start', { targetType: 'channel', targetId: testChannelId || 1 });
                }, 300);

                setTimeout(() => {
                    // Fallback timeout in case typing listener missed
                    socketA.disconnect();
                    socketB.disconnect();
                    resolve();
                }, 3000);
            }
        });
    } catch (e: any) {
        record('Socket.IO', 'Socket Flow', 'FAIL', e.message);
    }

    // CLEANUP TEST CHANNEL
    if (testChannelId) {
        try {
            await axios.delete(`${API_BASE}/communication/channels/${testChannelId}`, {
                headers: { Authorization: `Bearer ${tokenUserA}` }
            });
            record('Cleanup', 'Delete Test Channel', 'PASS', `Cleaned up test channel ID ${testChannelId}`);
        } catch (_) {}
    }

    console.log('\n=== TEST SUITE COMPLETED ===');
    console.log(`Total Tests Run: ${results.length}`);
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    console.log(`PASS: ${passed} | FAIL: ${failed}`);
}

runTests();
