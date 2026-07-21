import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { notifyAdmins, createNotification } from '../utils/notification';
import { getManagerTeamMemberIds } from "../utils/teamScope";
import { sendPushNotificationToUser } from "./pushNotification.controller";
import { createAuditLog } from "../utils/auditLog";

const prisma = new PrismaClient();

const sendLeaveRequestPushToApprovers = async ({
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
      where: {
        id: employeeUserId,
        tenantId,
      },
      select: {
        managerId: true,
      },
    });

    // ✅ Find HR_ADMIN and SYSTEM_ADMIN users
    const admins = await prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        deletedAt: null,
        role: {
          name: {
            in: ["HR_ADMIN", "SYSTEM_ADMIN"],
          },
        },
      },
      select: {
        id: true,
      },
    });

    const approverIds = new Set<number>();

    // ✅ Add admins
    admins.forEach((admin) => approverIds.add(admin.id));

    // ✅ Add direct manager if employee has manager
    if (employee?.managerId) {
      approverIds.add(employee.managerId);
    }

    // ✅ Send push notification to all approvers
    await Promise.all(
      Array.from(approverIds).map((id) =>
        sendPushNotificationToUser(id, title, body)
      )
    );
  } catch (error) {
    console.error("Leave approver push notification error:", error);
  }
};

// Get leave balances for the authenticated user
export const getLeaveBalances = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        const tenantId = (req as any).user?.tenantId;

        if (!userId || !tenantId) return res.status(401).json({ message: 'Unauthorized' });

        // Fetch all leave types for the tenant
        const leaveTypes = await prisma.leaveType.findMany({
            where: {
                tenantId,
                code: {
                    in: ['CL', 'SL', 'EL']
                }
            },
            distinct: ['code']
        });

        // Fetch approved leaves for the user to calculate taken days (FOR CURRENT YEAR ONLY)
        const currentYear = new Date().getFullYear();
        const startOfYear = new Date(currentYear, 0, 1);
        const endOfYear = new Date(currentYear, 11, 31);

        const approvedLeaves = await prisma.leave.findMany({
            where: {
                userId,
                status: 'APPROVED',
                startDate: {
                    gte: startOfYear,
                    lte: endOfYear
                }
            }
        });

        const balances = leaveTypes.map(type => {
            const taken = approvedLeaves
                .filter(l => l.leaveTypeId === type.id)
                .reduce((acc, curr) => {
                    const days = Math.ceil((curr.endDate.getTime() - curr.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                    return acc + days;
                }, 0);

            return {
                id: type.id,
                name: type.name,
                code: type.code,
                total: type.daysPerYear,
                taken,
                balance: type.daysPerYear - taken
            };
        });

        res.json(balances);
    } catch (error) {
        console.error('Error fetching leave balances:', error);
        res.status(500).json({ message: 'Server error' });
    }
};



