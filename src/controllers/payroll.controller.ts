import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { calculatePayrollFromComponents } from "../utils/payrollCalculator";

const prisma = new PrismaClient();

const getEmployeeProfile = async (tenantId: string, employeeId: number) => {
  return prisma.employeeProfile.findFirst({
    where: {
      tenantId,
      userId: employeeId,
      isActive: true,
      deletedAt: null,
    },
    include: {
      user: {
        include: {
          role: true,
        },
      },
    },
  });
};

// ✅ GET /api/payroll/:employeeId/components
export const getEmployeeSalaryComponents = async (
  req: Request,
  res: Response
) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    const employeeId = Number(req.params.employeeId);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!employeeId || Number.isNaN(employeeId)) {
      return res.status(400).json({ message: "Invalid employee id" });
    }

    const profile = await getEmployeeProfile(tenantId, employeeId);

    if (!profile) {
      return res.status(404).json({ message: "Employee profile not found" });
    }

    // ✅ Fetch all master salary components
    const masterComponents = await prisma.salaryComponent.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });

    // ✅ Auto-add every master component into employee salary list
    for (const component of masterComponents) {
      await prisma.employeeSalaryComponent.upsert({
        where: {
          profileId_componentId: {
            profileId: profile.id,
            componentId: component.id,
          },
        },
        update: {},
        create: {
          tenantId,
          profileId: profile.id,
          componentId: component.id,

          // ✅ null means use master calculation/value
          amount: null,
        },
      });
    }

    const employeeComponents = await prisma.employeeSalaryComponent.findMany({
      where: {
        tenantId,
        profileId: profile.id,
      },
      include: {
        component: true,
      },
      orderBy: {
        id: "asc",
      },
    });

    const summary = calculatePayrollFromComponents(employeeComponents);

    return res.json({
      employee: {
        id: profile.user.id,
        name: profile.user.name,
        email: profile.user.email,
        role: profile.user.role?.name || "EMPLOYEE",
        title: profile.title || "Employee",
        department: profile.department || "",
      },
      components: employeeComponents,
      summary,
    });
  } catch (error: any) {
    console.error("Get salary components error:", error);
    return res.status(500).json({
      message: "Failed to fetch employee salary components",
      error: error.message,
    });
  }
};

// ✅ PUT /api/payroll/:employeeId/components
export const updateEmployeeSalaryComponents = async (
  req: Request,
  res: Response
) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    const employeeId = Number(req.params.employeeId);
    const { components = [] } = req.body;

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!employeeId || Number.isNaN(employeeId)) {
      return res.status(400).json({ message: "Invalid employee id" });
    }

    if (!Array.isArray(components)) {
      return res.status(400).json({
        message: "components must be an array",
      });
    }

    const profile = await getEmployeeProfile(tenantId, employeeId);

    if (!profile) {
      return res.status(404).json({ message: "Employee profile not found" });
    }

    for (const item of components) {
      if (!item.componentId) continue;

      const masterComponent = await prisma.salaryComponent.findFirst({
        where: {
          id: item.componentId,
          tenantId,
        },
      });

      if (!masterComponent) continue;

      await prisma.employeeSalaryComponent.upsert({
        where: {
          profileId_componentId: {
            profileId: profile.id,
            componentId: item.componentId,
          },
        },
        update: {
          // ✅ Employee-specific value
          amount:
            item.amount === null || item.amount === undefined || item.amount === ""
              ? null
              : Number(item.amount),
        },
        create: {
          tenantId,
          profileId: profile.id,
          componentId: item.componentId,
          amount:
            item.amount === null || item.amount === undefined || item.amount === ""
              ? null
              : Number(item.amount),
        },
      });
    }

    const employeeComponents = await prisma.employeeSalaryComponent.findMany({
      where: {
        tenantId,
        profileId: profile.id,
      },
      include: {
        component: true,
      },
    });

    const summary = calculatePayrollFromComponents(employeeComponents);

    return res.json({
      message: "Employee salary components updated successfully",
      components: employeeComponents,
      summary,
    });
  } catch (error: any) {
    console.error("Update salary components error:", error);
    return res.status(500).json({
      message: "Failed to update employee salary components",
      error: error.message,
    });
  }
};

// ✅ GET /api/payroll/:employeeId/payslip?month=2026-06
export const getEmployeePayslip = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    const employeeId = Number(req.params.employeeId);
    const month =
      String(req.query.month || "").trim() ||
      new Date().toISOString().slice(0, 7);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const profile = await prisma.employeeProfile.findFirst({
      where: {
        tenantId,
        userId: employeeId,
      },
      include: {
        user: {
          include: {
            role: true,
          },
        },
        bank: true,
        statutory: true,
        departmentRef: true,
        designationRef: true,
        salaryComponents: {
          include: {
            component: true,
          },
        },
      },
    });

    if (!profile) {
      return res.status(404).json({ message: "Employee profile not found" });
    }

    const company = await prisma.company.findFirst({
      where: { tenantId },
    });

    const companySetting = await prisma.companySetting.findUnique({
      where: { tenantId },
    });

    const summary = calculatePayrollFromComponents(profile.salaryComponents);

    return res.json({
      month,

      company: {
        name: company?.legalName || "Company",
        address: company?.regAddress || "",
        logo: company?.logo || null,
      },

      employee: {
        id: profile.user.id,
        name: profile.user.name,
        email: profile.user.email,
        role: profile.user.role?.name || "EMPLOYEE",
        designation:
          profile.designationRef?.title || profile.title || "Employee",
        department:
          profile.departmentRef?.name || profile.department || "",
        joiningDate: profile.joiningDate,
        bankName: profile.bank?.bankName || "",
        accountNumber: profile.bank?.accountNumber || "",
        ifsc: profile.bank?.ifsc || "",
        pan: profile.statutory?.pan || "",
        uan: profile.statutory?.uan || "",
        pfNumber: profile.statutory?.pfNumber || "",
      },

      earnings: summary.earnings,
      deductions: summary.deductions,
      reimbursements: summary.reimbursements,

      grossEarnings: summary.grossEarnings,
      totalDeductions: summary.totalDeductions,
      totalReimbursements: summary.totalReimbursements,
      netPay: summary.netPay,

      authorizedSignature: companySetting?.authorizedSignImage
        ? `/uploads/${companySetting.authorizedSignImage}`
        : null,
      authorizedSignName: companySetting?.authorizedSignName || "",
      authorizedSignTitle: companySetting?.authorizedSignTitle || "",
    });
  } catch (error: any) {
    console.error("Payslip error:", error);
    return res.status(500).json({
      message: "Failed to generate payslip",
      error: error.message,
    });
  }
};