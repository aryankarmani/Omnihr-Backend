
import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth";
import {
  getDashboard,
  getAttendance,
  getPayroll,
  getEmployeePayslip,
  exportMonthlyAttendance,
  exportLeaveBalance,
  exportSalaryRegister,
} from "../controllers/report.controller";

const router = Router();

router.use(authenticate);

// ================= REPORT APIs =================

// Dashboard
router.get(
  "/dashboard",
  requirePermission('REPORTS_VIEW'),
  getDashboard
);

// Attendance analytics
router.get(
  "/attendance",
  requirePermission('REPORTS_VIEW'),
  getAttendance
);

// Payroll analytics
router.get(
  "/payroll",
  requirePermission('REPORTS_VIEW'),
  getPayroll
);

// ================= EXPORT APIs =================

// CSV Attendance Export
router.get(
  "/export/attendance",
  requirePermission('REPORTS_EXPORT'),
  exportMonthlyAttendance
);

// PDF Salary Export
router.get(
  "/export/salary",
  requirePermission('REPORTS_EXPORT'),
  exportSalaryRegister
);

// Excel Leave Export
router.get(
  "/export/leave",
  requirePermission('REPORTS_EXPORT'),
  exportLeaveBalance
);

// ✅ ADDED: Employee monthly payslip
router.get("/payslip/:id", getEmployeePayslip);
// // ================= TEST APIs =================

// // Attendance
// router.post(
//   "/test/attendance",
//   createAttendance
// );

// // Leave
// router.post(
//   "/test/leave",
//   createLeave
// );

// // Employee
// router.post(
//   "/test/employee",
//   createEmployeeProfile
// );

// // Salary
// router.post(
//   "/test/salary",
//   createSalary
// );

export default router;