// Get leave history for the authenticated user
export const getLeaveHistory = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        const tenantId = (req as any).user?.tenantId;
        const userRole = (req as any).user?.role;
        const { all, employeeId } = req.query;

        if (!userId || !tenantId) return res.status(401).json({ message: 'Unauthorized' });

        // If HR_ADMIN and employeeId given, return that specific employee's leaves
        if (employeeId && userRole === 'HR_ADMIN') {
            const targetUserId = Number(employeeId);
            const leaves = await prisma.leave.findMany({
                where: { userId: targetUserId, tenantId },
                include: { leaveType: true, user: { select: { id: true, name: true, email: true, employeeProfile: true } } },
                orderBy: { createdAt: 'desc' }
            });
            return res.json(leaves);
        }

        // If HR_ADMIN and all=true, return all leaves for the tenant
        let whereClause: any = {
            userId,
            tenantId,
        };

        if (all === "true" && userRole === "HR_ADMIN") {
            whereClause = { tenantId };
        }

        // NEW: MANAGER scoped leave approvals
        if (all === "true" && userRole === "MANAGER") {
            const memberIds = await getManagerTeamMemberIds(tenantId, userId);

            whereClause = {
                tenantId,
                userId: {
                    in: memberIds,
                },
            };
        }

        const leaves = await prisma.leave.findMany({
            where: whereClause,
            include: {
                leaveType: true,
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        employeeProfile: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(leaves);
    } catch (error) {
        console.error('Error fetching leave history:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Apply for leave
export const applyLeave = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        const tenantId = (req as any).user?.tenantId;

        if (!userId || !tenantId) return res.status(401).json({ message: 'Unauthorized' });

        const { leaveTypeCode, startDate, endDate, reason } = req.body;

        if (!leaveTypeCode || !startDate || !endDate || !reason) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        // ✅ Find the leave type for current tenant
        let leaveType = await prisma.leaveType.findFirst({
            where: {
                code: leaveTypeCode,
                tenantId,
            },
        });

        // ✅ If leave types are missing after DB reset,
        // auto-create default leave types for this tenant.
        if (!leaveType) {
            const defaultLeaveTypes = [
                { name: "Casual Leave", code: "CL", daysPerYear: 12 },
                { name: "Sick Leave", code: "SL", daysPerYear: 10 },
                { name: "Earned Leave", code: "EL", daysPerYear: 15 },
                { name: "Leave Without Pay", code: "LWP", daysPerYear: 0 },
            ];

            for (const item of defaultLeaveTypes) {
                await prisma.leaveType.create({
                    data: {
                        tenantId,
                        name: item.name,
                        code: item.code,
                        daysPerYear: item.daysPerYear,
                    },
                });
            }

            // ✅ Find again after creating defaults
            leaveType = await prisma.leaveType.findFirst({
                where: {
                    code: leaveTypeCode,
                    tenantId,
                },
            });
        }

        if (!leaveType) {
            return res.status(404).json({
                message: "Leave type not found",
            });
        }

        const newLeave = await prisma.leave.create({
            data: {
                userId,
                tenantId,
                leaveTypeId: leaveType.id,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                reason,
                status: 'PENDING'
            }
        });
        const employee = await prisma.user.findFirst({
            where: { id: userId, tenantId },
            select: { name: true },
        });

        const title = "New Leave Request";
        const message = `${employee?.name || "Employee"} requested ${leaveType.name
            } from ${startDate} to ${endDate}.`;

        // ✅ OLD: In-app notification for admins
        await notifyAdmins({
            tenantId,
            title,
            message,
            type: "leave",
        });

        await sendLeaveRequestPushToApprovers({
            tenantId,
            employeeUserId: Number(userId),
            title,
            body: message,
        });

        await createAuditLog({
            tenantId,
            module: "Leave",
            action: "Requested",
            description: `${employee?.name || "Employee"} requested ${leaveType.name} from ${startDate} to ${endDate}.`,
            performedById: userId,
            performedBy: employee?.name || "Employee",
            performedByRole: (req as any).user?.role,
            targetUserId: userId,
            targetUser: employee?.name || "Employee",
            targetUserRole: "EMPLOYEE",
        });


        res.status(201).json(newLeave);
    } catch (error) {
        console.error('Error applying for leave:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update leave status (Admin/Manager)
export const updateLeaveStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status, rejectionReason } = req.body;
        const tenantId = (req as any).user?.tenantId;

        if (!tenantId) return res.status(401).json({ message: 'Unauthorized' });

        if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
      return res.status(400).json({ message: "Invalid leave status" });
    }

        const updatedLeave = await prisma.leave.update({
            where: { id: Number(id), tenantId },
            data: {
                status,
                rejectionReason: status === 'REJECTED' ? rejectionReason : null
            },
            include: {
                leaveType: true,
                user: {
                    select: { id: true, name: true },
                },
            },
        });

         // ✅ Security check: make sure leave belongs to same tenant
    if (updatedLeave.tenantId !== tenantId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const title = "Leave Status Updated";
    const message = `Your ${
      updatedLeave.leaveType?.name || "leave"
    } request has been ${status}.`;

         // ✅ OLD: In-app notification for employee
    await createNotification({
      tenantId,
      userId: updatedLeave.userId,
      title,
      message,
      type: "leave",
    });

        await sendPushNotificationToUser(updatedLeave.userId, title, message);

        await createAuditLog({
            tenantId,
            module: "Leave",
            action: status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Rejected" : "Updated",
            description: `${updatedLeave.user.name}'s ${updatedLeave.leaveType?.name || "leave"} request was ${status.toLowerCase()}.`,
            performedById: (req as any).user?.id,
            performedBy: (req as any).user?.name || "Admin",
            performedByRole: (req as any).user?.role,
            targetUserId: updatedLeave.userId,
            targetUser: updatedLeave.user.name,
            targetUserRole: "EMPLOYEE",
        });

        res.json(updatedLeave);
    } catch (error) {
        console.error('Error updating leave status:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
