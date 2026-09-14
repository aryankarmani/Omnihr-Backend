import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    tenantId: string;
    roleId?: number;
    role?: string;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "secret"
    ) as AuthRequest["user"];

    req.user = decoded;

    // Check if tenant subscription is suspended or tenant is deactivated
    if (decoded?.tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: decoded.tenantId },
        select: {
          isActive: true,
          subscriptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { status: true },
          },
        },
      });

      if (tenant) {
        if (!tenant.isActive) {
          return res.status(403).json({
            code: "COMPANY_DEACTIVATED",
            message: "This company account has been deactivated by the platform administrator.",
          });
        }

        const latestSub = tenant.subscriptions[0];
        if (latestSub && latestSub.status === "SUSPENDED") {
          return res.status(403).json({
            code: "SUBSCRIPTION_SUSPENDED",
            message: "Your company subscription has been suspended by the platform administrator. Access to services is temporarily frozen.",
          });
        }
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};
// ADDED: Role permission middleware
export const authorize = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role;

    if (!role) {
      return res.status(403).json({ message: "Role not found in token" });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        message: "You do not have permission to perform this action",
      });
    }

    next();
  };
};