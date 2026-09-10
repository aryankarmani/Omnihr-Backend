import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getAllPlans = async (req: Request, res: Response) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: { monthlyPrice: "asc" },
      include: {
        _count: {
          select: { subscriptions: true },
        },
      },
    });

    const formatted = plans.map((p) => {
      let parsedFeatures = [];
      try {
        parsedFeatures = JSON.parse(p.features || "[]");
      } catch (e) {
        parsedFeatures = [];
      }

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        monthlyPrice: p.monthlyPrice,
        yearlyPrice: p.yearlyPrice,
        currency: p.currency,
        maxEmployees: p.maxEmployees,
        features: parsedFeatures,
        isActive: p.isActive,
        subscribersCount: p._count.subscriptions,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });

    return res.json({ plans: formatted });
  } catch (error: any) {
    console.error("Get all plans error:", error);
    return res.status(500).json({ message: "Failed to fetch subscription plans." });
  }
};

export const createPlan = async (req: Request, res: Response) => {
  try {
    const { name, description, monthlyPrice, yearlyPrice, currency, maxEmployees, features, isActive } = req.body;

    if (!name || monthlyPrice === undefined || yearlyPrice === undefined) {
      return res.status(400).json({ message: "Plan name, monthly price, and yearly price are required." });
    }

    const existing = await prisma.subscriptionPlan.findUnique({
      where: { name: String(name).trim() },
    });

    if (existing) {
      return res.status(400).json({ message: `A plan with the name '${name}' already exists.` });
    }

    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: String(name).trim(),
        description: description || "",
        monthlyPrice: Number(monthlyPrice),
        yearlyPrice: Number(yearlyPrice),
        currency: currency || "INR",
        maxEmployees: maxEmployees !== undefined ? Number(maxEmployees) : 25,
        features: Array.isArray(features) ? JSON.stringify(features) : JSON.stringify([]),
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
    });

    return res.status(201).json({ message: "Subscription plan created successfully.", plan });
  } catch (error: any) {
    console.error("Create plan error:", error);
    return res.status(500).json({ message: "Failed to create plan." });
  }
};

export const updatePlan = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, monthlyPrice, yearlyPrice, currency, maxEmployees, features, isActive } = req.body;

    const data: any = {};
    if (name) data.name = String(name).trim();
    if (description !== undefined) data.description = description;
    if (monthlyPrice !== undefined) data.monthlyPrice = Number(monthlyPrice);
    if (yearlyPrice !== undefined) data.yearlyPrice = Number(yearlyPrice);
    if (currency) data.currency = currency;
    if (maxEmployees !== undefined) data.maxEmployees = Number(maxEmployees);
    if (features !== undefined) {
      data.features = Array.isArray(features) ? JSON.stringify(features) : features;
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const updated = await prisma.subscriptionPlan.update({
      where: { id },
      data,
    });

    return res.json({ message: "Plan updated successfully.", plan: updated });
  } catch (error: any) {
    console.error("Update plan error:", error);
    return res.status(500).json({ message: "Failed to update plan." });
  }
};
