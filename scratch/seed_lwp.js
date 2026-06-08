const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const tenants = await prisma.tenant.findMany();
    console.log(`Found ${tenants.length} tenants. Checking/adding LWP leave type...`);
    
    for (const tenant of tenants) {
        const existing = await prisma.leaveType.findFirst({
            where: { tenantId: tenant.id, code: 'LWP' }
        });
        
        if (!existing) {
            await prisma.leaveType.create({
                data: {
                    tenantId: tenant.id,
                    name: 'Leave Without Pay',
                    code: 'LWP',
                    daysPerYear: 365,
                    accrualFrequency: 'YEARLY',
                    carryForward: false,
                    isMaternity: false,
                    sandwichRule: false,
                    noticePeriodDays: 0,
                    allowDuringNoticePeriod: true
                }
            });
            console.log(`Successfully created LWP leave type for tenant: ${tenant.name} (${tenant.id})`);
        } else {
            console.log(`LWP leave type already exists for tenant: ${tenant.name} (${tenant.id})`);
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
