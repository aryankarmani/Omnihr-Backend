const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const fields = await prisma.customField.findMany();
  console.log(JSON.stringify(fields, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
