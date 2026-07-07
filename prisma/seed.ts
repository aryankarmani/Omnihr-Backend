import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    // 1. Create Tenant
    const tenant = await prisma.tenant.upsert({
        where: { domain: 'encalmit.com' },
        update: {},
        create: {
            name: 'Encalm Consultancy',
            domain: 'encalmit.com',
            plan: 'ENTERPRISE'
        }
    });

    console.log('Tenant:', tenant.id);

    // 2. Create Permissions & Roles
    // Create new Permission entries
    // const permissions = [
    //     { name: 'View Dashboard', code: 'DASHBOARD_VIEW', module: 'CORE' },
    //     { name: 'Manage Masters', code: 'MASTERS_MANAGE', module: 'ADMIN' },
    //     { name: 'View Employees', code: 'EMPLOYEE_VIEW', module: 'HR' },
    // ];
    const permissions = [
  { name: "View Dashboard", code: "DASHBOARD_VIEW", module: "DASHBOARD" },

  { name: "View Employees", code: "EMPLOYEE_VIEW", module: "EMPLOYEE" },
  { name: "Create Employee", code: "EMPLOYEE_CREATE", module: "EMPLOYEE" },
  { name: "Update Employee", code: "EMPLOYEE_UPDATE", module: "EMPLOYEE" },
  { name: "Delete Employee", code: "EMPLOYEE_DELETE", module: "EMPLOYEE" },

  { name: "View Attendance", code: "ATTENDANCE_VIEW", module: "ATTENDANCE" },
  { name: "Regularize Attendance", code: "ATTENDANCE_REGULARIZE", module: "ATTENDANCE" },
  { name: "Approve Attendance", code: "ATTENDANCE_APPROVE", module: "ATTENDANCE" },

  { name: "View Leave", code: "LEAVE_VIEW", module: "LEAVE" },
  { name: "Approve Leave", code: "LEAVE_APPROVE", module: "LEAVE" },
  { name: "Reject Leave", code: "LEAVE_REJECT", module: "LEAVE" },

  { name: "View Payroll", code: "PAYROLL_VIEW", module: "PAYROLL" },
  { name: "Download Payroll", code: "PAYROLL_DOWNLOAD", module: "PAYROLL" },

  { name: "View Team", code: "TEAM_VIEW", module: "TEAM" },
  { name: "Create Team", code: "TEAM_CREATE", module: "TEAM" },
  { name: "Update Team", code: "TEAM_UPDATE", module: "TEAM" },
  { name: "Manage Team Access Control", code: "TEAM_ACCESS_CONTROL", module: "TEAM" },

  { name: "Manage Masters", code: "MASTERS_MANAGE", module: "MASTERS" },
];

    for (const p of permissions) {
        await prisma.permission.upsert({
            where: { code: p.code },
            update: {},
            create: p
        });
    }

    // Roles with Permissions
    const adminRole = await prisma.role.upsert({
        where: { name_tenantId: { name: 'HR_ADMIN', tenantId: tenant.id } },
        update: {},
        create: {
            name: 'HR_ADMIN',
            tenantId: tenant.id,
            accessibleModules:
            'DASHBOARD,ATTENDANCE,EMPLOYEE,TEAM,LEAVE,REPORTS,MASTERS,TASK,MY_PROFILE,EMPLOYEE_ATTENDANCE',
            permissions: { connect: permissions.map(p => ({ code: p.code })) } // Connect all
        }
    });

    const empRole = await prisma.role.upsert({
        where: { name_tenantId: { name: 'EMPLOYEE', tenantId: tenant.id } },
        update: {},
        create: {
            name: 'EMPLOYEE',
            tenantId: tenant.id,
        }
    });

    // Hash passwords before seeding
    const hashedAdminPassword = await bcrypt.hash('password123', 10);
    const hashedEmployeePassword = await bcrypt.hash('password123', 10);

   // Admin
const admin = await prisma.user.upsert({
    where: {
        email_tenantId: {
            email: 'admin@example.com',
            tenantId: tenant.id,
        },
    },
    update: {
        password: hashedAdminPassword,
        name: 'System Admin',
        roleId: adminRole.id,
        isActive: true,
        deletedAt: null,
    },
    create: {
        email: 'admin@example.com',
        password: hashedAdminPassword,
        name: 'System Admin',
        tenantId: tenant.id,
        roleId: adminRole.id,
        isActive: true,
        deletedAt: null,
    },
});

