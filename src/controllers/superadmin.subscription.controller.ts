import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getAllSubscriptions = async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query;

    const where: any = {};
    if (search) {
      where.tenant = {
        name: { contains: String(search) },
      };
    }

    const subscriptions = await prisma.subscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        tenant: {
          select: { id: true, name: true, domain: true },
        },
        plan: true,
        payments: {
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    const now = new Date();

    const formatted = subscriptions.map((s) => {
      const end = new Date(s.endDate);
      const daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      let computedStatus = s.status;
      if (computedStatus !== "CANCELLED" && computedStatus !== "SUSPENDED") {
        if (daysRemaining <= 0) computedStatus = "EXPIRED";
        else if (daysRemaining <= 7) computedStatus = "EXPIRING_SOON";
      }

      return {
        id: s.id,
        tenantId: s.tenantId,
        companyName: s.tenant.name,
        companyDomain: s.tenant.domain,
        planId: s.planId,
        planName: s.plan.name,
        billingCycle: s.billingCycle,
        status: computedStatus,
        startDate: s.startDate,
        endDate: s.endDate,
        daysRemaining,
        autoRenew: s.autoRenew,
        lastPaymentAmount: s.payments[0]?.amount || 0,
        createdAt: s.createdAt,
      };
    });

    const filtered = status
      ? formatted.filter((s) => s.status === String(status))
      : formatted;

    return res.json({ subscriptions: filtered });
  } catch (error: any) {
    console.error("Get all subscriptions error:", error);
    return res.status(500).json({ message: "Failed to fetch subscriptions." });
  }
};

export const updateSubscription = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { planId, status, billingCycle, extendDays, newEndDate } = req.body;

    const sub = await prisma.subscription.findUnique({ where: { id } });
    if (!sub) {
      return res.status(404).json({ message: "Subscription not found." });
    }

    const data: any = {};
    if (planId) data.planId = planId;
    if (status) data.status = status;
    if (billingCycle) data.billingCycle = billingCycle;

    if (extendDays) {
      const currentEnd = new Date(sub.endDate);
      currentEnd.setDate(currentEnd.getDate() + Number(extendDays));
      data.endDate = currentEnd;
      if (data.status === "EXPIRED" || sub.status === "EXPIRED") {
        data.status = "ACTIVE";
      }
    } else if (newEndDate) {
      data.endDate = new Date(newEndDate);
    }

    const updated = await prisma.subscription.update({
      where: { id },
      data,
      include: { plan: true, tenant: true },
    });

    return res.json({ message: "Subscription updated successfully.", subscription: updated });
  } catch (error: any) {
    console.error("Update subscription error:", error);
    return res.status(500).json({ message: "Failed to update subscription." });
  }
};

export const assignSubscription = async (req: Request, res: Response) => {
  try {
    const { tenantId, planId, billingCycle, durationMonths } = req.body;

    if (!tenantId || !planId) {
      return res.status(400).json({ message: "Company and Plan are required." });
    }

    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      return res.status(404).json({ message: "Plan not found." });
    }

    const cycle = billingCycle === "YEARLY" ? "YEARLY" : "MONTHLY";
    const months = durationMonths ? Number(durationMonths) : cycle === "YEARLY" ? 12 : 1;

    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    const subscription = await prisma.subscription.create({
      data: {
        tenantId,
        planId,
        billingCycle: cycle,
        status: "ACTIVE",
        startDate,
        endDate,
        autoRenew: false,
      },
      include: { plan: true, tenant: true },
    });

    return res.status(201).json({
      message: "Subscription assigned successfully.",
      subscription,
    });
  } catch (error: any) {
    console.error("Assign subscription error:", error);
    return res.status(500).json({ message: "Failed to assign subscription." });
  }
};
