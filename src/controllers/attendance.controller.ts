import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createNotification, notifyAdmins } from '../utils/notification';
import { getManagerTeamMemberIds, isAdminOrManager } from "../utils/teamScope";
import { createAuditLog } from "../utils/auditLog";
import { sendPushNotificationToUser } from "./pushNotification.controller";

const prisma = new PrismaClient();

interface AuthRequest extends Request {
    user?: any;
}

// UPDATED: Common admin role checker
const isAdmin = (user: any) => {
    return ['HR_ADMIN', 'ADMIN', 'SYSTEM_ADMIN'].includes(user?.role);
};

const sendAttendancePushToApprovers = async ({
    tenantId,
    employeeUserId,
    title,
    body,
}: {
    tenantId: string;
    employeeUserId: number;
    title: string;
    body: string;
}) => {
    try {
        const employee = await prisma.user.findFirst({
            where: { id: employeeUserId, tenantId },
            select: { managerId: true },
        });

        const admins = await prisma.user.findMany({
            where: {
                tenantId,
                isActive: true,
                deletedAt: null,
                role: {
                    name: {
                        in: ["HR_ADMIN", "SYSTEM_ADMIN", "ADMIN"],
                    },
                },
            },
            select: { id: true },
        });

        const approverIds = new Set<number>();

        admins.forEach((admin) => approverIds.add(admin.id));

        // ✅ Send to manager also
        if (employee?.managerId) {
            approverIds.add(employee.managerId);
        }

        await Promise.all(
            Array.from(approverIds).map((id) =>
                sendPushNotificationToUser(id, title, body)
            )
        );
    } catch (error) {
        console.error("Attendance approver push error:", error);
    }
};

// ✅ ADDED: HR Admin can access everyone,
// Team Manager can access only their own team members
const canAccessEmployeeRegularization = async (
    tenantId: string,
    loggedInUser: any,
    targetUserId: number
): Promise<boolean> => {

    // HR Admin can access all employees
    if (isAdmin(loggedInUser)) {
        return true;
    }

    // Team manager can access only team members
    const memberIds = await getManagerTeamMemberIds(
        tenantId,
        loggedInUser.id
    );

    return memberIds.includes(targetUserId);
};

const getISTTimeParts = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    }).formatToParts(date);
    const hour = Number(parts.find(p => p.type === 'hour')?.value || 0);
    const minute = Number(parts.find(p => p.type === 'minute')?.value || 0);
    return { hour, minute };
};

interface ShiftInfo {
    id?: string;
    name: string;
    startTime: string; // HH:mm
    endTime: string;   // HH:mm
    breakDuration: number;
    graceTime: number;
    isNightShift: boolean;
}

const getEmployeeShift = async (userId: number, tenantId: string): Promise<ShiftInfo> => {
    try {
        const profile = await prisma.employeeProfile.findFirst({
            where: { userId, tenantId },
            include: { shiftRef: true },
        });

        if (profile?.shiftRef) {
            const isNight = Boolean(profile.shiftRef.isNightShift) || Boolean(profile.shiftRef.startTime && profile.shiftRef.endTime && profile.shiftRef.endTime < profile.shiftRef.startTime);
            return {
                id: profile.shiftRef.id,
                name: profile.shiftRef.name,
                startTime: profile.shiftRef.startTime || '09:00',
                endTime: profile.shiftRef.endTime || '18:00',
                breakDuration: profile.shiftRef.breakDuration ?? 60,
                graceTime: profile.shiftRef.graceTime ?? 15,
                isNightShift: isNight,
            };
        }

        const defaultShift = await prisma.shift.findFirst({
            where: { tenantId },
            orderBy: { createdAt: 'asc' },
        });

        if (defaultShift) {
            const isNight = Boolean(defaultShift.isNightShift) || Boolean(defaultShift.startTime && defaultShift.endTime && defaultShift.endTime < defaultShift.startTime);
            return {
                id: defaultShift.id,
                name: defaultShift.name,
                startTime: defaultShift.startTime || '09:00',
                endTime: defaultShift.endTime || '18:00',
                breakDuration: defaultShift.breakDuration ?? 60,
                graceTime: defaultShift.graceTime ?? 15,
                isNightShift: isNight,
            };
        }
    } catch (err) {
        console.warn('Error resolving shift for user:', userId, err);
    }

    return {
        name: 'General Shift',
        startTime: '09:00',
        endTime: '18:00',
        breakDuration: 60,
        graceTime: 15,
        isNightShift: false,
    };
};

