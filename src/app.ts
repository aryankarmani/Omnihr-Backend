
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

import chatRoutes from './routes/chatRoutes';
import employeeRoutes from './routes/employee.routes';
import authRoutes from './routes/auth.routes';
import mastersRoutes from './routes/masters.routes';
import attendanceRoutes from './routes/attendance.routes';
import leaveRoutes from './routes/leave.routes';
import reportRoutes from './routes/report.routes';
import teamRoutes from './routes/team.routes';
import notificationRoutes from './routes/notification.routes';
import { authenticate } from './middleware/auth';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.set('etag', false);

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api/notifications', notificationRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

app.get('/api/debug-routes', (req, res) => {
  res.json({ message: "Debug route working ✅" });
});

app.use('/api/chat', chatRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/masters', mastersRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/dashboard', require('./routes/dashboard.routes').default);
app.use('/api/reports', authenticate,reportRoutes);

export { app, prisma };
