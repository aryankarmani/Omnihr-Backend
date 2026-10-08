import { PrismaClient } from '@prisma/client';

declare const process: any;

const prisma = new PrismaClient();

async function main() {
    console.log('Starting Manual Seed for Geo & PT...');

    // 1. Get Tenant
    const tenant = await prisma.tenant.findUnique({ where: { domain: 'encalmit.com' } });
    if (!tenant) throw new Error('Tenant not found');

    // 2. Seed States
    const states = [
        { name: 'Maharashtra', code: 'MH', cities: ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Aurangabad'] },
        { name: 'Delhi', code: 'DL', cities: ['New Delhi', 'North Delhi', 'South Delhi'] },
        { name: 'Karnataka', code: 'KA', cities: ['Bangalore', 'Mysore', 'Mangalore', 'Hubli'] },
        { name: 'Tamil Nadu', code: 'TN', cities: ['Chennai', 'Coimbatore', 'Madurai', 'Trichy'] },
        { name: 'Telangana', code: 'TG', cities: ['Hyderabad', 'Warangal', 'Nizamabad'] },
        { name: 'Uttar Pradesh', code: 'UP', cities: ['Lucknow', 'Kanpur', 'Noida', 'Varanasi', 'Agra'] },
        { name: 'Gujarat', code: 'GJ', cities: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot'] },
        { name: 'West Bengal', code: 'WB', cities: ['Kolkata', 'Howrah', 'Siliguri'] },
        { name: 'Rajasthan', code: 'RJ', cities: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota'] },
        { name: 'Haryana', code: 'HR', cities: ['Gurgaon', 'Faridabad', 'Panipat'] }
    ];

    for (const stateData of states) {
        console.log(`Seeding State: ${stateData.name}`);
        const state = await prisma.state.upsert({
            where: { name: stateData.name },
            update: {},
            create: { name: stateData.name, code: stateData.code }
        });

        for (const cityName of stateData.cities) {
            await prisma.city.upsert({
                where: { name_stateId: { name: cityName, stateId: state.id } },
                update: {},
                create: { name: cityName, stateId: state.id }
            });
        }
    }

    // 3. Seed PT Slabs (MH)
    const mhState = await prisma.state.findUnique({ where: { name: 'Maharashtra' } });
    if (mhState) {
        console.log('Seeding PT Slabs for MH...');
        // Clear existing to avoid dupes if any (though we found 0)
        await prisma.professionalTaxSlab.deleteMany({ where: { tenantId: tenant.id, stateId: mhState.id } });

        await prisma.professionalTaxSlab.createMany({
            data: [
                { tenantId: tenant.id, stateId: mhState.id, gender: 'MALE', minSalary: 0, maxSalary: 7500, taxAmount: 0 },
                { tenantId: tenant.id, stateId: mhState.id, gender: 'MALE', minSalary: 7501, maxSalary: 10000, taxAmount: 175 },
                { tenantId: tenant.id, stateId: mhState.id, gender: 'MALE', minSalary: 10001, maxSalary: 9999999, taxAmount: 200 },
                { tenantId: tenant.id, stateId: mhState.id, gender: 'FEMALE', minSalary: 0, maxSalary: 10000, taxAmount: 0 },
                { tenantId: tenant.id, stateId: mhState.id, gender: 'FEMALE', minSalary: 10001, maxSalary: 9999999, taxAmount: 200 }
            ]
        });
        console.log('PT Slabs seeded.');
    }

    console.log('Manual Seed Completed.');
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
