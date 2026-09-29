import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const plans = [
    {
      name: "Starter",
      description: "For Startups & Small Teams looking to digitize HR.",
      monthlyPrice: 2499,
      yearlyPrice: 20000,
      currency: "INR",
      maxEmployees: 25,
      features: JSON.stringify([
        "Up to 25 Employees included",
        "Core Employee Records & Directory",
        "Attendance & Leave Request portal",
        "Basic salary slip generator",
        "Standard email support",
        "₹99/month per extra employee"
      ]),
      isActive: true,
    },
    {
      name: "Growth",
      description: "For Growing Businesses needing automated payroll, biometric tracking, and compliance.",
      monthlyPrice: 6999,
      yearlyPrice: 35000,
      currency: "INR",
      maxEmployees: 100,
      features: JSON.stringify([
        "Everything in Starter included",
        "Up to 100 Employees included",
        "Full Automated Payroll with Tax Slabs",
        "Biometric Device Integration API",
        "Encrypted Document Locker for all staff",
        "Role-Based Access (Multi-manager approval)",
        "Priority 24/7 chat support",
        "₹79/month per extra employee • 99.9% uptime SLA"
      ]),
      isActive: true,
    },
    {
      name: "Enterprise",
      description: "For large organizations requiring bespoke compliance, SLA guarantees, and integrations.",
      monthlyPrice: 0,
      yearlyPrice: 0,
      currency: "INR",
      maxEmployees: -1,
      features: JSON.stringify([
        "Tailored Statutory Compliance & Filings",
        "Dedicated Account Manager & Migration",
        "Custom API Access & Webhooks",
        "Enterprise Single Sign-On (SSO / SAML)",
        "99.9% Uptime SLA & Custom Agreements",
        "SOC-2 & ISO Data Security Audits"
      ]),
      isActive: true,
    },
  ];
  for (const oldName of ["Basic", "Pro"]) {
    try {
      const ex = await prisma.subscriptionPlan.findUnique({ where: { name: oldName } });
      if (ex) { await prisma.subscriptionPlan.delete({ where: { name: oldName } }); console.log("Deleted: " + oldName); }
    } catch(e: any) { console.log("Skip delete " + oldName + ": " + e.message); }
  }
  for (const p of plans) {
    const r = await prisma.subscriptionPlan.upsert({ where: { name: p.name }, update: p, create: p });
    console.log("OK: " + r.name);
  }
  console.log("Plans seeded!");
}
main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
