import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth";
import {
  getEmployeeSalaryComponents,
  updateEmployeeSalaryComponents,
  getEmployeePayslip,
} from "../controllers/payroll.controller";

const router = Router();

router.use(authenticate);

// ✅ Fetch employee salary components from Masters + employee saved values
router.get("/:employeeId/components", requirePermission('PAYROLL_VIEW'), getEmployeeSalaryComponents);

// ✅ Admin updates employee-specific earning/deduction amount
router.put(
  "/:employeeId/components",
  requirePermission('PAYROLL_PROCESS'),
  updateEmployeeSalaryComponents
);

// ✅ Generate payslip data
router.get("/:employeeId/payslip", requirePermission('PAYROLL_DOWNLOAD'), getEmployeePayslip);

export default router;