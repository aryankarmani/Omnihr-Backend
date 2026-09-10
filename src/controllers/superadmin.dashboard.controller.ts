import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getSuperAdminDashboard = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 1. Total Companies count
    const totalCompanies = await prisma.tenant.count();

    // 2. Subscriptions metrics
    const allSubscriptions = await prisma.subscription.findMany({
      include: {
        tenant: {
          select: { id: true, name: true, domain: true, logo: true },
        },
        plan: true,
      },
    });

    let activeSubscriptions = 0;
    let expiringSoon = 0;
    let expired = 0;

    const expiringList: any[] = [];

    for (const sub of allSubscriptions) {
      const end = new Date(sub.endDate);
      const daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysRemaining <= 0 || sub.status === "EXPIRED") {
        expired++;
      } else if (daysRemaining <= 7 && daysRemaining > 0) {
        expiringSoon++;
        activeSubscriptions++;
        expiringList.push({
          id: sub.id,
          companyName: sub.tenant.name,
          domain: sub.tenant.domain,
          planName: sub.plan.name,
          endDate: sub.endDate,
          daysRemaining,
          status: "EXPIRING_SOON",
        });
      } else if (sub.status === "ACTIVE") {
        activeSubscriptions++;
      }
    }

    // Sort expiring by urgency
    expiringList.sort((a, b) => a.daysRemaining - b.daysRemaining);

    // 3. Revenue calculation from real payments
    const paidPayments = await prisma.payment.findMany({
      where: { status: "PAID" },
      orderBy: { paidAt: "desc" },
      include: {
        tenant: { select: { id: true, name: true, domain: true } },
        subscription: { include: { plan: true } },
      },
    });

    let totalRevenue = 0;
    let thisMonthRevenue = 0;

    for (const p of paidPayments) {
      const amt = Number(p.amount) || 0;
      totalRevenue += amt;

      const pDate = p.paidAt ? new Date(p.paidAt) : new Date(p.createdAt);
      if (pDate >= startOfCurrentMonth) {
        thisMonthRevenue += amt;
      }
    }

    // 4. Monthly Revenue trajectory for chart (last 6 calendar months)
    const chartData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const monthLabel = d.toLocaleString("en-US", { month: "short" });

      const monthSum = paidPayments
        .filter((p) => {
          const pDate = p.paidAt ? new Date(p.paidAt) : new Date(p.createdAt);
          return pDate >= d && pDate < nextD;
        })
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      chartData.push({
        month: monthLabel,
        revenue: monthSum,
      });
    }

    // 5. Recent registered companies
    const recentCompanies = await prisma.tenant.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        subscriptions: {
          take: 1,
          orderBy: { createdAt: "desc" },
          include: { plan: true },
        },
        _count: {
          select: { employeeProfiles: true },
        },
      },
    });

    // 6. Recent payments / purchases
    const recentPayments = paidPayments.slice(0, 5).map((p) => ({
      id: p.id,
      company: p.tenant.name,
      plan: p.subscription?.plan?.name || "Standard",
      amount: p.amount,
      currency: p.currency,
      date: p.paidAt || p.createdAt,
      status: p.status,
      transactionId: p.transactionId,
      gateway: p.gateway,
    }));

    return res.json({
      cards: {
        totalCompanies,
        activeSubscriptions,
        expiringSoon,
        expired,
        totalRevenue,
        thisMonthRevenue,
      },
      chartData,
      recentPayments,
      recentCompanies: recentCompanies.map((c) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        plan: c.subscriptions[0]?.plan?.name || "Free",
        status: c.subscriptions[0]?.status || "ACTIVE",
        employeeCount: c._count.employeeProfiles,
        createdAt: c.createdAt,
      })),
      expiringSubscriptions: expiringList.slice(0, 5),
    });
  } catch (error: any) {
    console.error("Super Admin dashboard error:", error);
    return res.status(500).json({ message: "Failed to load dashboard metrics." });
  }
};
