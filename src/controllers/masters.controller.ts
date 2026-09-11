import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Generic handler for fetching all records of a master
export const getAll = (model: string) => async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        // @ts-ignore
        let data = await prisma[model].findMany({
            where: { tenantId }
        });

        // ✅ UPDATED: convert title to name for frontend
        if (model === 'designation') {
            data = data.map((item: any) => ({
                ...item,
                name: item.title,
            }));
        }
        res.json(data);
    } catch (error: any) {
        res.status(500).json({
            error: 'Failed to fetch data',
            details: error.message,
        });
    }
};

export const createHoliday = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;

        const {
            name,
            date,
            type,
            isOptional,
            stateId,
        } = req.body;

        if (!name || !date) {
            return res.status(400).json({
                error: "Holiday name and date are required",
            });
        }

        const holiday = await prisma.holiday.create({
            data: {
                tenantId,

                name,

                date: new Date(date),

                type: type || "PUBLIC",

                isOptional: isOptional || false,

                stateId: stateId ? Number(stateId) : null,
            },
        });

        res.status(201).json(holiday);
    } catch (error: any) {
        console.error("Holiday create error:", error);

        res.status(500).json({
            error: "Failed to create holiday",
            details: error.message,
        });
    }
};

// Generic handler for creating a record
export const create = (model: string) => async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;

        // FIX: frontend sends name, but Designation schema needs title
        if (model === 'designation') {
            if (req.body.name && !req.body.title) {
                req.body.title = req.body.name;
            }

            delete req.body.name;
            delete req.body.reportTo;
        }
        // @ts-ignore
        const data = await prisma[model].create({
            data: { ...req.body, tenantId }
        });
        
        if (model === 'designation') {
            return res.json({
                ...data,
                name: data.title,
            });
        }
        res.json(data);
    } catch (error: any) {
        res.status(500).json({
            error: 'Failed to create record',
            details: error.message,
        });
    }
};

export const update = (model: string) => async (req: Request, res: Response) => {
    try {
        const { tenantId } = (req as any).user;
        const { id } = req.params;

        if (model === 'designation') {
            if (req.body.name && !req.body.title) {
                req.body.title = req.body.name;
            }

            delete req.body.name;
            delete req.body.reportTo;
        }

        // @ts-ignore
        await prisma[model].updateMany({
            where: { id, tenantId },
            data: req.body,
        });

        // @ts-ignore
        const updated = await prisma[model].findFirst({
            where: { id, tenantId },
        });
       
        if (model === 'designation' && updated) {
            return res.json({
                ...updated,
                name: updated.title,
            });
        }

        res.json(updated);
    } catch (error: any) {
        res.status(500).json({
            error: 'Failed to update record',
            details: error.message,
        });
    }
};

export const remove = (model: string) => async (req: Request, res: Response) => {
    try {
        const { tenantId } = (req as any).user;
        const { id } = req.params;

        // @ts-ignore
        await prisma[model].deleteMany({
            where: { id, tenantId },
        });

        res.json({ message: 'Deleted successfully' });
    } catch (error: any) {
        res.status(500).json({
            error: 'Failed to delete record',
            details: error.message,
        });
    }
};


// COMPANY
export const getCompany = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const company = await prisma.company.findFirst({
            where: { tenantId },
            include: { locations: true, departments: true, designations: true }
        });
        res.json(company);
    } catch (error: any) {
        res.status(500).json({
            error: "Failed to fetch company",
            details: error.message
        });
       
    }
};

