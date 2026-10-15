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
        code: "PERMISSION_DENIED",
        message: "You don't have access to this",
      });
    }

    next();
  };
};

// Central Granular Permission Middleware
export const checkUserHasPermission = async (
  userId: number,
  permissionCodes: string | string[]
): Promise<boolean> => {
  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: {
          select: {
            name: true,
            permissions: {
              select: { code: true }
            }
          }
        }
      }
    });

    if (!dbUser || !dbUser.role) return false;
    const roleName = String(dbUser.role.name || "").toUpperCase();
    if (roleName === "SUPER_ADMIN" || roleName === "HR_ADMIN" || roleName === "ADMIN" || roleName === "SYSTEM_ADMIN") {
      return true;
    }

    const codes = Array.isArray(permissionCodes) ? permissionCodes : [permissionCodes];
    const userCodes = dbUser.role.permissions.map(p => p.code);
    return codes.some(c => userCodes.includes(c));
  } catch (err) {
    console.error("[checkUserHasPermission error]", err);
    return false;
  }
};

export const requirePermission = (permissionCode: string | string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const role = String(user.role || "").toUpperCase();
      // Admins automatically bypass permission checks
      if (role === "SUPER_ADMIN" || role === "HR_ADMIN" || role === "ADMIN" || role === "SYSTEM_ADMIN") {
        return next();
      }

      // Check DB permissions for user's role
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          role: {
            select: {
              name: true,
              permissions: {
                select: { code: true }
              }
            }
          }
        }
      });

      if (!dbUser || !dbUser.role) {
        return res.status(403).json({
          code: "PERMISSION_DENIED",
          message: "You don't have access to this"
        });
      }

      const codes = Array.isArray(permissionCode) ? permissionCode : [permissionCode];
      const hasCode = dbUser.role.permissions.some(p => codes.includes(p.code));
      if (!hasCode) {
        return res.status(403).json({
          code: "PERMISSION_DENIED",
          message: "You don't have access to this"
        });
      }

      next();
    } catch (err: any) {
      console.error("[requirePermission error]", err);
      return res.status(500).json({ message: "Internal authorization error" });
    }
  };
};

export const requireProfessionalPlan = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return next();

    const role = String(req.user?.role || "").toUpperCase();
    if (role === "SUPER_ADMIN") return next();

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscriptions: {
          where: { status: { in: ["ACTIVE", "EXPIRING_SOON"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { plan: true },
        },
      },
    });

    const activeSubPlan = tenant?.subscriptions[0]?.plan?.name;
    const planName = String(activeSubPlan || tenant?.plan || "Growth").toUpperCase();

    // Professional, Growth, and Enterprise plans grant chat access
    const isPro = planName.includes("GROWTH") || planName.includes("PRO") || planName.includes("ENTERPRISE");

    if (!isPro) {
      return res.status(403).json({
        code: "PLAN_UPGRADE_REQUIRED",
        message: "OmniHR Chat, Voice/Video Calling, and Windows Desktop Alerts are exclusive to the Professional Plan. Please upgrade to unlock this feature.",
      });
    }

    next();
  } catch (err) {
    console.error("[requireProfessionalPlan error]", err);
    next();
  }
};