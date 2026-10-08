import { PrismaClient } from '@prisma/client';

declare const process: any;

const prisma = new PrismaClient();

const permissions = [
    // HR & Core
    { name: 'View Employees', code: 'EMPLOYEE_VIEW', module: 'HR' },
    { name: 'Create Employee', code: 'EMPLOYEE_CREATE', module: 'HR' },
    { name: 'Edit Employee', code: 'EMPLOYEE_EDIT', module: 'HR' },
    { name: 'Delete Employee', code: 'EMPLOYEE_DELETE', module: 'HR' },

    // Attendance
    { name: 'View Attendance', code: 'ATTENDANCE_VIEW', module: 'ATTENDANCE' },
    { name: 'Edit Attendance', code: 'ATTENDANCE_EDIT', module: 'ATTENDANCE' },
    { name: 'Correction', code: 'ATTENDANCE_REGULARIZE', module: 'ATTENDANCE' },

    // Leave
    { name: 'View Leaves', code: 'LEAVE_VIEW', module: 'LEAVE' },
    { name: 'Apply Leave', code: 'LEAVE_APPLY', module: 'LEAVE' },
    { name: 'Approve Leaves', code: 'LEAVE_APPROVE', module: 'LEAVE' },

    // Payroll
    { name: 'View Payroll', code: 'PAYROLL_VIEW', module: 'PAYROLL' },
    { name: 'Process Payroll', code: 'PAYROLL_PROCESS', module: 'PAYROLL' },
    { name: 'Download Payslips', code: 'PAYROLL_DOWNLOAD', module: 'PAYROLL' },

    // Recruitment
    { name: 'View Jobs', code: 'JOB_VIEW', module: 'RECRUITMENT' },
    { name: 'Create Job', code: 'JOB_CREATE', module: 'RECRUITMENT' },
    { name: 'View Applicants', code: 'CANDIDATE_VIEW', module: 'RECRUITMENT' },
    { name: 'Schedule Interview', code: 'INTERVIEW_SCHEDULE', module: 'RECRUITMENT' },

    // Assets
    { name: 'View Assets', code: 'ASSET_VIEW', module: 'ASSETS' },
    { name: 'Allocate Asset', code: 'ASSET_ALLOCATE', module: 'ASSETS' },

    // Helpdesk
    { name: 'View Tickets', code: 'TICKET_VIEW', module: 'HELPDESK' },
    { name: 'Resolve Tickets', code: 'TICKET_RESOLVE', module: 'HELPDESK' },

    // Reports
    { name: 'View HR Reports', code: 'REPORT_HR', module: 'REPORTS' },
    { name: 'View Finance Reports', code: 'REPORT_FINANCE', module: 'REPORTS' },

    // Settings & Masters
    { name: 'View Masters', code: 'MASTERS_VIEW', module: 'SETTINGS' },
    { name: 'Edit Masters', code: 'MASTERS_EDIT', module: 'SETTINGS' },
    { name: 'Manage Access', code: 'ACCESS_MANAGE', module: 'SETTINGS' },
];

async function main() {
    console.log('Seeding Permissions...');

    for (const p of permissions) {
        await prisma.permission.upsert({
            where: { code: p.code },
            update: {},
            create: p
        });
    }

    console.log('Permissions seeded.');
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
