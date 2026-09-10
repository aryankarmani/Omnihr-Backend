import { Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthRequest } from "./auth";

const prisma = new PrismaClient();

/**
 * Middleware ensuring tenants with expired or suspended subscriptions
 * can only view (GET/HEAD) historical data, while blocking mutations (POST/PUT/PATCH/DELETE).
 */
export const checkSubscriptionStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return next();
    }

    // Allow all read-only access so users can review records
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    // Find current active or recent subscription
    const subscription = await prisma.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

    if (!subscription) {
      // If tenant has no subscription record yet, allow during legacy transition or warn
      return next();
    }

    const now = new Date();
    const isExpired = subscription.status === "EXPIRED" || new Date(subscription.endDate) < now;
    const isSuspended = subscription.status === "SUSPENDED" || subscription.status === "CANCELLED";

    if (isExpired) {
      return res.status(403).json({
        message: "Your subscription has expired. Modifying records is disabled. Please contact your administrator to renew.",
        subscriptionStatus: "EXPIRED",
        expiredAt: subscription.endDate,
      });
    }

    if (isSuspended) {
      return res.status(403).json({
        message: "Your subscription is currently suspended. Modifying records is disabled. Please contact your administrator.",
        subscriptionStatus: subscription.status,
      });
    }

    next();
  } catch (error) {
    console.error("Subscription check error:", error);
    next();
  }
};

/**
 * Capacity validation helper to prevent exceeding maximum employee count of assigned plan.
 */
export const verifyEmployeeCapacity = async (tenantId: string): Promise<{ allowed: boolean; current: number; max: number; message?: string }> => {
  const subscription = await prisma.subscription.findFirst({
    where: {
      tenantId,
      status: { in: ["ACTIVE", "EXPIRING_SOON"] },
    },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });

  const activeEmployeeCount = await prisma.employeeProfile.count({
    where: { tenantId, status: "ACTIVE" },
  });

  if (!subscription || !subscription.plan) {
    return { allowed: true, current: activeEmployeeCount, max: -1 };
  }

  const maxEmployees = subscription.plan.maxEmployees;

  // -1 or 0 signifies unlimited capacity (e.g. Enterprise)
  if (maxEmployees <= 0) {
    return { allowed: true, current: activeEmployeeCount, max: -1 };
  }

  if (activeEmployeeCount >= maxEmployees) {
    return {
      allowed: false,
      current: activeEmployeeCount,
      max: maxEmployees,
      message: `Employee limit of ${maxEmployees} reached for your ${subscription.plan.name} plan. Please upgrade your subscription to add more employees.`,
    };
  }

  return { allowed: true, current: activeEmployeeCount, max: maxEmployees };
};
