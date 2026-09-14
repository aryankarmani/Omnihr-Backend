import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const plans = [
    {
      name: "Starter",
      description: "For growing startups and small businesses looking to digitize HR.",
      monthlyPrice: 4000,
      yearlyPrice: 25000,
      currency: "INR",
      maxEmployees: 25,
      features: JSON.stringify(["Employee Directory & Records","Smart Attendance & Check-ins","Standard Leave Management","Basic Document Vault (5GB)","Standard Payslip Generation","Email & Community Support"]),
      isActive: true,
    },
    {
      name: "Growth",
      description: "For scaling companies that need multi-tier payroll, custom policies, and audits.",
      monthlyPrice: 6999,
      yearlyPrice: 35000,
      currency: "INR",
      maxEmployees: 150,
      features: JSON.stringify(["Automated Multi-Tier Payroll Engine","Biometric & Geofenced Attendance","Custom Leave Rules & Multi-Level Approvals","Digital Signatures & Unlimited Vault","Advanced Workforce Analytics & Audit Logs","Priority 24/7 Support & Onboarding"]),
      isActive: true,
    },
    {
      name: "Enterprise",
      description: "For large organizations requiring bespoke compliance, SLA guarantees, and integrations.",
      monthlyPrice: 0,
      yearlyPrice: 0,
      currency: "INR",
      maxEmployees: -1,
      features: JSON.stringify(["Tailored Statutory Compliance & Filings","Dedicated Account Manager & Migration","Custom API Access & Webhooks","Enterprise Single Sign-On (SSO / SAML)","99.9% Uptime SLA & Custom Agreements","SOC-2 & ISO Data Security Audits"]),
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
