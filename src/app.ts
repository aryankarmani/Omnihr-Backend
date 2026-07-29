
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
import companySettingRoutes from "./routes/companySetting.routes";
import pushNotificationRoutes from "./routes/pushNotification.routes";
import customFieldsRoutes from "./routes/customFields.routes";
import auditLogRoutes from "./routes/auditLog.routes";
import payrollRoutes from "./routes/payroll.routes";

app.use(cors());
app.use(express.json());

// Gracefully handle JSON parsing errors (SyntaxError) from body-parser
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
    console.error(`[JSON Parse Error] Invalid JSON received on ${req.method} ${req.path}`);
    console.error('Raw Body Content:', err.body);
    return res.status(400).json({ 
      status: 'error', 
      message: 'Invalid JSON format in request body',
      details: err.message
    });
  }
  next();
});

app.use('/uploads', express.static(path.join(process.cwd(), "uploads")));

app.set('etag', false);

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api/notifications', notificationRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// app.get('/api/debug-routes', (req, res) => {
//   res.json({ message: "Debug route working ✅" });
// });

app.use('/api/chat', chatRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/masters', mastersRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/dashboard', require('./routes/dashboard.routes').default);
app.use('/api/reports', authenticate, reportRoutes);
app.use("/api/company-setting", companySettingRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/payroll", payrollRoutes);
//app.use("/uploads", express.static("uploads"));
app.use("/api/push-notification", pushNotificationRoutes);
app.use("/api/custom-fields", customFieldsRoutes);

export { app, prisma };
