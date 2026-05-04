import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
    user?: any;
}

export const getPunchStatus = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];

        const record = await prisma.attendanceRecord.findFirst({
            where: {
                userId,
                date: today
            }
        });

        if (record) {
            return res.json({
                isPunchedIn: record.inTime && !record.outTime,
                punchInTime: record.inTime,
                punchOutTime: record.outTime,
                status: record.status
            });
        }

        return res.json({
            isPunchedIn: false,
            punchInTime: null,
            punchOutTime: null,
            status: null
        });
    } catch (error: any) {
        res.status(500).json({ message: 'Error fetching punch status', error: error.message });
    }
};

export const punchToggle = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const tenantId = req.user.tenantId;
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        let record = await prisma.attendanceRecord.findUnique({
            where: {
                userId_date: {
                    userId,
                    date: today
                }
            }
        });

        if (!record) {
            // Punch In
            // Simple Late Mark Logic: After 09:30 AM is late
            let status = 'Present';
            const punchInHour = now.getHours();
            const punchInMinute = now.getMinutes();
            // 9:30 AM threshold
            if (punchInHour > 9 || (punchInHour === 9 && punchInMinute > 30)) {
                status = 'Late';
            }

            record = await prisma.attendanceRecord.create({
                data: {
                    userId,
                    tenantId,
                    date: today,
                    inTime: now,
                    status
                }
            });
            return res.json({ message: 'Punched in successfully', record });
        } else if (record.inTime && !record.outTime) {
            // Punch Out
            const inTime = new Date(record.inTime);
            const hours = (now.getTime() - inTime.getTime()) / (1000 * 60 * 60);

            record = await prisma.attendanceRecord.update({
                where: { id: record.id },
                data: {
                    outTime: now,
                    hours: parseFloat(hours.toFixed(2))
                }
            });
            return res.json({ message: 'Punched out successfully', record });
        } else {
            return res.status(400).json({ message: 'Already punched out for today' });
        }
    } catch (error: any) {
        res.status(500).json({ message: 'Error during punch toggle', error: error.message });
    }
};

export const getAttendanceHistory = async (req: AuthRequest, res: Response) => {
    try {
        const loggedInUser = req.user;
        const employeeIdQuery = req.query.employeeId ? Number(req.query.employeeId) : null;
        
        // Security: Only HR_ADMIN can view other employees' attendance
        let userId = loggedInUser.id;
        if (employeeIdQuery && loggedInUser.role === 'HR_ADMIN') {
            userId = employeeIdQuery;
        }

        const now = new Date();
        const year = req.query.year || now.getFullYear().toString();
        const month = req.query.month || (now.getMonth() + 1).toString();

        const datePrefix = `${year}-${String(month).padStart(2, '0')}`;

        const records = await prisma.attendanceRecord.findMany({
            where: {
                userId,
                date: {
                    startsWith: datePrefix
                }
            },
            orderBy: {
                date: 'asc'
            }
        });

        res.json(records);
    } catch (error: any) {
        res.status(500).json({ message: 'Error fetching attendance history', error: error.message });
    }
};

export const getAttendanceStats = async (req: AuthRequest, res: Response) => {
    try {
        const loggedInUser = req.user;
        const employeeIdQuery = req.query.employeeId ? Number(req.query.employeeId) : null;
        
        // Security: Only HR_ADMIN can view other employees' attendance
        let userId = loggedInUser.id;
        if (employeeIdQuery && loggedInUser.role?.name === 'HR_ADMIN') {
            userId = employeeIdQuery;
        }

        const now = new Date();
        const year = req.query.year || now.getFullYear().toString();
        const month = req.query.month || (now.getMonth() + 1).toString();

        const datePrefix = `${year}-${String(month).padStart(2, '0')}`;

        const records = await prisma.attendanceRecord.findMany({
            where: {
                userId,
                date: {
                    startsWith: datePrefix
                }
            }
        });

        const stats = {
            present: records.filter(r => r.status === 'Present' || r.status === 'Late').length,
            absent: records.filter(r => r.status === 'Absent').length,
            late: records.filter(r => r.status === 'Late').length,
            halfDay: records.filter(r => r.status === 'Half Day').length,
            holiday: records.filter(r => r.status === 'Holiday').length,
            weekend: records.filter(r => r.status === 'Weekend').length,
        };

        res.json(stats);
    } catch (error: any) {
        res.status(500).json({ message: 'Error fetching attendance stats', error: error.message });
    }
};