const isPunchInLate = (punchDate: Date, shift: ShiftInfo): boolean => {
    const { hour: inHour, minute: inMinute } = getISTTimeParts(punchDate);
    const punchMinutes = inHour * 60 + inMinute;

    const [sHour, sMin] = (shift.startTime || '09:00').split(':').map(Number);
    const shiftStartMinutes = sHour * 60 + (sMin || 0);
    const graceMinutes = shift.graceTime ?? 15;
    const lateCutoff = shiftStartMinutes + graceMinutes;

    if (shift.isNightShift) {
        if (sHour >= 12) {
            if (punchMinutes > lateCutoff || punchMinutes < (sHour * 60 - 360)) {
                return true;
            }
        } else {
            if (punchMinutes > lateCutoff) return true;
        }
        return false;
    }

    return punchMinutes > lateCutoff;
};

// UPDATED: Calculate attendance status from proposed in/out time
const calculateRegularizedStatus = (
    inTime?: Date | null,
    outTime?: Date | null,
    shift?: ShiftInfo | null
) => {
    if (!inTime || !outTime) return { status: 'Absent', hours: 0 };

    const hours = (outTime.getTime() - inTime.getTime()) / (1000 * 60 * 60);

    let status = 'Present';

    if (hours < 4) {
        status = 'Half Day';
    } else if (shift) {
        if (isPunchInLate(inTime, shift)) {
            status = 'Late';
        }
    } else {
        const { hour: punchInHour, minute: punchInMinute } = getISTTimeParts(inTime);
        if (punchInHour > 9 || (punchInHour === 9 && punchInMinute > 30)) {
            status = 'Late';
        }
    }

    return {
        status,
        hours: Number(hours.toFixed(2)),
    };
};

