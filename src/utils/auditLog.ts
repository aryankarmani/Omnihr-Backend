import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type AuditLogInput = {
  tenantId: string;
  module: string;
  action: string;
  description: string;

  performedById?: number;
  performedBy?: string;
  performedByRole?: string;

  targetUserId?: number;
  targetUser?: string;
  targetUserRole?: string;
};

export const createAuditLog = async (data: AuditLogInput) => {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: data.tenantId,
        module: data.module,
        action: data.action,
        description: data.description,

        performedById: data.performedById || null,
        performedBy: data.performedBy || "System",
        performedByRole: data.performedByRole || null,

        targetUserId: data.targetUserId || null,
        targetUser: data.targetUser || null,
        targetUserRole: data.targetUserRole || null,
      },
    });
  } catch (error) {
    console.error("Audit log failed:", error);
  }
};