export const updateCompany = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { legalName, cin, pan, tan, gstin, regAddress, website, logo, primaryColor, secondaryColor } = req.body;

        // Upsert company
        const company = await prisma.company.findFirst({ where: { tenantId } });

        if (company) {
            const updated = await prisma.company.update({
                where: { id: company.id },
                data: { legalName, cin, pan, tan, gstin, regAddress, website, logo, primaryColor, secondaryColor }
            });
            res.json(updated);
        } else {
            const newCompany = await prisma.company.create({
                data: {
                    tenantId, legalName: legalName || 'Default Company', cin, pan, tan, gstin, regAddress, website, logo, primaryColor, secondaryColor
                }
            });
            res.json(newCompany);
        }
    } catch (error: any) {
        
        res.status(500).json({
            error: "Failed to update company",
            details: error.message
        });
        
    }
};



// SPECIFIC CONTROLLERS FOR NESTED LOGIC

export const createLocation = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { companyId, ...data } = req.body;
        // Ensure company belongs to tenant
        const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
        if (!company) return res.status(404).json({ error: "Company not found" });

        const location = await prisma.location.create({
            data: { ...data, companyId, tenantId }
        });
        res.json(location);
    }  catch (error: any) {
        res.status(500).json({ error: "Failed to create location", details: error.message, });
    }
}

export const createDepartment = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { companyId, ...data } = req.body;
        const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
        if (!company) return res.status(404).json({ error: "Company not found" });

        const dept = await prisma.department.create({
            data: { ...data, companyId, tenantId }
        });
        res.json(dept);
    }  catch (error: any) {
        res.status(500).json({ error: "Failed to create department", details: error.message });
    }
}


// GEO MASTERS
export const getStates = async (req: Request, res: Response) => {
    try {
        const states = await prisma.state.findMany({ orderBy: { name: 'asc' } });
        res.json(states);
    } catch (error: any) {
        res.status(500).json({ error: "Failed to fetch states", details: error.message });
    } 
}

export const getCities = async (req: Request, res: Response) => {
    try {
        const { stateId } = req.query;
        if (!stateId) return res.status(400).json({ error: "State ID is required" });

        const cities = await prisma.city.findMany({
            where: { stateId: Number(stateId) },
            orderBy: { name: 'asc' }
        });
        res.json(cities);
    } catch (error: any) {
        res.status(500).json({ error: "Failed to fetch cities", details: error.message });
    }
}

// ATTENDANCE & LEAVE MASTERS

// Attendance Polcy
export const getAttendancePolicy = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const policy = await prisma.attendancePolicy.findUnique({ where: { tenantId } });
        res.json(policy || {});
    } 
    catch (error: any) { res.status(500).json({ error: "Failed to fetch policy", details: error.message }); }
};

export const updateAttendancePolicy = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const policy = await prisma.attendancePolicy.upsert({
            where: { tenantId },
            update: req.body,
            create: { ...req.body, tenantId }
        });
        res.json(policy);
    } catch (error) { res.status(500).json({ error: "Failed to update policy" }); }
};

