import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getAllPayments = async (req: Request, res: Response) => {
  try {
    const { search, status, gateway } = req.query;

    const where: any = {};
    if (status) where.status = String(status);
    if (gateway) where.gateway = String(gateway);
    if (search) {
      where.OR = [
        { transactionId: { contains: String(search) } },
        { tenant: { name: { contains: String(search) } } },
      ];
    }

    const payments = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        tenant: {
          select: { id: true, name: true, domain: true },
        },
        subscription: {
          include: { plan: true },
        },
      },
    });

    const formatted = payments.map((p) => ({
      id: p.id,
      tenantId: p.tenantId,
      companyName: p.tenant.name,
      companyDomain: p.tenant.domain,
      planName: p.subscription?.plan?.name || "Custom Tier",
      billingCycle: p.subscription?.billingCycle || "N/A",
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      paymentMethod: p.paymentMethod,
      gateway: p.gateway,
      transactionId: p.transactionId || `TXN-${p.id.slice(0, 8)}`,
      notes: p.notes,
      paidAt: p.paidAt || p.createdAt,
      createdAt: p.createdAt,
    }));

    return res.json({ payments: formatted });
  } catch (error: any) {
    console.error("Get all payments error:", error);
    return res.status(500).json({ message: "Failed to fetch payments." });
  }
};

export const recordManualPayment = async (req: Request, res: Response) => {
  try {
    const { tenantId, companyName, subscriptionId, amount, currency, paymentMethod, transactionId, notes, paidAt, status } = req.body;

    if ((!tenantId && !companyName) || amount === undefined) {
      return res.status(400).json({ message: "Company Name and Amount are required." });
    }

    let resolvedTenantId = tenantId;

    if (!resolvedTenantId && companyName) {
      const trimmedName = String(companyName).trim();
      let tenant = await prisma.tenant.findFirst({
        where: {
          OR: [
            { name: { equals: trimmedName, mode: "insensitive" } },
            { domain: { equals: trimmedName.toLowerCase().replace(/[^a-z0-9]/g, ""), mode: "insensitive" } },
          ],
        },
      });

      if (!tenant) {
        const cleanDomain = trimmedName.toLowerCase().replace(/[^a-z0-9]/g, "") || "company";
        const uniqueDomain = `${cleanDomain}-${Date.now().toString().slice(-4)}`;
        tenant = await prisma.tenant.create({
          data: {
            name: trimmedName,
            domain: uniqueDomain,
            plan: "STARTER",
          },
        });
      }

      resolvedTenantId = tenant.id;
    }

    const payment = await prisma.payment.create({
      data: {
        tenantId: resolvedTenantId,
        subscriptionId: subscriptionId || null,
        amount: Number(amount),
        currency: currency || "INR",
        status: status || "PAID",
        paymentMethod: paymentMethod || "BANK_TRANSFER",
        gateway: "MANUAL",
        transactionId: transactionId || `MANUAL-${Date.now().toString().slice(-6)}`,
        notes: notes || "",
        paidAt: paidAt ? new Date(paidAt) : new Date(),
      },
      include: {
        tenant: true,
        subscription: { include: { plan: true } },
      },
    });

    return res.status(201).json({
      message: "Payment successfully recorded.",
      payment,
    });
  } catch (error: any) {
    console.error("Record payment error:", error);
    return res.status(500).json({ message: "Failed to record payment." });
  }
};