export const getPunchStatus = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const tenantId = req.user.tenantId;
        const now = new Date();
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);

        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        const shift = await getEmployeeShift(userId, tenantId);

        let [record, todayHoliday] = await Promise.all([
            prisma.attendanceRecord.findFirst({
                where: {
                    userId,
                    date: today
                }
            }),
            prisma.holiday.findFirst({
                where: {
                    tenantId,
                    date: { gte: startOfDay, lte: endOfDay }
                }
            })
        ]);

        // If today's record doesn't have an active punch, check if yesterday had an open shift (night shift across midnight)
        if (!record || (!record.inTime || record.outTime)) {
            const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const yesterdayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(yesterdayDate);

            const yesterdayRecord = await prisma.attendanceRecord.findFirst({
                where: {
                    userId,
                    date: yesterdayStr
                }
            });

            if (yesterdayRecord?.inTime && !yesterdayRecord?.outTime) {
                const elapsedHours = (now.getTime() - new Date(yesterdayRecord.inTime).getTime()) / (1000 * 60 * 60);
                if (elapsedHours < 18) {
                    record = yesterdayRecord;
                }
            }
        }

        // Only block if NOT a holiday (holiday has priority and allows working)
        const approvedLeave = !todayHoliday ? await prisma.leave.findFirst({
            where: {
                userId,
                status: 'APPROVED',
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay }
            },
            include: { leaveType: true }
        }) : null;

        return res.json({
            isPunchedIn: !!(record?.inTime && !record?.outTime),
            punchInTime: record?.inTime || null,
            punchOutTime: record?.outTime || null,
            status: record?.status || null,
            isOnLeave: !!approvedLeave,
            leaveTypeName: approvedLeave?.leaveType?.name || null,
            isHoliday: !!todayHoliday,
            holidayName: todayHoliday?.name || null,
            shift: {
                id: shift.id,
                name: shift.name,
                startTime: shift.startTime,
                endTime: shift.endTime,
                breakDuration: shift.breakDuration,
                graceTime: shift.graceTime,
                isNightShift: shift.isNightShift,
            }
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
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);

        const shift = await getEmployeeShift(userId, tenantId);

        let record = await prisma.attendanceRecord.findUnique({
            where: {
                userId_date: {
                    userId,
                    date: today,
                },
            },
        });

        // If today has no open punch, check if yesterday had an open shift (night shift crossing midnight)
        if (!record || (!record.inTime || record.outTime)) {
            const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const yesterdayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(yesterdayDate);

            const yesterdayRecord = await prisma.attendanceRecord.findUnique({
                where: {
                    userId_date: {
                        userId,
                        date: yesterdayStr,
                    },
                },
            });

            if (yesterdayRecord?.inTime && !yesterdayRecord?.outTime) {
                const elapsedHours = (now.getTime() - new Date(yesterdayRecord.inTime).getTime()) / (1000 * 60 * 60);
                if (elapsedHours < 18) {
                    record = yesterdayRecord;
                }
            }
        }

        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        // Check if today is an official holiday for the tenant
        const todayHoliday = await prisma.holiday.findFirst({
            where: {
                tenantId,
                date: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            }
        });

        if (!record || !record.inTime) {
            // Block punch-in if on approved leave, EXCEPT if today is an official holiday
            if (!todayHoliday) {
                const approvedLeave = await prisma.leave.findFirst({
                    where: {
                        userId,
                        status: 'APPROVED',
                        startDate: { lte: endOfDay },
                        endDate: { gte: startOfDay }
                    },
                });

                if (approvedLeave) {
                    return res.status(400).json({ message: 'You are on leave today. Punch-in is disabled.' });
                }
            }

            // Punch In: Evaluate late status dynamically based on employee's shift
            const isLate = isPunchInLate(now, shift);
            const status = isLate ? 'Late' : 'Present';

            if (record) {
                record = await prisma.attendanceRecord.update({
                    where: { id: record.id },
                    data: {
                        inTime: now,
                        status
                    }
                });
            } else {
                record = await prisma.attendanceRecord.create({
                    data: {
                        userId,
                        tenantId,
                        date: today,
                        inTime: now,
                        status
                    }
                });
            }

            if (status === 'Late') {
                const title = "Attendance Alert";
                const message = `You were marked late for your ${shift.name} (${shift.startTime}). Please request an attendance correction if needed.`;

                await createNotification({
                    tenantId,
                    userId,
                    title,
                    message,
                    type: "attendance",
                    link: "/attendance",
                });

                await sendPushNotificationToUser(userId, title, message);
            }

            return res.json({ message: 'Punched in successfully', record, shift });
        } if (record.inTime && !record.outTime) {
            // Punch Out
            const inTime = new Date(record.inTime);
            const hours = (now.getTime() - inTime.getTime()) / (1000 * 60 * 60);

            let status = record.status;
            if (hours < 4) {
                status = 'Half Day';
            }

            record = await prisma.attendanceRecord.update({
                where: { id: record.id },
                data: {
                    outTime: now,
                    hours: parseFloat(hours.toFixed(2)),
                    status
                },
            });

            return res.json({
                message: "Punched out successfully",
                record,
                shift
            });
        }

        return res.status(400).json({
            message: "Already punched out for today",
        });
    } catch (error: any) {
        res.status(500).json({
            message: "Error during punch toggle",
            error: error.message,
        });
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
        const formattedRecords = records.map((record) => {
            let computedHours = record.hours;
            if (computedHours == null && record.inTime && record.outTime) {
                computedHours = parseFloat(
                    ((new Date(record.outTime).getTime() - new Date(record.inTime).getTime()) / (1000 * 60 * 60)).toFixed(2)
                );
            }
            return {
                ...record,
                hours: computedHours ?? 0,
                totalHours: computedHours ?? 0,
                inTime: record.inTime,
                outTime: record.outTime,
                clockIn: record.inTime,
                clockOut: record.outTime,
            };
        });

        return res.json(formattedRecords);


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

        const [records, user, holidays, approvedLeaves] = await Promise.all([
            prisma.attendanceRecord.findMany({
                where: {
                    userId,
                    date: {
                        startsWith: datePrefix
                    }
                }
            }),
            prisma.user.findUnique({
                where: { id: userId },
                include: { employeeProfile: true }
            }),
            prisma.holiday.findMany({
                where: { tenantId: loggedInUser.tenantId }
            }),
            prisma.leave.findMany({
                where: {
                    userId,
                    status: 'APPROVED'
                }
            })
        ]);

        const joiningDate = user?.employeeProfile?.joiningDate || user?.createdAt;
        const numYear = Number(year);
        const numMonth = Number(month);
        const daysInMonth = new Date(numYear, numMonth, 0).getDate();
        const isCurrentMonth = now.getFullYear() === numYear && (now.getMonth() + 1) === numMonth;
        const endDay = isCurrentMonth ? Math.min(now.getDate() - 1, daysInMonth) : daysInMonth;

        let computedAbsentCount = 0;
        if (!isCurrentMonth || now.getDate() > 1) {
            for (let d = 1; d <= endDay; d++) {
                const currentDay = new Date(numYear, numMonth - 1, d);
                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

                if (joiningDate) {
                    const jdCopy = new Date(joiningDate);
                    jdCopy.setHours(0, 0, 0, 0);
                    if (currentDay < jdCopy) continue;
                }

                // Skip weekends (Saturday=6, Sunday=0)
                if (currentDay.getDay() === 0 || currentDay.getDay() === 6) continue;

                // Skip holidays
                const isHoliday = holidays.some((h: any) => h.date.toISOString().split('T')[0] === dateStr);
                if (isHoliday) continue;

                // Skip approved leaves
                const isLeaveApproved = approvedLeaves.some((l: any) => {
                    const s = l.startDate.toISOString().split('T')[0];
                    const e = l.endDate.toISOString().split('T')[0];
                    return dateStr >= s && dateStr <= e;
                });
                if (isLeaveApproved) continue;

                // Check attendance record
                const rec = (records as any[]).find((r: any) => r.date === dateStr);
                if (rec) {
                    if (rec.status === 'Present' || rec.status === 'Late' || rec.status === 'Half Day') {
                        continue;
                    }
                    if (rec.status === 'Absent') {
                        computedAbsentCount++;
                        continue;
                    }
                } else {
                    computedAbsentCount++;
                }
            }
        }

        const explicitAbsentRecords = (records as any[]).filter((r: any) => r.status === 'Absent').length;

        const stats = {
            present:
                (records as any[]).filter((r: any) =>
                    r.status === 'Present' ||
                    r.status === 'Late' ||
                    r.status === 'Half Day'
                ).length,
            absent: Math.max(explicitAbsentRecords, computedAbsentCount),
            late: (records as any[]).filter((r: any) => r.status === 'Late').length,
            halfDay: (records as any[]).filter((r: any) => r.status === 'Half Day').length,
            holiday: holidays.filter((h: any) => {
                const hd = new Date(h.date);
                return hd.getFullYear() === numYear && (hd.getMonth() + 1) === numMonth;
            }).length,
            weekend: (records as any[]).filter((r: any) => r.status === 'Weekend').length,
        };

        res.json(stats);
    } catch (error: any) {
        res.status(500).json({ message: 'Error fetching attendance stats', error: error.message });
    }
};

