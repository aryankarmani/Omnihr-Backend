import { Request, Response } from "express";
import { PrismaClient , AuditLog} from "@prisma/client";

const prisma = new PrismaClient();

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const logs = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return res.json(
     logs.map((log: AuditLog) => ({
        id: log.id,
        dateTime: new Date(log.createdAt).toLocaleString(),
        module: log.module,
        action: log.action,
        description: log.description,
        performedBy: log.performedBy,
        performedByRole: log.performedByRole || "",
        targetUser: log.targetUser || "",
        targetUserRole: log.targetUserRole || "",
      }))
    );
  } catch (error: any) {
    return res.status(500).json({
      message: "Failed to fetch audit logs",
      error: error.message,
    });
  }
};