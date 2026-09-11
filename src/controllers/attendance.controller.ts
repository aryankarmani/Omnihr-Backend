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

// UPDATED: Calculate attendance status from proposed in/out time
const calculateRegularizedStatus = (inTime?: Date | null, outTime?: Date | null) => {
    if (!inTime || !outTime) return { status: 'Absent', hours: 0 };

    const hours = (outTime.getTime() - inTime.getTime()) / (1000 * 60 * 60);

    let status = 'Present';

    const punchInHour = inTime.getHours();
    const punchInMinute = inTime.getMinutes();

    if (hours < 4) {
        status = 'Half Day';
    } else if (punchInHour > 9 || (punchInHour === 9 && punchInMinute > 30)) {
        status = 'Late';
    }

    return {
        status,
        hours: Number(hours.toFixed(2)),
    };
};

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
                    date: today,
                },
            },
        });

        if (!record) {
            // Check if there is an approved leave overlapping today
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

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
            if (status === 'Late') {

                const title = "Attendance Alert";
                const message =
                    "You were marked late today. Please regularize your attendance if needed.";

                await createNotification({
                    tenantId,
                    userId,
                    title,
                    message,
                    type: "attendance",
                });

                // ✅ NEW: Push notification to employee
                await sendPushNotificationToUser(userId, title, message);
            }

            return res.json({ message: 'Punched in successfully', record });
        } if (record.inTime && !record.outTime) {
            const inTime = new Date(record.inTime);
            const hours = (now.getTime() - inTime.getTime()) / (1000 * 60 * 60);

            record = await prisma.attendanceRecord.update({
                where: { id: record.id },
                data: {
                    outTime: now,
                    hours: parseFloat(hours.toFixed(2)),
                },
            });

            return res.json({
                message: "Punched out successfully",
                record,
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
        const formattedRecords = records.map((record) => ({
            ...record,

            // Mobile App
            inTime: record.inTime,
            outTime: record.outTime,

            // Web App (Backward Compatibility)
            clockIn: record.inTime,
            clockOut: record.outTime,
        }));

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

        const records = await prisma.attendanceRecord.findMany({
            where: {
                userId,
                date: {
                    startsWith: datePrefix
                }
            }
        });

        const stats = {
            present:
                records.filter(r =>
                    r.status === 'Present' ||
                    r.status === 'Late' ||
                    r.status === 'Half Day'
                ).length,
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
                message: 'Cannot regularize future date',
            });
        }

        if (diffDays > allowedDays) {
            return res.status(400).json({
                message: `Policy limit exceeded. You can regularize only within ${allowedDays} days.`,
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
                message: 'A pending regularization request already exists for this date',
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
            } submitted attendance regularization for ${date}.`;

        // ✅ OLD: In-app notification to admins
        await notifyAdmins({
            tenantId,
            title,
            message,
            type: "attendance",
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
            module: "Regularization",
            action: "Requested",
            description: `${request.user?.name || "Employee"} submitted attendance regularization for ${date}.`,
            performedById: userId,
            performedBy: request.user?.name || "Employee",
            performedByRole: req.user?.role,
            targetUserId: userId,
            targetUser: request.user?.name || "Employee",
            targetUserRole: "EMPLOYEE",
        });

        res.status(201).json({
            message: "Attendance regularization request submitted successfully",
            request,
        });
    } catch (error: any) {
        console.error("Regularization apply error:", error);
        res.status(500).json({
            message: "Error submitting regularization request",
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
                    message: "Only admin or team manager can view pending regularization requests",
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
            message: "Error fetching pending regularization requests",

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
                message: "Pending regularization request not found",
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
                message: "You can approve only your team member regularization requests",

            });
        }



        const { status, hours } = calculateRegularizedStatus(
            request.proposedIn,
            request.proposedOut
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
        });

        // ✅ NEW: Push notification to employee
        await sendPushNotificationToUser(request.userId, title, message);

        await createAuditLog({
            tenantId,
            module: "Regularization",
            action: "Approved",
            description: `${request.user?.name || "Employee"}'s attendance regularization for ${request.date} was approved.`,
            performedById: approverId,
            performedBy: req.user?.email || "Admin",
            performedByRole: req.user?.role,
            targetUserId: request.userId,
            targetUser: request.user?.name || "Employee",
            targetUserRole: "EMPLOYEE",
        });

        res.json({
            message: "Regularization approved and attendance updated successfully",
            ...result,
        });
    } catch (error: any) {
        console.error("Approve regularization error:", error);
        res.status(500).json({
            message: "Error approving regularization request",
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
                message: "Pending regularization request not found",
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
                message: "You can reject only your team member regularization requests",

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
        });

        // ✅ NEW: Push notification to employee
        await sendPushNotificationToUser(request.userId, title, message);

        await createAuditLog({
            tenantId,
            module: "Regularization",
            action: "Rejected",
            description: `${request.userId}'s attendance regularization for ${request.date} was rejected.`,
            performedById: approverId,
            performedBy: req.user?.email || "Admin",
            performedByRole: req.user?.role,
            targetUserId: request.userId,
            targetUser: `User ${request.userId}`,
            targetUserRole: "EMPLOYEE",
        });

        res.json({
            message: "Regularization request rejected successfully",
            request: updatedRequest,
        });
    } catch (error: any) {
        console.error("Reject regularization error:", error);
        res.status(500).json({
            message: "Error rejecting regularization request",
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
                message: 'Only admin can directly regularize attendance',
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

        const calculated = calculateRegularizedStatus(finalInTime, finalOutTime);

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
        });

        // ✅ NEW: Push notification to employee
        await sendPushNotificationToUser(userId, title, message);

        res.json({
            message: "Attendance directly regularized successfully",
            attendance,
        });
    } catch (error: any) {
        console.error("Force regularization error:", error);
        res.status(500).json({
            message: "Error directly regularizing attendance",
            error: error.message,
        });
    }
};