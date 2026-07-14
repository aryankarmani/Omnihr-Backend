const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== USERS ===");
  const users = await prisma.user.findMany({
    include: {
      role: true,
      employeeProfile: true
    }
  });
  console.log(JSON.stringify(users, null, 2));

  console.log("=== TENANTS ===");
  const tenants = await prisma.tenant?.findMany();
  console.log(tenants);

  console.log("=== ROLES ===");
  const roles = await prisma.role.findMany();
  console.log(roles);

  console.log("=== DEPARTMENTS ===");
  const depts = await prisma.department.findMany();
  console.log(depts);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
