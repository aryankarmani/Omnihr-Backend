import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import {
  getEmployeeSalaryComponents,
  updateEmployeeSalaryComponents,
  getEmployeePayslip,
} from "../controllers/payroll.controller";

const router = Router();

router.use(authenticate);

// ✅ Fetch employee salary components from Masters + employee saved values
router.get("/:employeeId/components", getEmployeeSalaryComponents);

// ✅ Admin updates employee-specific earning/deduction amount
router.put(
  "/:employeeId/components",
  authorize(["HR_ADMIN", "SYSTEM_ADMIN"]),
  updateEmployeeSalaryComponents
);

// ✅ Generate payslip data
router.get("/:employeeId/payslip", getEmployeePayslip);

export default router;