// ACCESS CONTROL
const STANDARD_PERMISSIONS = [
    // 1. DASHBOARD
    { name: "View Dashboard", code: "DASHBOARD_VIEW", module: "DASHBOARD", description: "View analytics overview and key metrics" },
    { name: "Export Dashboard", code: "DASHBOARD_EXPORT", module: "DASHBOARD", description: "Export dashboard summary data and reports" },

    // 2. ATTENDANCE (My Attendance)
    { name: "View My Attendance", code: "ATTENDANCE_VIEW", module: "ATTENDANCE", description: "View self attendance logs, shifts & hours" },
    { name: "Regularize Attendance", code: "ATTENDANCE_REGULARIZE", module: "ATTENDANCE", description: "Apply for attendance regularizations" },
    { name: "Approve Attendance", code: "ATTENDANCE_APPROVE", module: "ATTENDANCE", description: "Approve attendance regularization requests" },

    // 3. EMPLOYEE_ATTENDANCE
    { name: "View Employee Attendance", code: "EMPLOYEE_ATTENDANCE_VIEW", module: "EMPLOYEE_ATTENDANCE", description: "View organizational and team member attendance records" },
    { name: "Manage Employee Attendance", code: "EMPLOYEE_ATTENDANCE_MANAGE", module: "EMPLOYEE_ATTENDANCE", description: "Manual attendance override, shift assignments & approvals" },

    // 4. EMPLOYEE (Employee List)
    { name: "View Employees", code: "EMPLOYEE_VIEW", module: "EMPLOYEE", description: "View employee directory, profiles & employment info" },
    { name: "Create Employee", code: "EMPLOYEE_CREATE", module: "EMPLOYEE", description: "Onboard and create new employee records" },
    { name: "Update Employee", code: "EMPLOYEE_UPDATE", module: "EMPLOYEE", description: "Edit employee profiles, designations & details" },
    { name: "Delete Employee", code: "EMPLOYEE_DELETE", module: "EMPLOYEE", description: "Deactivate or remove employee profiles" },

    // 5. TEAM
    { name: "View Team", code: "TEAM_VIEW", module: "TEAM", description: "View department teams, members & managers" },
    { name: "Create Team", code: "TEAM_CREATE", module: "TEAM", description: "Create new teams and project groups" },
    { name: "Update Team", code: "TEAM_UPDATE", module: "TEAM", description: "Assign managers, edit teams and restructure members" },
    { name: "Manage Team Access Control", code: "TEAM_ACCESS_CONTROL", module: "TEAM", description: "Configure manager permissions and boundary controls" },

    // 6. LEAVE
    { name: "View Leave", code: "LEAVE_VIEW", module: "LEAVE", description: "View leave balances and leave requests" },
    { name: "Apply Leave", code: "LEAVE_APPLY", module: "LEAVE", description: "Submit leave applications for self" },
    { name: "Approve Leave", code: "LEAVE_APPROVE", module: "LEAVE", description: "Approve pending leave requests" },
    { name: "Reject Leave", code: "LEAVE_REJECT", module: "LEAVE", description: "Reject leave requests with comments" },

    // 7. PAYROLL
    { name: "View Payroll", code: "PAYROLL_VIEW", module: "PAYROLL", description: "View payroll summaries and salary structures" },
    { name: "Process Payroll", code: "PAYROLL_PROCESS", module: "PAYROLL", description: "Execute monthly payroll runs and statutory deductions" },
    { name: "Download Payroll", code: "PAYROLL_DOWNLOAD", module: "PAYROLL", description: "Download payslips, tax sheets & bank export files" },

    // 8. REPORTS
    { name: "View Reports", code: "REPORTS_VIEW", module: "REPORTS", description: "Access standard HR and attendance reports" },
    { name: "Export Reports", code: "REPORTS_EXPORT", module: "REPORTS", description: "Export custom analytics, Excel & PDF reports" },

    // 9. MASTERS
    { name: "View Masters", code: "MASTERS_VIEW", module: "MASTERS", description: "View organizational masters, policies & statutory settings" },
    { name: "Manage Masters", code: "MASTERS_MANAGE", module: "MASTERS", description: "Configure companies, branches, designations & roles" },

    // 10. TASK
    { name: "View Tasks", code: "TASK_VIEW", module: "TASK", description: "View assigned tasks and project boards" },
    { name: "Manage Tasks", code: "TASK_MANAGE", module: "TASK", description: "Create, assign, update and close tasks" },

    // 11. MY_PROFILE
    { name: "View My Profile", code: "MY_PROFILE_VIEW", module: "MY_PROFILE", description: "View self profile, documents and credentials" },
    { name: "Edit My Profile", code: "MY_PROFILE_EDIT", module: "MY_PROFILE", description: "Update personal contact info, bank details & avatar" },
];

