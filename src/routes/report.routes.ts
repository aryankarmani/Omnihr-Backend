
import { Router } from "express";

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

// ================= REPORT APIs =================

// Dashboard
router.get(
  "/dashboard",
  getDashboard
);

// Attendance analytics
router.get(
  "/attendance",
  getAttendance
);

// Payroll analytics
router.get(
  "/payroll",
  getPayroll
);

// ================= EXPORT APIs =================

// CSV Attendance Export
router.get(
  "/export/attendance",
  exportMonthlyAttendance
);

// PDF Salary Export
router.get(
  "/export/salary",
  exportSalaryRegister
);

// Excel Leave Export
router.get(
  "/export/leave",
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

