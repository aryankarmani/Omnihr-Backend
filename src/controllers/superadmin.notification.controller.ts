import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  NOTIFICATION_INTERVALS,
  sendManualExpiryReminder,
  processSubscriptionExpiryReminders,
} from "../services/subscriptionNotification.service";

const prisma = new PrismaClient();

export const getNotificationOverview = async (req: Request, res: Response) => {
  try {
    const now = new Date();

    // 1. Get all active & expiring subscriptions with days remaining
    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: { in: ["ACTIVE", "EXPIRING_SOON"] },
      },
      include: {
        tenant: {
          select: { id: true, name: true, domain: true, contactEmail: true },
        },
        plan: true,
      },
      orderBy: { endDate: "asc" },
    });

    const expiringCompanies = subscriptions
      .map((s) => {
        const end = new Date(s.endDate);
        const daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return {
          id: s.id,
          tenantId: s.tenantId,
          companyName: s.tenant.name,
          companyDomain: s.tenant.domain,
          contactEmail: s.tenant.contactEmail,
          planName: s.plan.name,
          endDate: s.endDate,
          daysRemaining,
          status: daysRemaining <= 0 ? "EXPIRED" : daysRemaining <= 7 ? "EXPIRING_SOON" : s.status,
        };
      })
      .filter((c) => c.daysRemaining <= 30); // show companies within 30 days of expiry

    // 2. Notification dispatch history
    const history = await prisma.subscriptionNotification.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
      include: {
        tenant: { select: { id: true, name: true, domain: true } },
        subscription: { include: { plan: true } },
      },
    });

    const formattedHistory = history.map((h) => ({
      id: h.id,
      companyName: h.tenant.name,
      planName: h.subscription?.plan?.name || "Standard",
      notificationType: h.notificationType,
      channel: h.channel,
      status: h.status,
      message: h.message,
      sentAt: h.sentAt || h.createdAt,
    }));

    return res.json({
      scheduleConfig: NOTIFICATION_INTERVALS,
      expiringCompanies,
      history: formattedHistory,
      stats: {
        totalDispatched: history.filter((h) => h.status === "SENT").length,
        pending: history.filter((h) => h.status === "PENDING").length,
        failed: history.filter((h) => h.status === "FAILED").length,
      },
    });
  } catch (error: any) {
    console.error("Get notification overview error:", error);
    return res.status(500).json({ message: "Failed to load notifications data." });
  }
};

export const sendManualNotification = async (req: Request, res: Response) => {
  try {
    const { subscriptionId, customMessage } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ message: "Subscription ID is required." });
    }

    const result = await sendManualExpiryReminder(subscriptionId, customMessage);
    return res.json(result);
  } catch (error: any) {
    console.error("Send manual reminder error:", error);
    return res.status(500).json({ message: error.message || "Failed to dispatch reminder." });
  }
};

export const triggerExpiryCheck = async (req: Request, res: Response) => {
  try {
    await processSubscriptionExpiryReminders();
    return res.json({ message: "Subscription expiry check executed successfully." });
  } catch (error: any) {
    console.error("Trigger expiry check error:", error);
    return res.status(500).json({ message: "Failed to execute expiry check." });
  }
};
