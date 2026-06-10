import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { notifyAdmins,createNotification} from '../utils/notification';
import { getManagerTeamMemberIds } from "../utils/teamScope";

const prisma = new PrismaClient();

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

        // Find the leave type ID
        const leaveType = await prisma.leaveType.findFirst({
            where: { code: leaveTypeCode, tenantId }
        });

        if (!leaveType) {
            return res.status(404).json({ message: 'Leave type not found' });
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

        await notifyAdmins({
            tenantId,
            title: 'New Leave Request',
            message: `${employee?.name || 'Employee'} requested ${leaveType.name} from ${startDate} to ${endDate}.`,
            type: 'leave',
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
         await createNotification({
      tenantId,
      userId: updatedLeave.userId,
      title: 'Leave Status Updated',
      message: `Your ${updatedLeave.leaveType?.name || 'leave'} request has been ${status}.`,
      type: 'leave',
    });

        res.json(updatedLeave);
    } catch (error) {
        console.error('Error updating leave status:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
