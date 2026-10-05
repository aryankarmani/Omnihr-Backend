import http from 'http';
import { app } from './app';
import { initSocket } from './socket/socketHandler';

const PORT = process.env.PORT || 3001;

const httpServer = http.createServer(app);

// Initialize Socket.IO with WebRTC signaling and real-time collaboration
initSocket(httpServer);

httpServer.listen(PORT, () => {
    console.log(`Server and Socket.IO running on port ${PORT}`);
});
