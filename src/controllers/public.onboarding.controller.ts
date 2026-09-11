import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import Razorpay from "razorpay";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Initialize Razorpay instance using keys from .env
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "",
});

// ============================================================
// STEP 1: CREATE RAZORPAY ORDER
// Called by landing page BEFORE showing the payment popup.
// Landing page sends: { planId OR planName, billingCycle }
// Returns: { orderId, amount, currency, keyId }
// ============================================================
export const createOrder = async (req: Request, res: Response) => {
  try {
    const { planId, planName, billingCycle } = req.body;

    if ((!planId && !planName) || !billingCycle) {
      return res
        .status(400)
        .json({ message: "planId or planName, and billingCycle are required." });
    }

    // Fetch the plan from DB — by ID or by name
    let plan;
    if (planId) {
      plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    } else {
      plan = await prisma.subscriptionPlan.findFirst({
        where: { name: { equals: planName } },
      });
    }

    if (!plan || !plan.isActive) {
      return res
        .status(404)
        .json({ message: `Plan "${planName || planId}" not found or inactive.` });
    }

    // Determine amount based on billing cycle (Razorpay expects amount in paise)
    const amount =
      billingCycle === "YEARLY"
        ? Math.round(plan.yearlyPrice * 100)
        : Math.round(plan.monthlyPrice * 100);

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount,
      currency: plan.currency || "INR",
      receipt: `receipt_${Date.now()}`,
      notes: {
        planId: plan.id,
        billingCycle,
      },
    });

    return res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      planName: plan.name,
      planId: plan.id,
    });
  } catch (error: any) {
    console.error("[createOrder] Error:", error);
    return res
      .status(500)
      .json({ message: "Failed to create payment order.", error: error.message });
  }
};

// ============================================================
// STEP 2: VERIFY PAYMENT & ONBOARD COMPANY
// Called by landing page AFTER Razorpay payment success.
// Landing page sends: {
//   razorpay_order_id, razorpay_payment_id, razorpay_signature,
//   companyName, adminName, email, planId, billingCycle
// }
// Returns: { success, domain, email, tempPassword }
// ============================================================
export const verifyAndOnboard = async (req: Request, res: Response) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      companyName,
      adminName,
      email,
      planId,
      planName,
      billingCycle,
    } = req.body;

    // --- Validate required fields ---
    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      !companyName ||
      !email ||
      (!planId && !planName)
    ) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    // --- Step 1: Verify Razorpay Payment Signature ---
    // This crypto check proves the payment is real and not faked
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return res
        .status(400)
        .json({ message: "Payment verification failed. Invalid signature." });
    }

    // --- Step 2: Check if company email already exists ---
    const existingTenant = await prisma.tenant.findFirst({
      where: { contactEmail: email },
    });

    if (existingTenant) {
      return res
        .status(409)
        .json({ message: "A company with this email already exists." });
    }

    // --- Step 3: Fetch the plan (by ID or name) ---
    let plan;
    if (planId) {
      plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    } else {
      plan = await prisma.subscriptionPlan.findFirst({
        where: { name: { equals: planName } },
      });
    }

    if (!plan) {
      return res.status(404).json({ message: "Plan not found." });
    }

    // --- Step 4: Generate a unique domain slug from company name ---
    const rawDomain = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    // Ensure domain is unique
    let domain = rawDomain;
    let domainExists = await prisma.tenant.findUnique({ where: { domain } });
    let counter = 1;
    while (domainExists) {
      domain = `${rawDomain}-${counter}`;
      domainExists = await prisma.tenant.findUnique({ where: { domain } });
      counter++;
    }

    // --- Step 5: Determine subscription dates ---
    const cycle = billingCycle === "YEARLY" ? "YEARLY" : "MONTHLY";
    const months = cycle === "YEARLY" ? 12 : 1;
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    // --- Step 6: Determine payment amount ---
    const amount =
      cycle === "YEARLY" ? plan.yearlyPrice : plan.monthlyPrice;

    // --- Step 7: Generate temp password for admin user ---
    const tempPassword = `Encalm@${Math.random().toString(36).slice(-6).toUpperCase()}`;
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // --- Step 8: Create everything in a single DB transaction ---
    const result = await prisma.$transaction(async (tx) => {
      // Create Tenant (the company)
      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          domain,
          plan: plan.name,
          contactEmail: email,
          contactPerson: adminName || companyName,
          isActive: true,
          status: "ACTIVE",
        },
      });

      // Create Subscription
      const subscription = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          billingCycle: cycle,
          status: "ACTIVE",
          startDate,
          endDate,
          autoRenew: false,
        },
      });

      // Create Payment record (this shows up in Superadmin panel)
      await tx.payment.create({
        data: {
          tenantId: tenant.id,
          subscriptionId: subscription.id,
          amount,
          currency: plan.currency || "INR",
          status: "PAID",
          paymentMethod: "ONLINE",
          gateway: "RAZORPAY",
          transactionId: razorpay_payment_id,
          notes: `Auto-onboarded via landing page. Order: ${razorpay_order_id}`,
          paidAt: new Date(),
        },
      });

      // Create default Admin Role for this tenant
      const adminRole = await tx.role.create({
        data: {
          name: "Admin",
          tenantId: tenant.id,
          accessibleModules:
            "HR,ATTENDANCE,PAYROLL,LEAVE,REPORTS,MASTERS,SETTINGS",
        },
      });

      // Create the Admin User for this company
      const user = await tx.user.create({
        data: {
          email,
          name: adminName || companyName,
          password: hashedPassword,
          tenantId: tenant.id,
          roleId: adminRole.id,
          isActive: true,
        },
      });

      return { tenant, subscription, user };
    });

    // --- Step 9: Return credentials to landing page ---
    return res.status(201).json({
      success: true,
      message: "Company onboarded successfully!",
      domain: result.tenant.domain,
      email,
      tempPassword, // landing page shows this to user or sends via email
      loginUrl: `https://${result.tenant.domain}.hrms.com/login`,
    });
  } catch (error: any) {
    console.error("[verifyAndOnboard] Error:", error);
    return res
      .status(500)
      .json({ message: "Onboarding failed.", error: error.message });
  }
};