export const getPermissions = async (req: Request, res: Response) => {
    try {
        let permissions = await prisma.permission.findMany({
            orderBy: [
                { module: "asc" },
                { name: "asc" }
            ]
        });

        // If permissions are missing, seed standard ones
        if (permissions.length < STANDARD_PERMISSIONS.length) {
            for (const p of STANDARD_PERMISSIONS) {
                await prisma.permission.upsert({
                    where: { code: p.code },
                    update: { name: p.name, module: p.module, description: p.description },
                    create: p,
                });
            }
            permissions = await prisma.permission.findMany({
                orderBy: [
                    { module: "asc" },
                    { name: "asc" }
                ]
            });
        }

        res.json(permissions);
    } catch (error) {
        console.error("Get permissions error:", error);
        res.status(500).json({ error: "Failed to fetch permissions" });
    }
};

export const getRoles = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const roles = await prisma.role.findMany({
            where: {
                tenantId,
                NOT: {
                    name: "MANAGER",
                },
            },
            include: { permissions: true }
        });
        res.json(roles);
    } catch (error) {
        console.error("Get roles error:", error);
        res.status(500).json({ error: "Failed to fetch roles" });
    }
};

export const createRole = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { name, permissionIds = [], accessibleModules = "" } = req.body;

        // ✅ Manager role should not be created from Masters
        if (String(name).trim().toUpperCase() === "MANAGER") {
            return res.status(400).json({
                error: "MANAGER role is not allowed. Manager access is handled from Team Access Control.",
            });
        }

        const normalizeModule = (m: any) => {
            const s = String(m || "").trim().toUpperCase();
            if (s === "EMPLOYEES" || s === "HR") return "EMPLOYEE";
            if (s === "SETTINGS" || s === "ADMIN") return "MASTERS";
            return s;
        };

        // Clean and normalize accessible modules
        const moduleArray = Array.isArray(accessibleModules)
            ? accessibleModules
            : typeof accessibleModules === "string"
                ? accessibleModules.split(",")
                : [];
        const cleanModules = Array.from(
            new Set(moduleArray.map(normalizeModule).filter(Boolean))
        );
        const accessibleModulesStr = cleanModules.join(",");

        // Validate permissions against enabled modules (only grant permissions for accessible modules)
        let validPermissionIds: string[] = [];
        if (Array.isArray(permissionIds) && permissionIds.length > 0) {
            const requestedPermissions = await prisma.permission.findMany({
                where: { id: { in: permissionIds } }
            });
            validPermissionIds = requestedPermissions
                .filter(p => cleanModules.includes(p.module.toUpperCase()))
                .map(p => p.id);
        }
       
        const role = await prisma.role.create({
            data: {
                name: String(name).trim(),
                tenantId,
                accessibleModules: accessibleModulesStr,
                permissions: {
                    connect: validPermissionIds.map((id: string) => ({ id }))
                }
            },
            include: { permissions: true }
        });
        res.json(role);
    } catch (error: any) {
        console.error("Create role error:", error);
        res.status(500).json({
            error: "Failed to create role",
            details: error.message
        });
    }
};

export const updateRole = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, permissionIds = [], accessibleModules = "" } = req.body;

        const normalizeModule = (m: any) => {
            const s = String(m || "").trim().toUpperCase();
            if (s === "EMPLOYEES" || s === "HR") return "EMPLOYEE";
            if (s === "SETTINGS" || s === "ADMIN") return "MASTERS";
            return s;
        };

        // Clean and normalize accessible modules
        const moduleArray = Array.isArray(accessibleModules)
            ? accessibleModules
            : typeof accessibleModules === "string"
                ? accessibleModules.split(",")
                : [];
        const cleanModules = Array.from(
            new Set(moduleArray.map(normalizeModule).filter(Boolean))
        );
        const accessibleModulesStr = cleanModules.join(",");

        // Validate permissions against enabled modules (only grant permissions for accessible modules)
        let validPermissionIds: string[] = [];
        if (Array.isArray(permissionIds) && permissionIds.length > 0) {
            const requestedPermissions = await prisma.permission.findMany({
                where: { id: { in: permissionIds } }
            });
            validPermissionIds = requestedPermissions
                .filter(p => cleanModules.includes(p.module.toUpperCase()))
                .map(p => p.id);
        }

        const role = await prisma.role.update({
            where: { id: Number(id) },
            data: {
                name: String(name).trim(),
                accessibleModules: accessibleModulesStr,
                permissions: {
                    set: [],
                    connect: validPermissionIds.map((pid: string) => ({ id: pid }))
                }
            },
            include: { permissions: true }
        });
        res.json(role);
    } 
    catch (error: any) {
        console.error("Update role error:", error);
        res.status(500).json({
            error: "Failed to update role",
            details: error.message
        });
    }
};
export const deleteRole = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        await prisma.role.delete({
            where: { id: Number(id) }
        });

        res.json({ message: "Role deleted successfully" });
    }  catch (error: any) {
       
        res.status(500).json({
            error: "Failed to delete role",
            details: error.message
        });
    }
};