// UPDATED: 1. Employee applies for attendance regularization
export const applyRegularization = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const tenantId = req.user.tenantId;

        const {
            date,
            reason,

            // frontend currently sends inTime/outTime
            inTime,
            outTime,

            // also supports proposedIn/proposedOut if later used
            proposedIn,
            proposedOut,
        } = req.body;

        if (!date || !reason) {
            return res.status(400).json({
                message: 'Date and reason are required',
            });
        }

        const parseTime = (date: string, time?: string) => {
            if (!time) return null;

            const d = new Date(`${date} ${time}`);

            if (isNaN(d.getTime())) {
                return null;
            }

            return d;
        };

        const finalInTime = proposedIn
            ? new Date(proposedIn)
            : parseTime(date, inTime);

        const finalOutTime = proposedOut
            ? new Date(proposedOut)
            : parseTime(date, outTime);

        const [y, m, d] = date.split('-').map(Number);
        const targetDate = new Date(y, m - 1, d);
        targetDate.setHours(0, 0, 0, 0);

        const dayOfWeek = targetDate.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return res.status(400).json({
                message: 'Cannot apply for correction on weekends (Saturday / Sunday)',
            });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const diffDays = Math.round(
            (today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        // UPDATED: Fetch policy limit from AttendancePolicy
        const policy = await prisma.attendancePolicy.findUnique({
            where: { tenantId },
        });

        const allowedDays = policy?.regularizationDays ?? 3;

        if (diffDays < 0) {
            return res.status(400).json({
                message: 'Cannot request correction for future date',
            });
        }

        if (diffDays > allowedDays) {
            return res.status(400).json({
                message: `Policy limit exceeded. You can request correction only within ${allowedDays} days.`,
            });
        }

        const existingPending = await prisma.attendanceRegularization.findFirst({
            where: {
                userId,
                tenantId,
                date,
                status: 'PENDING',
            },
        });

        if (existingPending) {
            return res.status(400).json({
                message: 'A pending correction request already exists for this date',
            });
        }

        const attendanceRecord = await prisma.attendanceRecord.findUnique({
            where: {
                userId_date: {
                    userId,
                    date,
                },
            },
        });

        const request = await prisma.attendanceRegularization.create({
            data: {
                tenantId,
                userId,
                date,
                reason,
                proposedIn: finalInTime ? new Date(finalInTime) : null,
                proposedOut: finalOutTime ? new Date(finalOutTime) : null,
                attendanceRecordId: attendanceRecord?.id || null,
                status: 'PENDING',
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        employeeProfile: {
                            select: {
                                avatar: true,
                                department: true,
                                title: true,
                            },
                        },
                    },
                },
            },
        });

        const title = "Attendance Correction Request";
        const message = `${request.user?.name || request.user?.email || "Employee"
            } submitted an attendance correction request for ${date}.`;

        // ✅ OLD: In-app notification to admins
        await notifyAdmins({
            tenantId,
            title,
            message,
            type: "attendance",
            link: "/regularizations",
        });

        // ✅ NEW: Push notification to HR/Admin/Manager
        await sendAttendancePushToApprovers({
            tenantId,
            employeeUserId: userId,
            title,
            body: message,
        });

        await createAuditLog({
            tenantId,
            module: "Correction",
            action: "Requested",
            description: `${request.user?.name || "Employee"} submitted an attendance correction request for ${date}.`,
            performedById: userId,
            performedBy: request.user?.name || "Employee",
            performedByRole: req.user?.role,
            targetUserId: userId,
            targetUser: request.user?.name || "Employee",
            targetUserRole: "EMPLOYEE",
        });

        res.status(201).json({
            message: "Attendance correction request submitted successfully",
            request,
        });
    } catch (error: any) {
        console.error("Correction apply error:", error);
        res.status(500).json({
            message: "Error submitting correction request",
            error: error.message,
        });
    }
};

