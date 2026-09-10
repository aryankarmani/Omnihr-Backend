import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getAllCompanies = async (req: Request, res: Response) => {
  try {
    const { search, status, plan } = req.query;

    const whereCondition: any = {};

    if (search) {
      whereCondition.OR = [
        { name: { contains: String(search) } },
        { domain: { contains: String(search) } },
        { contactEmail: { contains: String(search) } },
      ];
    }

    const tenants = await prisma.tenant.findMany({
      where: whereCondition,
      orderBy: { createdAt: "desc" },
      include: {
        users: {
          where: {
            role: {
              name: { in: ["HR_ADMIN", "Admin", "HR Admin", "ADMIN"] },
            },
          },
          select: { id: true, name: true, email: true },
          take: 1,
        },
        subscriptions: {
          take: 1,
          orderBy: { createdAt: "desc" },
          include: { plan: true },
        },
        _count: {
          select: {
            employeeProfiles: true,
          },
        },
      },
    });

    const now = new Date();

    const companies = tenants.map((t) => {
      const sub = t.subscriptions[0];
      const hrAdmin = t.users[0];

      let subStatus = sub ? sub.status : "INACTIVE";
      let daysRemaining = 0;

      if (sub) {
        const end = new Date(sub.endDate);
        daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysRemaining <= 0) subStatus = "EXPIRED";
        else if (daysRemaining <= 7) subStatus = "EXPIRING_SOON";
      }

      return {
        id: t.id,
        name: t.name,
        domain: t.domain,
        logo: t.logo,
        isActive: t.isActive,
        hrAdminName: hrAdmin?.name || "Not Assigned",
        hrAdminEmail: hrAdmin?.email || t.contactEmail || "N/A",
        planName: sub?.plan?.name || "No Plan",
        billingCycle: sub?.billingCycle || "N/A",
        subscriptionStatus: subStatus,
        startDate: sub?.startDate || null,
        expiryDate: sub?.endDate || null,
        daysRemaining,
        employeeCount: t._count.employeeProfiles,
        maxEmployees: sub?.plan?.maxEmployees ?? -1,
        createdAt: t.createdAt,
      };
    });

    // Optional status filter
    const filtered = status
      ? companies.filter((c) => c.subscriptionStatus === String(status))
      : companies;

    return res.json({ companies: filtered });
  } catch (error: any) {
    console.error("Get all companies error:", error);
    return res.status(500).json({ message: "Failed to fetch companies." });
  }
};

export const getCompanyById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          where: {
            role: {
              name: { in: ["HR_ADMIN", "Admin", "HR Admin", "ADMIN"] },
            },
          },
          select: { id: true, name: true, email: true, createdAt: true },
        },
        subscriptions: {
          orderBy: { createdAt: "desc" },
          include: {
            plan: true,
            notifications: {
              orderBy: { createdAt: "desc" },
              take: 10,
            },
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          include: {
            subscription: { include: { plan: true } },
          },
        },
        _count: {
          select: {
            employeeProfiles: true,
            users: true,
          },
        },
      },
    });

    if (!tenant) {
      return res.status(404).json({ message: "Company not found." });
    }

    const currentSub = tenant.subscriptions[0];
    const now = new Date();
    let daysRemaining = 0;
    let status = currentSub?.status || "INACTIVE";

    if (currentSub) {
      const end = new Date(currentSub.endDate);
      daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysRemaining <= 0) status = "EXPIRED";
      else if (daysRemaining <= 7) status = "EXPIRING_SOON";
    }

    return res.json({
      company: {
        id: tenant.id,
        name: tenant.name,
        domain: tenant.domain,
        logo: tenant.logo,
        contactEmail: tenant.contactEmail,
        contactPhone: tenant.contactPhone,
        contactPerson: tenant.contactPerson,
        isActive: tenant.isActive,
        createdAt: tenant.createdAt,
        hrAdmins: tenant.users,
        employeeCount: tenant._count.employeeProfiles,
        userCount: tenant._count.users,
        currentSubscription: currentSub
          ? {
              id: currentSub.id,
              planName: currentSub.plan.name,
              planDescription: currentSub.plan.description,
              monthlyPrice: currentSub.plan.monthlyPrice,
              yearlyPrice: currentSub.plan.yearlyPrice,
              maxEmployees: currentSub.plan.maxEmployees,
              features: JSON.parse(currentSub.plan.features || "[]"),
              billingCycle: currentSub.billingCycle,
              status,
              startDate: currentSub.startDate,
              endDate: currentSub.endDate,
              daysRemaining,
              autoRenew: currentSub.autoRenew,
            }
          : null,
        subscriptionHistory: tenant.subscriptions,
        payments: tenant.payments.map((p) => ({
          id: p.id,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          paymentMethod: p.paymentMethod,
          gateway: p.gateway,
          transactionId: p.transactionId,
          notes: p.notes,
          paidAt: p.paidAt,
          createdAt: p.createdAt,
          plan: p.subscription?.plan?.name || "Standard",
        })),
        recentNotifications: currentSub?.notifications || [],
      },
    });
  } catch (error: any) {
    console.error("Get company details error:", error);
    return res.status(500).json({ message: "Failed to fetch company details." });
  }
};

export const updateCompanyStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const updated = await prisma.tenant.update({
      where: { id },
      data: { isActive: Boolean(isActive) },
    });

    return res.json({
      message: `Company ${updated.isActive ? "activated" : "deactivated"} successfully.`,
      company: updated,
    });
  } catch (error: any) {
    console.error("Update company status error:", error);
    return res.status(500).json({ message: "Failed to update company status." });
  }
};