// ======================================================
// ✅ STATUTORY MASTERS BACKEND
// Used by frontend: StatutoryMasters.tsx
// ======================================================

/**
 * ✅ Dynamic dropdown options
 * Frontend can use this API instead of hardcoded dropdown values.
 */
export const getStatutoryOptions = async (req: Request, res: Response) => {
  return res.json({
    componentTypes: ["EARNING", "DEDUCTION", "REIMBURSEMENT"],
    taxabilityOptions: ["TAXABLE", "PARTIAL", "FULLY_EXEMPT"],
    calculationTypes: ["FLAT", "%_BASIC", "%_GROSS"],
    prorationMethods: ["CALENDAR_DAYS", "FIXED_30", "WORKING_DAYS"],
    genderOptions: ["ALL", "MALE", "FEMALE"],
  });
};

// ======================================================
// ✅ SALARY COMPONENTS
// ======================================================

export const getSalaryComponents = async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.user as any;

    const components = await prisma.salaryComponent.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

    return res.json(components);
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to fetch salary components",
      details: error.message,
    });
  }
};

export const createSalaryComponent = async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.user as any;

    const {
      name,
      type = "EARNING",
      taxability = "TAXABLE",
      isWageCodeComponent = false,
      isPartOfWages = false,
      isFBP = false,
      calculationType = "FLAT",
      value = 0,
      prorationMethod = "CALENDAR_DAYS",
    } = req.body;

    // ✅ Basic validation
    if (!name || String(name).trim() === "") {
      return res.status(400).json({
        error: "Component name is required",
      });
    }

    const allowedTypes = ["EARNING", "DEDUCTION", "REIMBURSEMENT"];
    const allowedTaxability = ["TAXABLE", "PARTIAL", "FULLY_EXEMPT"];
    const allowedCalculationTypes = ["FLAT", "%_BASIC", "%_GROSS"];
    const allowedProrationMethods = ["CALENDAR_DAYS", "FIXED_30", "WORKING_DAYS"];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid component type" });
    }

    if (!allowedTaxability.includes(taxability)) {
      return res.status(400).json({ error: "Invalid taxability" });
    }

    if (!allowedCalculationTypes.includes(calculationType)) {
      return res.status(400).json({ error: "Invalid calculation type" });
    }

    if (!allowedProrationMethods.includes(prorationMethod)) {
      return res.status(400).json({ error: "Invalid proration method" });
    }

    const component = await prisma.salaryComponent.create({
      data: {
        tenantId,

        // ✅ Basic component data
        name: String(name).trim(),
        type,
        taxability,

        // ✅ Auto decide taxable status
        isTaxable: taxability !== "FULLY_EXEMPT",

        // ✅ Compliance flags
        isWageCodeComponent: Boolean(isWageCodeComponent),
        isPartOfWages: Boolean(isPartOfWages),
        isFBP: Boolean(isFBP),

        // ✅ Calculation config
        calculationType,
        value: Number(value || 0),
        prorationMethod,
      },
    });

    return res.status(201).json(component);
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to create salary component",
      details: error.message,
    });
  }
};