// UPDATED: 2. Employee views own requests
export const getMyRegularizationRequests = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const tenantId = req.user.tenantId;

        const requests = await prisma.attendanceRegularization.findMany({
            where: {
                userId,
                tenantId,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        res.json(requests);
    } catch (error: any) {
        res.status(500).json({
            message: 'Error fetching regularization requests',
            error: error.message,
        });
    }
};

export const getPendingRegularizations = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user.tenantId;
        const userId = req.user.id;

        const statusQuery = req.query.status as string;
        const whereClause: any = {
            tenantId,
        };

        if (statusQuery && statusQuery !== 'All') {
            whereClause.status = statusQuery;
        } else if (!statusQuery) {
            whereClause.status = "PENDING";
        }

        // ✅ CHANGED: HR admin sees all, manager sees only own team
        if (!isAdmin(req.user)) {

            const memberIds = await getManagerTeamMemberIds(tenantId, userId);


            if (memberIds.length === 0) {
                return res.status(403).json({
                    message: "Only admin or team manager can view pending correction requests",
                });
            }

            whereClause.userId = {
                in: memberIds,
            };
        }

        const requests = await prisma.attendanceRegularization.findMany({

            // ✅ CHANGED: use whereClause
            where: whereClause,
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        employeeProfile: {
                            select: {
                                avatar: true,
                                department: true,
                                title: true,
                            },
                        },
                    },
                },
            },
            orderBy: {
                createdAt: "desc",

            },
        });

        res.json(requests);
    } catch (error: any) {
        res.status(500).json({
            message: "Error fetching pending correction requests",

            error: error.message,
        });
    }
};

