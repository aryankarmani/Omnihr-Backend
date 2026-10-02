import { Request, Response } from "express";
import { PrismaClient , AuditLog} from "@prisma/client";

const prisma = new PrismaClient();

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 10));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const actionType = typeof req.query.actionType === "string" && req.query.actionType !== "All" ? req.query.actionType.trim() : "";
    const status = typeof req.query.status === "string" && req.query.status !== "All" ? req.query.status.trim() : "";

    const where: any = { tenantId };

    if (actionType) {
      where.module = { contains: actionType, mode: "insensitive" };
    }

    if (status) {
      where.action = { contains: status, mode: "insensitive" };
    }

    if (search) {
      where.OR = [
        { module: { contains: search, mode: "insensitive" } },
        { action: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { performedBy: { contains: search, mode: "insensitive" } },
        { targetUser: { contains: search, mode: "insensitive" } },
      ];
    }

    const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;

    if (isPaginated) {
      const skip = (page - 1) * limit;
      const [total, logs] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
      ]);

      const formattedLogs = logs.map((log: AuditLog) => ({
        id: log.id,
        dateTime: new Date(log.createdAt).toLocaleString(),
        module: log.module,
        action: log.action,
        description: log.description,
        performedBy: log.performedBy,
        performedByRole: log.performedByRole || "",
        targetUser: log.targetUser || "",
        targetUserRole: log.targetUserRole || "",
      }));

      return res.json({
        data: formattedLogs,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    }

    // Legacy unpaginated fallback (for mobile or legacy calls)
    const logs = await prisma.auditLog.findMany({
      where,
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