export const updateSalaryComponent = async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.user as any;
    const { id } = req.params;

    const {
      name,
      type = "EARNING",
      taxability = "TAXABLE",
      isWageCodeComponent = false,
      isPartOfWages = false,
      isFBP = false,
      calculationType = "FLAT",
      value = 0,
      prorationMethod = "CALENDAR_DAYS",
    } = req.body;

    // ✅ Basic validation
    if (!name || String(name).trim() === "") {
      return res.status(400).json({
        error: "Component name is required",
      });
    }

    const allowedTypes = ["EARNING", "DEDUCTION", "REIMBURSEMENT"];
    const allowedTaxability = ["TAXABLE", "PARTIAL", "FULLY_EXEMPT"];
    const allowedCalculationTypes = ["FLAT", "%_BASIC", "%_GROSS"];
    const allowedProrationMethods = ["CALENDAR_DAYS", "FIXED_30", "WORKING_DAYS"];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid component type" });
    }

    if (!allowedTaxability.includes(taxability)) {
      return res.status(400).json({ error: "Invalid taxability" });
    }

    if (!allowedCalculationTypes.includes(calculationType)) {
      return res.status(400).json({ error: "Invalid calculation type" });
    }

    if (!allowedProrationMethods.includes(prorationMethod)) {
      return res.status(400).json({ error: "Invalid proration method" });
    }

    // Check if it exists for the tenant
    const existing = await prisma.salaryComponent.findFirst({
      where: { id, tenantId }
    });
    if (!existing) {
      return res.status(404).json({ error: "Salary component not found" });
    }

    const component = await prisma.salaryComponent.update({
      where: { id },
      data: {
        name: String(name).trim(),
        type,
        taxability,
        isTaxable: taxability !== "FULLY_EXEMPT",
        isWageCodeComponent: Boolean(isWageCodeComponent),
        isPartOfWages: Boolean(isPartOfWages),
        isFBP: Boolean(isFBP),
        calculationType,
        value: Number(value || 0),
        prorationMethod,
      },
    });

    return res.json(component);
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to update salary component",
      details: error.message,
    });
  }
};

export const deleteSalaryComponent = async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.user as any;
    const { id } = req.params;

    const deleted = await prisma.salaryComponent.deleteMany({
      where: {
        id,
        tenantId,
      },
    });

    if (deleted.count === 0) {
      return res.status(404).json({
        error: "Salary component not found",
      });
    }

    return res.json({
      message: "Salary component deleted successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to delete salary component",
      details: error.message,
    });
  }
};

// ======================================================
// ✅ STATUTORY SETTINGS: EPF / ESIC
// ======================================================

export const getStatutorySettings = async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.user as any;

    const settings = await prisma.statutorySettings.findUnique({
      where: { tenantId },
    });

    // ✅ If no settings found, return default values for frontend
    return res.json(
      settings || {
        epfEnabled: true,
        epfNumber: "",
        epfWageCeiling: true,
        pfCeilingType: "STATUTORY_15K",
        epfEmployeeRate: 12,
        epfEmployerRate: 3.67,
        epsEmployerRate: 8.33,
        edliEmployerRate: 0.5,
        adminChargesRate: 0.5,

        esicEnabled: true,
        esicNumber: "",
        esicWageLimit: 21000,
        esicEmployeeRate: 0.75,
        esicEmployerRate: 3.25,
      }
    );
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to fetch statutory settings",
      details: error.message,
    });
  }
};