// UPDATED: 4. Admin approves regularization and updates master attendance record
export const approveRegularization = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user.tenantId;
        const approverId = req.user.id;
        const { id } = req.params;

        const request = await prisma.attendanceRegularization.findFirst({
            where: {
                id: Number(id),
                tenantId,
                status: "PENDING",

            },
            include: {
                user: true,
            },
        });

        if (!request) {
            return res.status(404).json({
                message: "Pending correction request not found",
            });
        }

        // ✅ CHANGED: HR admin can approve all, manager only own team
        const allowed = await canAccessEmployeeRegularization(
            tenantId,
            req.user,
            request.userId
        );

        if (!allowed) {
            return res.status(403).json({
                message: "You can approve only your team member correction requests",

            });
        }



        const shift = await getEmployeeShift(request.userId, tenantId);

        const { status, hours } = calculateRegularizedStatus(
            request.proposedIn,
            request.proposedOut,
            shift
        );

        const result = await prisma.$transaction(async (tx) => {
            const attendance = await tx.attendanceRecord.upsert({
                where: {
                    userId_date: {
                        userId: request.userId,
                        date: request.date,
                    },
                },
                create: {
                    userId: request.userId,
                    tenantId,
                    date: request.date,
                    inTime: request.proposedIn,
                    outTime: request.proposedOut,
                    hours,
                    status,
                },
                update: {
                    inTime: request.proposedIn,
                    outTime: request.proposedOut,
                    hours,
                    status,
                },
            });

            const updatedRequest = await tx.attendanceRegularization.update({
                where: {
                    id: request.id,
                },
                data: {
                    status: "APPROVED",
                    approvedAt: new Date(),
                    approverId,
                    attendanceRecordId: attendance.id,
                },
            });

            return { attendance, updatedRequest };
        });
        const title = "Attendance Correction Approved";
        const message = `Your attendance correction for ${request.date} has been approved.`;

        // ✅ OLD: In-app notification
        await createNotification({
            tenantId,
            userId: request.userId,
            title,
            message,
            type: "attendance",
            link: "/attendance",
        });

        // ✅ NEW: Push notification to employee
        await sendPushNotificationToUser(request.userId, title, message);

        await createAuditLog({
            tenantId,
            module: "Correction",
            action: "Approved",
            description: `${request.user?.name || "Employee"}'s attendance correction for ${request.date} was approved.`,
            performedById: approverId,
            performedBy: req.user?.email || "Admin",
            performedByRole: req.user?.role,
            targetUserId: request.userId,
            targetUser: request.user?.name || "Employee",
            targetUserRole: "EMPLOYEE",
        });

        res.json({
            message: "Attendance correction approved and attendance updated successfully",
            ...result,
        });
    } catch (error: any) {
        console.error("Approve correction error:", error);
        res.status(500).json({
            message: "Error approving correction request",
            error: error.message,
        });
    }
};

