import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { domain: "encalm" },
    update: {},
    create: {
      name: "EnCalm HRMS",
      domain: "encalm",
      plan: "FREE",
    },
  });

  const adminRole = await prisma.role.upsert({
    where: {
      name_tenantId: {
        name: "HR_ADMIN",
        tenantId: tenant.id,
      },
    },
    update: {},
    create: {
      name: "HR_ADMIN",
      tenantId: tenant.id,
      accessibleModules: "HR,ATTENDANCE,LEAVE,TEAM,MASTERS,DASHBOARD",
    },
  });

  const employeeRole = await prisma.role.upsert({
    where: {
      name_tenantId: {
        name: "EMPLOYEE",
        tenantId: tenant.id,
      },
    },
    update: {},
    create: {
      name: "EMPLOYEE",
      tenantId: tenant.id,
      accessibleModules: "ATTENDANCE,LEAVE,DASHBOARD",
    },
  });

  await prisma.user.upsert({
    where: {
      email_tenantId: {
        email: "admin@encalm.com",
        tenantId: tenant.id,
      },
    },
    update: {
      password: await bcrypt.hash("Admin@123", 10),
      roleId: adminRole.id,
    },
    create: {
      name: "HR Admin",
      email: "admin@encalm.com",
      password: await bcrypt.hash("Admin@123", 10),
      tenantId: tenant.id,
      roleId: adminRole.id,
    },
  });

  await prisma.user.upsert({
    where: {
      email_tenantId: {
        email: "employee@encalm.com",
        tenantId: tenant.id,
      },
    },
    update: {
      password: await bcrypt.hash("Employee@123", 10),
      roleId: employeeRole.id,
    },
    create: {
      name: "Employee User",
      email: "employee@encalm.com",
      password: await bcrypt.hash("Employee@123", 10),
      tenantId: tenant.id,
      roleId: employeeRole.id,
    },
  });

  console.log("Admin login: admin@encalm.com / Admin@123");
  console.log("Employee login: employee@encalm.com / Employee@123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());