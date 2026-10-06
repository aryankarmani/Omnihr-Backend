import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/auth';
import {
    getCommunicationBootstrap,
    createChannel,
    updateChannel,
    deleteChannel,
    addChannelMember,
    removeChannelMember,
    getOrCreateConversation,
    getMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    getCallHistory,
    searchCommunication
} from '../controllers/communication.controller';

const router = Router();

// Setup secure upload directory for chat attachments
const uploadDir = path.join(process.cwd(), 'uploads', 'chat');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'chat-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // exactly 10MB limit
    fileFilter: (_req, file, cb) => {
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'];
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedMimeTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain', 'text/csv'
        ];

        // Explicitly reject executable and disallowed extensions
        const disallowedExtensions = ['.exe', '.bat', '.cmd', '.sh', '.msi', '.vbs', '.js', '.bin', '.dll', '.com', '.scr', '.ps1'];
        if (disallowedExtensions.includes(ext) || !allowedExtensions.includes(ext)) {
            return cb(new Error('File format not supported. Disallowed file extension.'));
        }

        if (allowedMimeTypes.includes(file.mimetype) || file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('File format not supported. Allowed formats: Images, PDF, Word, Excel, CSV, TXT.'));
        }
    }
});

router.use(authenticate);

// Bootstrap data
router.get('/bootstrap', getCommunicationBootstrap);

// Channels
router.post('/channels', createChannel);
router.patch('/channels/:id', updateChannel);
router.delete('/channels/:id', deleteChannel);
router.post('/channels/:id/members', addChannelMember);
router.delete('/channels/:id/members/:userId', removeChannelMember);

// Conversations (1:1 & Group)
router.post('/conversations', getOrCreateConversation);

// Messages
router.get('/messages', getMessages);
router.get('/conversations/:id/messages', (req: any, res: any) => {
    req.query.conversationId = req.params.id;
    getMessages(req, res);
});
router.get('/channels/:id/messages', (req: any, res: any) => {
    req.query.channelId = req.params.id;
    getMessages(req, res);
});
router.post('/messages', sendMessage);
router.patch('/messages/:id', editMessage);
router.delete('/messages/:id', deleteMessage);

// File Attachment Upload (10MB Max, strict validation)
router.post('/upload', (req: any, res: any) => {
    upload.single('file')(req, res, (err: any) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ message: 'File size exceeds maximum limit of 10MB' });
                }
                return res.status(400).json({ message: `Upload error: ${err.message}` });
            }
            return res.status(400).json({ message: err.message || 'File upload failed' });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }
        const fileUrl = `/uploads/chat/${req.file.filename}`;
        return res.json({
            fileName: req.file.originalname,
            fileUrl,
            fileType: req.file.mimetype,
            fileSize: req.file.size
        });
    });
});


// Call History
router.get('/calls/history', getCallHistory);

// Search
router.get('/search', searchCommunication);

export default router;