// UPDATED: 5. Admin rejects regularization
export const rejectRegularization = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user.tenantId;
        const approverId = req.user.id;
        const { id } = req.params;
        const { reason } = req.body;

        const request = await prisma.attendanceRegularization.findFirst({
            where: {
                id: Number(id),
                tenantId,
                status: "PENDING",

            },
        });

        if (!request) {
            return res.status(404).json({
                message: "Pending correction request not found",
            });
        }

        // ✅ CHANGED: HR admin can reject all, manager only own team
        const allowed = await canAccessEmployeeRegularization(
            tenantId,
            req.user,
            request.userId
        );

        if (!allowed) {
            return res.status(403).json({
                message: "You can reject only your team member correction requests",

            });
        }



        const updatedRequest = await prisma.attendanceRegularization.update({
            where: {
                id: request.id,
            },
            data: {
                status: "REJECTED",

                rejectedAt: new Date(),
                approverId,
                approverComment: reason || "Rejected",

            },
        });

        const title = "Attendance Correction Rejected";
        const message = `Your attendance correction for ${request.date
            } was rejected. Reason: ${reason || "No reason provided"}`;

        // ✅ OLD: In-app notification
        await createNotification({
            tenantId,
            userId: request.userId,
            title,
            message,
            type: "attendance",
            link: "/attendance",
        });

        // ✅ NEW: Push notification to employee
        await sendPushNotificationToUser(request.userId, title, message);

        await createAuditLog({
            tenantId,
            module: "Correction",
            action: "Rejected",
            description: `${request.userId}'s attendance correction for ${request.date} was rejected.`,
            performedById: approverId,
            performedBy: req.user?.email || "Admin",
            performedByRole: req.user?.role,
            targetUserId: request.userId,
            targetUser: `User ${request.userId}`,
            targetUserRole: "EMPLOYEE",
        });

        res.json({
            message: "Attendance correction request rejected successfully",
            request: updatedRequest,
        });
    } catch (error: any) {
        console.error("Reject correction error:", error);
        res.status(500).json({
            message: "Error rejecting correction request",
            error: error.message,
        });
    }
};

// UPDATED: 6. Admin force regularization / direct override
export const forceRegularizeAttendance = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user.tenantId;
        const adminId = req.user.id;

        if (!isAdmin(req.user)) {
            return res.status(403).json({
                message: 'Only admin can directly correct attendance',
            });
        }
        // ✅ ADDED: check whether logged-in user can access target employee
        const canAccessEmployeeRegularization = async (
            tenantId: string,
            loggedInUser: any,
            targetUserId: number
        ) => {
            if (isAdmin(loggedInUser)) return true;

            const memberIds = await getManagerTeamMemberIds(tenantId, loggedInUser.id);

            return memberIds.includes(targetUserId);
        };


        const {
            employeeId,
            date,
            status = 'Present',
            inTime,
            outTime,
            reason,
        } = req.body;

        if (!employeeId || !date || !reason) {
            return res.status(400).json({
                message: 'employeeId, date and reason are required',
            });
        }

        const userId = Number(employeeId);

        const employee = await prisma.user.findFirst({
            where: {
                id: userId,
                tenantId,
            },
            select: {
                name: true,
                email: true,
            },
        });

        if (!employee) {
            return res.status(404).json({
                message: 'Employee not found',
            });
        }

        const finalInTime = inTime ? new Date(inTime) : null;
        const finalOutTime = outTime ? new Date(outTime) : null;

        const shift = await getEmployeeShift(userId, tenantId);
        const calculated = calculateRegularizedStatus(finalInTime, finalOutTime, shift);

        const finalStatus = status || calculated.status;
        const finalHours = calculated.hours;

        const attendance = await prisma.attendanceRecord.upsert({
            where: {
                userId_date: {
                    userId,
                    date,
                },
            },
            create: {
                userId,
                tenantId,
                date,
                inTime: finalInTime,
                outTime: finalOutTime,
                hours: finalHours,
                status: finalStatus,
            },
            update: {
                inTime: finalInTime,
                outTime: finalOutTime,
                hours: finalHours,
                status: finalStatus,
            },
        });

        // UPDATED: Store direct override as approved audit record
        await prisma.attendanceRegularization.create({
            data: {
                tenantId,
                userId,
                date,
                proposedIn: finalInTime,
                proposedOut: finalOutTime,
                reason: `ADMIN OVERRIDE: ${reason}`,
                status: 'APPROVED',
                approvedAt: new Date(),
                approverId: adminId,
                attendanceRecordId: attendance.id,
            },
        });

        const title = "Attendance Updated by HR";
        const message = `Your attendance for ${date} was directly corrected by HR.`;

        // ✅ OLD: In-app notification
        await createNotification({
            tenantId,
            userId,
            title,
            message,
            type: "attendance",
            link: "/attendance",
        });

        // ✅ NEW: Push notification to employee
        await sendPushNotificationToUser(userId, title, message);

        res.json({
            message: "Attendance directly corrected successfully",
            attendance,
        });
    } catch (error: any) {
        console.error("Force correction error:", error);
        res.status(500).json({
            message: "Error directly correcting attendance",
            error: error.message,
        });
    }
};