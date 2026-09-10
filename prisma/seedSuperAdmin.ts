import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Super Admin and default SaaS plans...");

  // 1. Seed or update Super Admin
  const adminEmail = "superadmin@encalm.com";
  const hashedPassword = await bcrypt.hash("SuperAdmin@2026!", 10);

  const superAdmin = await prisma.superAdmin.upsert({
    where: { email: adminEmail },
    update: {
      password: hashedPassword,
      name: "Platform Owner",
      role: "SUPER_ADMIN",
      isActive: true,
    },
    create: {
      email: adminEmail,
      password: hashedPassword,
      name: "Platform Owner",
      role: "SUPER_ADMIN",
      isActive: true,
      forcePasswordChange: false,
    },
  });
  console.log("Super Admin ready:", superAdmin.email);

  // 2. Seed Default Plans (Basic, Pro, Enterprise) - NO TRIAL
  const plans = [
    {
      name: "Basic",
      description: "Core HR & Attendance for small teams",
      monthlyPrice: 999,
      yearlyPrice: 9990,
      currency: "INR",
      maxEmployees: 25,
      features: JSON.stringify(["DASHBOARD", "EMPLOYEES", "ATTENDANCE", "MY_PROFILE"]),
      isActive: true,
    },
    {
      name: "Pro",
      description: "Complete HR, Attendance, Leave, Payroll & Reports for growing companies",
      monthlyPrice: 2499,
      yearlyPrice: 24990,
      currency: "INR",
      maxEmployees: 100,
      features: JSON.stringify(["DASHBOARD", "EMPLOYEES", "ATTENDANCE", "LEAVE", "PAYROLL", "REPORTS", "TEAMS", "MY_PROFILE"]),
      isActive: true,
    },
    {
      name: "Enterprise",
      description: "All features, unlimited employee capacity, custom fields & dedicated support",
      monthlyPrice: 5999,
      yearlyPrice: 59990,
      currency: "INR",
      maxEmployees: -1, // Unlimited
      features: JSON.stringify(["DASHBOARD", "EMPLOYEES", "ATTENDANCE", "LEAVE", "PAYROLL", "REPORTS", "TEAMS", "MASTERS", "CUSTOM_FIELDS", "DEDICATED_SLA", "AUDIT_LOGS", "MY_PROFILE"]),
      isActive: true,
    },
  ];

  for (const p of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { name: p.name },
      update: p,
      create: p,
    });
  }
  console.log("Subscription plans seeded.");

  // 3. Ensure Existing Tenant has active Enterprise subscription
  const existingTenant = await prisma.tenant.findFirst({
    where: { domain: "encalm" },
  });

  if (existingTenant) {
    const enterprisePlan = await prisma.subscriptionPlan.findUnique({
      where: { name: "Enterprise" },
    });

    if (enterprisePlan) {
      const activeSub = await prisma.subscription.findFirst({
        where: {
          tenantId: existingTenant.id,
          status: "ACTIVE",
        },
      });

      if (!activeSub) {
        const now = new Date();
        const oneYearLater = new Date();
        oneYearLater.setFullYear(now.getFullYear() + 1);

        const newSub = await prisma.subscription.create({
          data: {
            tenantId: existingTenant.id,
            planId: enterprisePlan.id,
            billingCycle: "YEARLY",
            status: "ACTIVE",
            startDate: now,
            endDate: oneYearLater,
            autoRenew: false,
          },
        });

        await prisma.payment.create({
          data: {
            tenantId: existingTenant.id,
            subscriptionId: newSub.id,
            amount: enterprisePlan.yearlyPrice,
            currency: "INR",
            status: "PAID",
            paymentMethod: "ONLINE",
            gateway: "MANUAL",
            transactionId: `INIT-ENCALM-${Date.now().toString().slice(-6)}`,
            notes: "Initial SaaS subscription setup for platform owner tenant",
            paidAt: now,
          },
        });

        console.log("Active Enterprise subscription created for existing tenant:", existingTenant.name);
      }
    }
  }

  console.log("Super Admin seed complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