export const updateStatutorySettings = async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.user as any;

    const {
      epfEnabled = true,
      epfNumber,
      epfWageCeiling = true,
      pfCeilingType,
      epfEmployeeRate = 12,
      epfEmployerRate = 3.67,
      epsEmployerRate = 8.33,
      edliEmployerRate = 0.5,
      adminChargesRate = 0.5,

      esicEnabled = true,
      esicNumber,
      esicWageLimit = 21000,
      esicEmployeeRate = 0.75,
      esicEmployerRate = 3.25,
    } = req.body;

    const settings = await prisma.statutorySettings.upsert({
      where: { tenantId },
      update: {
        epfEnabled: Boolean(epfEnabled),
        epfNumber: epfNumber || null,
        epfWageCeiling: Boolean(epfWageCeiling),
        pfCeilingType:
          pfCeilingType || (epfWageCeiling ? "STATUTORY_15K" : "ACTUAL_BASIC"),

        epfEmployeeRate: Number(epfEmployeeRate),
        epfEmployerRate: Number(epfEmployerRate),
        epsEmployerRate: Number(epsEmployerRate),
        edliEmployerRate: Number(edliEmployerRate),
        adminChargesRate: Number(adminChargesRate),

        esicEnabled: Boolean(esicEnabled),
        esicNumber: esicNumber || null,
        esicWageLimit: Number(esicWageLimit),
        esicEmployeeRate: Number(esicEmployeeRate),
        esicEmployerRate: Number(esicEmployerRate),
      },
      create: {
        tenantId,

        epfEnabled: Boolean(epfEnabled),
        epfNumber: epfNumber || null,
        epfWageCeiling: Boolean(epfWageCeiling),
        pfCeilingType:
          pfCeilingType || (epfWageCeiling ? "STATUTORY_15K" : "ACTUAL_BASIC"),

        epfEmployeeRate: Number(epfEmployeeRate),
        epfEmployerRate: Number(epfEmployerRate),
        epsEmployerRate: Number(epsEmployerRate),
        edliEmployerRate: Number(edliEmployerRate),
        adminChargesRate: Number(adminChargesRate),

        esicEnabled: Boolean(esicEnabled),
        esicNumber: esicNumber || null,
        esicWageLimit: Number(esicWageLimit),
        esicEmployeeRate: Number(esicEmployeeRate),
        esicEmployerRate: Number(esicEmployerRate),
      },
    });

    return res.json(settings);
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to update statutory settings",
      details: error.message,
    });
  }
};

// ======================================================
// ✅ PROFESSIONAL TAX SLABS
// ======================================================

export const getProfessionalTaxSlabs = async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.user as any;

    const slabs = await prisma.professionalTaxSlab.findMany({
      where: { tenantId },
      include: {
        state: true,
      },
      orderBy: {
        minSalary: "asc",
      },
    });

    return res.json(slabs);
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to fetch professional tax slabs",
      details: error.message,
    });
  }
};

export const createProfessionalTaxSlab = async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.user as any;

    const {
      stateId,
      gender = "ALL",
      minSalary = 0,
      maxSalary,
      taxAmount = 0,
    } = req.body;

    if (!stateId) {
      return res.status(400).json({
        error: "State is required",
      });
    }

    const state = await prisma.state.findUnique({
      where: {
        id: Number(stateId),
      },
    });

    if (!state) {
      return res.status(404).json({
        error: "Selected state not found",
      });
    }

    const slab = await prisma.professionalTaxSlab.create({
      data: {
        tenantId,
        stateId: Number(stateId),
        gender,
        minSalary: Number(minSalary),
        maxSalary:
          maxSalary === "" || maxSalary === null || maxSalary === undefined
            ? null
            : Number(maxSalary),
        taxAmount: Number(taxAmount),
      },
    });

    return res.status(201).json(slab);
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to create professional tax slab",
      details: error.message,
    });
  }
};

export const deleteProfessionalTaxSlab = async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.user as any;
    const { id } = req.params;

    const deleted = await prisma.professionalTaxSlab.deleteMany({
      where: {
        id,
        tenantId,
      },
    });

    if (deleted.count === 0) {
      return res.status(404).json({
        error: "Professional tax slab not found",
      });
    }

    return res.json({
      message: "Professional tax slab deleted successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to delete professional tax slab",
      details: error.message,
    });
  }
};