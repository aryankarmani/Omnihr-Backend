import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// In a real multi-tenant app, you'd extract tenantId from req.user
// Assuming the user token middleware sets req.user

export const getStats = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const tenantId = user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID required' });
        }

        // 1. Total Headcount
        const headcount = await prisma.user.count({
            where: {
                tenantId,
                isActive: true,
                deletedAt: null,

            },
        });

        // 2. On Leave Today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endOfToday = new Date(today);
        endOfToday.setHours(23, 59, 59, 999);

        const onLeaveToday = await prisma.leave.count({
            where: {
                tenantId,
                status: 'APPROVED',
                startDate: { lte: endOfToday },
                endDate: { gte: today },
                user: {
                    isActive: true,
                    deletedAt: null,
                },
            }
        });

        // 3. New Joiners (Joined this month)
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        endOfMonth.setHours(23, 59, 59, 999);

        const newJoiners = await prisma.employeeProfile.count({
            where: {
                tenantId,
                isActive: true,
                deletedAt: null,
                joiningDate: {
                    gte: startOfMonth,
                    lte: endOfMonth,
                },
                user: {
                    isActive: true,
                    deletedAt: null,
                },
            },
        });

        // 4. Avg Attendance (Calculate from AttendanceRecord for the current month)
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const attendanceCount = await prisma.attendanceRecord.count({
            where: {
                tenantId,
                date: { gte: firstDayOfMonth.toISOString().split('T')[0] },
                status: {
                    in: ['Present', 'Late'],
                },
                user: {
                    isActive: true,
                    deletedAt: null,
                },
            }
        });


        // ===== WORKING DAYS LOGIC =====

        let workingDaysElapsed = 0;

        const cursor = new Date(firstDayOfMonth);

        while (cursor <= today) {

            const dow = cursor.getDay();

            // Skip Sunday + Saturday
            if (dow !== 0 && dow !== 6) {
                workingDaysElapsed++;
            }

            cursor.setDate(cursor.getDate() + 1);
        }

        const totalExpected =
            workingDaysElapsed * headcount;

        const avgAttendance =
            totalExpected > 0
                ? Math.min(
                    100,
                    Math.round(
                        (attendanceCount / totalExpected) * 100
                    )
                )
                : 0;



        res.json({
            headcount,
            onLeaveToday,
            newJoiners,
            avgAttendance: avgAttendance || 0
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getLiveAttendance = async (req: Request, res: Response) => {
    try {

        const user = (req as any).user;
        const tenantId = user?.tenantId;

        if (!tenantId) {
            return res.status(400).json({ message: 'Tenant ID required' });
        }
        const today = new Date().toISOString().split('T')[0];

        const records = await prisma.attendanceRecord.findMany({
            where: {
                tenantId,
                date: today,
                inTime: {
                    not: null,
                },
                user: {
                    isActive: true,
                    deletedAt: null,
                },
            },
            select: {
                inTime: true,
            },
        });

        const timeSlots = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'];

        const data = timeSlots.map((slot) => {
            const hour = Number(slot.split(':')[0]);

            const visitors = records.filter((record) => {
                if (!record.inTime) return false;
                const punchHour = new Date(record.inTime).getHours();

                return punchHour === hour;
            }).length;

            return {
                name: slot,
                visitors,
            };
        });
        res.json(data);

    } catch (error) {
        console.error('Error fetching live attendance:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getPendingApprovals = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const tenantId = user?.tenantId;

        if (!tenantId) return res.status(400).json({ message: 'Tenant ID required' });

        const pendingLeaves = await prisma.leave.findMany({
            where: {
                tenantId,
                status: 'PENDING'
            },
            include: {
                user: {
                    select: { name: true, employeeProfile: { select: { avatar: true } } }
                },
                leaveType: {
                    select: { name: true }
                }
            },
            take: 5
        });

        const formatted = pendingLeaves.map(leave => ({
            id: leave.id,
            userName: leave.user.name,
            type: leave.leaveType.name,
            duration: Math.ceil((new Date(leave.endDate).getTime() - new Date(leave.startDate).getTime()) / (1000 * 3600 * 24)) + 1,
            avatar: leave.user.employeeProfile?.avatar || null
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Error fetching pending approvals:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getEmployeeOverview = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const tenantId = user?.tenantId;

        if (!tenantId) return res.status(400).json({ message: 'Tenant ID required' });

        const employees = await prisma.employeeProfile.findMany({
            where: {
                tenantId,
                isActive: true,
                deletedAt: null,
                user: {
                    isActive: true,
                    deletedAt: null,
                },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            take: 5,
            orderBy: {
                joiningDate: 'desc',
            },
        });

        const formatted = employees.map(emp => ({
            id: emp.user.id, // Use userId instead of profileId
            name: emp.user.name,
            role: emp.title || 'Employee',
            status: emp.status
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Error fetching employee overview:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