// ✅ ADDED: Create employee profile for HR Admin/System Admin
await prisma.employeeProfile.upsert({
    where: {
        userId: admin.id,
    },
    update: {
        tenantId: tenant.id,
        title: 'System Admin',
        department: 'HR',
        location: 'Head Office',
        joiningDate: new Date(),
        status: 'Active',
        isActive: true,
        deletedAt: null,
    },
    create: {
        userId: admin.id,
        tenantId: tenant.id,
        title: 'System Admin',
        department: 'HR',
        location: 'Head Office',
        joiningDate: new Date(),
        status: 'Active',
        isActive: true,
        deletedAt: null,
    },
});

    // Employee
    const employee = await prisma.user.upsert({
        where: { email_tenantId: { email: 'employee@encalm.com', tenantId: tenant.id } },
        update: {
            password: hashedEmployeePassword,
        },
        create: {
            email: 'employee@encalm.com',
            password: hashedEmployeePassword,
            name: 'Raman Thakur',
            tenantId: tenant.id,
            roleId: empRole.id
        }
    });

    // 4. Masters Data
    // Company
    const company = await prisma.company.create({
        data: {
            tenantId: tenant.id,
            legalName: 'Encalm Consultancy Pvt Ltd',
            regAddress: 'Delhi Aerocity',
            locations: {
                create: [
                    { tenantId: tenant.id, name: 'Head Office', address: 'Aerocity', city: 'Delhi', state: 'Delhi', country: 'India', pincode: '110037', ptState: 'Delhi' },
                    { tenantId: tenant.id, name: 'Mumbai Branch', address: 'Andheri East', city: 'Mumbai', state: 'Maharashtra', country: 'India', pincode: '400069', ptState: 'Maharashtra' }
                ]
            },
            departments: {
                create: [
                    { tenantId: tenant.id, name: 'IT' },
                    { tenantId: tenant.id, name: 'HR' },
                    { tenantId: tenant.id, name: 'Operations' }
                ]
            },
            designations: {
                create: [
                    { tenantId: tenant.id, title: 'Software Engineer', grade: 'L1' },
                    { tenantId: tenant.id, title: 'HR Manager', grade: 'M1' }
                ]
            }
        }
    });

    // Statutory & Payroll
    console.log('Seeding Payroll Masters...');

    // 1. Statutory Settings
    await prisma.statutorySettings.upsert({
        where: { tenantId: tenant.id },
        update: {},
        create: {
            tenantId: tenant.id,
            epfEnabled: true,
            epfNumber: 'MH/BAN/0001234/000',
            epfWageCeiling: true,
            pfCeilingType: 'STATUTORY_15K',
            epfEmployeeRate: 12.0,
            epfEmployerRate: 3.67,
            epsEmployerRate: 8.33,
            edliEmployerRate: 0.5,
            adminChargesRate: 0.5,
            esicEnabled: true,
            esicNumber: '51000123450001001',
            esicWageLimit: 21000,
            esicEmployeeRate: 0.75,
            esicEmployerRate: 3.25
        }
    });

    // 2. Salary Components
    await prisma.salaryComponent.createMany({
        data: [
            { tenantId: tenant.id, name: 'Basic Salary', type: 'EARNING', calculationType: 'FLAT', value: 0, taxability: 'TAXABLE', isWageCodeComponent: true, isPartOfWages: true, isFBP: false, prorationMethod: 'CALENDAR_DAYS' },
            { tenantId: tenant.id, name: 'House Rent Allowance (HRA)', type: 'EARNING', calculationType: '%_BASIC', value: 50, taxability: 'PARTIAL', isWageCodeComponent: false, isPartOfWages: false, isFBP: false, prorationMethod: 'CALENDAR_DAYS' },
            { tenantId: tenant.id, name: 'Conveyance Allowance', type: 'EARNING', calculationType: 'FLAT', value: 1600, taxability: 'TAXABLE', isWageCodeComponent: false, isPartOfWages: false, isFBP: false, prorationMethod: 'CALENDAR_DAYS' },
            { tenantId: tenant.id, name: 'Medical Allowance', type: 'EARNING', calculationType: 'FLAT', value: 1250, taxability: 'TAXABLE', isWageCodeComponent: false, isPartOfWages: false, isFBP: false, prorationMethod: 'CALENDAR_DAYS' },
            { tenantId: tenant.id, name: 'Special Allowance', type: 'EARNING', calculationType: 'FLAT', value: 0, taxability: 'TAXABLE', isWageCodeComponent: false, isPartOfWages: true, isFBP: false, prorationMethod: 'CALENDAR_DAYS' },
            { tenantId: tenant.id, name: 'Provident Fund (Employee)', type: 'DEDUCTION', calculationType: 'FLAT', value: 0, taxability: 'FULLY_EXEMPT', isWageCodeComponent: false, isPartOfWages: false, isFBP: false, prorationMethod: 'CALENDAR_DAYS' },
            { tenantId: tenant.id, name: 'Professional Tax', type: 'DEDUCTION', calculationType: 'FLAT', value: 0, taxability: 'FULLY_EXEMPT', isWageCodeComponent: false, isPartOfWages: false, isFBP: false, prorationMethod: 'CALENDAR_DAYS' }
        ]
    });

    // 3. PT Slabs (Example: Maharashtra)
    const mhState = await prisma.state.findUnique({ where: { name: 'Maharashtra' } });
    if (mhState) {
        await prisma.professionalTaxSlab.createMany({
            data: [
                { tenantId: tenant.id, stateId: mhState.id, gender: 'MALE', minSalary: 0, maxSalary: 7500, taxAmount: 0 },
                { tenantId: tenant.id, stateId: mhState.id, gender: 'MALE', minSalary: 7501, maxSalary: 10000, taxAmount: 175 },
                { tenantId: tenant.id, stateId: mhState.id, gender: 'MALE', minSalary: 10001, maxSalary: 9999999, taxAmount: 200 }, // 300 in Feb not handled in simple slab yet
                { tenantId: tenant.id, stateId: mhState.id, gender: 'FEMALE', minSalary: 0, maxSalary: 10000, taxAmount: 0 },
                { tenantId: tenant.id, stateId: mhState.id, gender: 'FEMALE', minSalary: 10001, maxSalary: 9999999, taxAmount: 200 }
            ]
        });
    }

    // Attendance
    await prisma.shift.create({
        data: {
            tenantId: tenant.id,
            name: 'General Shift',
            startTime: '09:00',
            endTime: '18:00',
            breakDuration: 60,
            graceTime: 15
        }
    });

    await prisma.leaveType.createMany({
        data: [
            { tenantId: tenant.id, name: 'Casual Leave', code: 'CL', daysPerYear: 12 },
            { tenantId: tenant.id, name: 'Sick Leave', code: 'SL', daysPerYear: 10 },
            { tenantId: tenant.id, name: 'Earned Leave', code: 'EL', daysPerYear: 15 }
        ]
    });

    // Geo masters moved up

    console.log('Seed completed successfully');
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
