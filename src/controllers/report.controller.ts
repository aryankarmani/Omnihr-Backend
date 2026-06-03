
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

// @ts-ignore
import { Parser } from "json2csv";

// @ts-ignore
import PDFDocument from "pdfkit";

import ExcelJS from "exceljs";

const prisma = new PrismaClient();

// ================= TENANT HELPER =================
const getTenantId = (req: Request, res: Response): string | null => {
  const user = req.user as any;
  const tenantId =
  user?.tenantId ||
    (req.headers["x-tenant-id"] as string) ||
    (req.query.tenantId as string);

  if (!tenantId) {
    res.status(400).json({
      message: "Tenant ID missing"
    });

    return null;
  }

  return tenantId;
};

// ================= SALARY HELPER =================
const calculateSalary = (salary: any): number => {
  if (!salary) return 0;

  return (
    (salary.basic || 0) +
    (salary.hra || 0) +
    (salary.special || 0) +
    (salary.medical || 0)
  );
};

const formatLocalDate = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// UPDATED: Backend now works according to frontend dropdown period.

const getReportRange = (periodQuery: any) => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const period = String(periodQuery || "monthly");

  let firstDay: Date;
  let lastDay: Date = new Date(today);

  if (period === "weekly") {
    // Current week: Start from Monday of the current week
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    firstDay = new Date(today.getFullYear(), today.getMonth(), diff);
    firstDay.setHours(0, 0, 0, 0);
  } else if (period === "quarter") {
    // Last 3 completed months (excluding current month)
    firstDay = new Date(today.getFullYear(), today.getMonth() - 3, 1);
    firstDay.setHours(0, 0, 0, 0);
    lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
    lastDay.setHours(23, 59, 59, 999);
  } else if (period === "semi-annual") {
    // Last 6 completed months (excluding current month)
    firstDay = new Date(today.getFullYear(), today.getMonth() - 6, 1);
    firstDay.setHours(0, 0, 0, 0);
    lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
    lastDay.setHours(23, 59, 59, 999);
  } else if (period === "annual") {
    // Last 12 completed months (excluding current month)
    firstDay = new Date(today.getFullYear(), today.getMonth() - 12, 1);
    firstDay.setHours(0, 0, 0, 0);
    lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
    lastDay.setHours(23, 59, 59, 999);
  } else {
    // Current month (monthly)
    firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    firstDay.setHours(0, 0, 0, 0);
  }

  return {
    period,
    startDate: formatLocalDate(firstDay),
    endDate: formatLocalDate(lastDay),
    firstDay,
    today: lastDay,
  };
};

// ================= WORKING DAYS HELPER =================

const getWorkingDays = (start: Date, end: Date) => {
  let count = 0;
  const cursor = new Date(start);

  while (cursor <= end) {
    const day = cursor.getDay();

    // Skip Sunday and Saturday
    if (day !== 0 && day !== 6) {
      count++;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return count;
};

// ================= DASHBOARD =================
export const getDashboard = async (
  req: Request,
  res: Response
) => {
  try {
    const tenantId = getTenantId(req, res);

    if (!tenantId) return;

    const { period, startDate, endDate, today, firstDay } = getReportRange(req.query.period);

    const employees = await prisma.employeeProfile.findMany({
      where: {
        tenantId,
        isActive: true,
        deletedAt: null,
        user: {
          isActive: true,
          deletedAt: null,
        },
      },
      include: {
        salary: true,
      },
    });

    const totalPayroll = employees.reduce((sum, emp) => {
      return sum + calculateSalary(emp.salary);
    }, 0);

    // Scale payroll based on selected period
    let periodPayroll = totalPayroll;
    if (period === "weekly") {
      periodPayroll = Math.round(totalPayroll * (7 / 30));
    } else if (period === "quarter") {
      periodPayroll = totalPayroll * 3;
    } else if (period === "semi-annual") {
      periodPayroll = totalPayroll * 6;
    } else if (period === "annual") {
      periodPayroll = totalPayroll * 12;
    }

    // ===== ATTENDANCE =====
    const attendanceRecords = await prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        date: {
          gte: startDate,
          lte: endDate,
        },
        user: {
          isActive: true,
          deletedAt: null,
        },
      },
    });

    const workingDays = getWorkingDays(firstDay, today);

    const expectedAttendance = workingDays * employees.length;

    const presentCount = attendanceRecords.filter((record) => {
      const status = String(record.status).toUpperCase();

      return status === "PRESENT" || status === "LATE";
    }).length;

    const avgAttendance =
      expectedAttendance > 0
        ? Math.round((presentCount / expectedAttendance) * 100)
        : 0;

    // Filter pending leaves within the period
    const pendingLeaves = await prisma.leave.count({
      where: {
        tenantId,
        status: "PENDING",
        startDate: {
          gte: firstDay,
          lte: today,
        },
      },
    });

    return res.json({
      totalPayroll: periodPayroll,
      avgAttendance,
      pendingLeaves,

      // UPDATED: text according to selected period
      payrollGrowth:
        period === "weekly"
          ? "+5% this week"
          : period === "monthly"
          ? "+5% this month"
          : period === "quarter"
          ? "+5% this quarter"
          : period === "semi-annual"
          ? "+5% in 6 months"
          : "+5% this year",

      attendanceTrend:
        avgAttendance >= 75 ? "Good attendance" : "Needs attention",

      leaveStatus:
        pendingLeaves > 0
          ? `${pendingLeaves} awaiting approval`
          : "No pending leaves",
    });
  } catch (error) {
    console.error("Reports dashboard error:", error);

    return res.status(500).json({
      message: "Failed to load reports dashboard",
    });
  }
};


// ================= ATTENDANCE =================
// Helper to get month names list in range
const getMonthsInRange = (start: Date, end: Date) => {
  const months: string[] = [];
  const cursor = new Date(start);
  cursor.setDate(1);
  while (cursor <= end) {
    const monthName = cursor.toLocaleDateString("en-US", { month: "short" });
    if (!months.includes(monthName)) {
      months.push(monthName);
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
};

// ================= ATTENDANCE =================
export const getAttendance = async (
  req: Request,
  res: Response
) => {
  try {
    const tenantId = getTenantId(req, res);

    if (!tenantId) return;

    const { period, startDate, endDate, firstDay, today } = getReportRange(req.query.period);

    const records = await prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        date: {
          gte: startDate,
          lte: endDate,
        },
        user: {
          isActive: true,
          deletedAt: null,
        },
      },
      orderBy: {
        date: "asc",
      },
    });

    const map: Record<
      string,
      { name: string; present: number; absent: number; late: number }
    > = {};

    let orderedLabels: string[] = [];

    // Pre-populate map based on period
    if (period === "weekly") {
      orderedLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      orderedLabels.forEach((label) => {
        map[label] = { name: label, present: 0, absent: 0, late: 0 };
      });
    } else if (period === "monthly") {
      orderedLabels = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"];
      orderedLabels.forEach((label) => {
        map[label] = { name: label, present: 0, absent: 0, late: 0 };
      });
    } else {
      orderedLabels = getMonthsInRange(firstDay, today);
      orderedLabels.forEach((label) => {
        map[label] = { name: label, present: 0, absent: 0, late: 0 };
      });
    }

    records.forEach((record) => {
      const dateObj = new Date(record.date);
      let label = "";

      if (period === "weekly") {
        const daysMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        label = daysMap[dateObj.getUTCDay()];
      } else if (period === "monthly") {
        const dayOfMonth = dateObj.getUTCDate();
        if (dayOfMonth <= 7) label = "Week 1";
        else if (dayOfMonth <= 14) label = "Week 2";
        else if (dayOfMonth <= 21) label = "Week 3";
        else if (dayOfMonth <= 28) label = "Week 4";
        else label = "Week 5";
      } else {
        label = dateObj.toLocaleDateString("en-US", {
          month: "short",
          timeZone: "UTC",
        });
      }

      if (map[label]) {
        const status = String(record.status).toUpperCase();
        if (status === "PRESENT" || status === "LATE") {
          map[label].present++;
        } else if (status === "ABSENT") {
          map[label].absent++;
        }
      }
    });

    const result = orderedLabels.map((l) => map[l]);
    return res.json(result);
  } catch (error) {
    console.error("Reports attendance error:", error);

    return res.status(500).json({
      message: "Failed to load attendance report",
    });
  }
};
// ================= PAYROLL =================
export const getPayroll = async (
  req: Request,
  res: Response
) => {
  try {
    const tenantId = getTenantId(req, res);

    if (!tenantId) return;

    const { period } = getReportRange(req.query.period);

    const employees = await prisma.employeeProfile.findMany({
      where: {
        tenantId,
        isActive: true,
        deletedAt: null,
        user: {
          isActive: true,
          deletedAt: null,
        },
      },
      include: {
        salary: true,
        departmentRef: true,
      },
    });

    const departmentMap: Record<string, number> = {};

    employees.forEach((emp) => {
       const department =
        emp.departmentRef?.name || emp.department || "Unknown";

       if (!departmentMap[department]) {
        departmentMap[department] = 0;
      }

      departmentMap[department] += calculateSalary(emp.salary);
    });

    // Scale values based on period
    let multiplier = 1;
    if (period === "weekly") {
      multiplier = 7 / 30;
    } else if (period === "quarter") {
      multiplier = 3;
    } else if (period === "semi-annual") {
      multiplier = 6;
    } else if (period === "annual") {
      multiplier = 12;
    }

    const result = Object.entries(departmentMap).map(
      ([name, value]) => ({
        name,
        value: Math.round(value * multiplier)
      })
    );

    return res.json(result);

  } catch (error) {
    console.error("Payroll error:", error);

    res.status(500).json({
      message: "Payroll error"
    });
  }
};

// ================= CSV EXPORT =================
export const exportMonthlyAttendance = async (
  req: Request,
  res: Response
) => {
  
// console.log("EXPORT HIT");
// console.log("QUERY:", req.query);
// console.log("HEADERS:", req.headers);


  try {
       
  const tenantId = getTenantId(req, res);

if (!tenantId) return;

 const { period, startDate, endDate } = getReportRange(req.query.period);

    
 const records = await prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        date: {
          gte: startDate,
          lte: endDate,
        },
        user: {
          isActive: true,
          deletedAt: null,
        },
      },
      include: {
        user: true,
      },
      orderBy: {
        date: "asc",
      },
    });

    
    const formatted = records.map((record) => ({

      employeeId: record.userId,

      name: record.user?.name || "",
      email: record.user?.email || "",
      date: record.date,
      status: record.status,
      hours: record.hours || 0,

    }));
    



    const parser = new Parser({
      fields: [
        "employeeId",
        "name",
        "email",
        "date",
        "status",
        "hours"
      ]
    });

    const csv = parser.parse(formatted);

    res.setHeader(
      "Content-Type",
      "text/csv"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=attendance.csv"
    );

    return res.send(csv);

  } catch (error) {
    console.error("Attendance export error:", error);

    res.status(500).send(
      "CSV export error"
    );
  }
};

// ================= PDF EXPORT =================

export const exportSalaryRegister = async (
  req: Request,
  res: Response
) => {

  try {

   const tenantId = getTenantId(req, res);

    if (!tenantId) return;

    const { period } = getReportRange(req.query.period);

    // Scale values based on period
    let multiplier = 1;
    if (period === "weekly") {
      multiplier = 7 / 30;
    } else if (period === "quarter") {
      multiplier = 3;
    } else if (period === "semi-annual") {
      multiplier = 6;
    } else if (period === "annual") {
      multiplier = 12;
    }

    const employees =
      await prisma.employeeProfile.findMany({
        where: {
        tenantId,
        isActive: true,
        deletedAt: null,
        user: {
          isActive: true,
          deletedAt: null,
        },
      },
      include: {
        user: true,
        salary: true,
        departmentRef: true,
      },
    });

    const formatted = employees.map((emp) => {
      const basic = emp.salary?.basic || 0;
      const hra = emp.salary?.hra || 0;
      const special = emp.salary?.special || 0;
      const medical = emp.salary?.medical || 0;
      const grossSalary = calculateSalary(emp.salary);

      return {
        employeeId: emp.userId,
        name: emp.user?.name || "",
        email: emp.user?.email || "",
        department: emp.departmentRef?.name || emp.department || "",
        basic: Math.round(basic * multiplier),
        hra: Math.round(hra * multiplier),
        special: Math.round(special * multiplier),
        medical: Math.round(medical * multiplier),
        grossSalary: Math.round(grossSalary * multiplier),
      };
    });

    const parser = new Parser({
      fields: [
        "employeeId",
        "name",
        "email",
        "department",
        "basic",
        "hra",
        "special",
        "medical",
        "grossSalary"
      ]
    });

    const csv = parser.parse(formatted);

    res.setHeader(
      "Content-Type",
      "text/csv"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=salary.csv"
    );

    return res.send(csv);

  } catch (error) {

    console.error("Salary CSV export error:", error);

    res.status(500).json({
      message: "Salary CSV export error"
    });
  }
};



// ================= EXCEL EXPORT =================
export const exportLeaveBalance = async (
  req: Request,
  res: Response
) => {
//   console.log("EXPORT HIT");
// console.log("QUERY:", req.query);
// console.log("HEADERS:", req.headers);

  try {
   
const tenantId = getTenantId(req, res);

if (!tenantId) return;



    const { firstDay, today } = getReportRange(req.query.period);

    const leaves = await prisma.leave.findMany({
       where: {
        tenantId,
        startDate: {
          gte: firstDay,
          lte: today,
        },
      },
      include: {
        user: true,
        leaveType: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const workbook =
      new ExcelJS.Workbook();

    const sheet =
      workbook.addWorksheet("Leaves");


    sheet.columns = [

      {
        header: "Employee ID",
        key: "userId",
        width: 15
      },

      {
        header: "Name",
        key: "name",
        width: 25
      },

  {
    header: "Email",
    key: "email",
    width: 30
  },

   { header: "Leave Type", key: "leaveType", width: 20 },

   { header: "Reason", key: "reason", width: 30 },

      {
        header: "Status",
        key: "status",
        width: 15
      },

      {
        header: "Start Date",
        key: "start",
        width: 20
      },

      {
        header: "End Date",
        key: "end",
        width: 20
      }
    ];


    leaves.forEach((leave) => {
      
sheet.addRow({

 employeeId: leave.userId,

  name: leave.user?.name || "",

  email: leave.user?.email || "",

  leaveType: leave.leaveType?.name || "",

  reason: leave.reason,

  status: leave.status,

  startDate: leave.startDate.toISOString().split("T")[0],
  endDate: leave.endDate.toISOString().split("T")[0],

      });


    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=leave.xlsx"
    );

    await workbook.xlsx.write(res);

    res.end();

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Excel export error"
    });
  }
};

// ================= TEST CREATE APIs =================
// export const createAttendance = async (
//   req: Request,
//   res: Response
// ) => {
//   try {
//     const data =
//       await prisma.attendanceRecord.create({
//         data: req.body
//       });

//     res.json(data);

//   } catch (err) {
//     console.error(err);

//     res.status(500).json(err);
//   }
// };

// export const createLeave = async (
//   req: Request,
//   res: Response
// ) => {
//   try {
//     const data =
//       await prisma.leave.create({
//         data: req.body
//       });

//     res.json(data);

//   } catch (err) {
//     console.error(err);

//     res.status(500).json(err);
//   }
// };

// export const createEmployeeProfile = async (
//   req: Request,
//   res: Response
// ) => {
//   try {
//     const data =
//       await prisma.employeeProfile.create({
//         data: req.body
//       });

//     res.json(data);

//   } catch (err) {
//     console.error(err);

//     res.status(500).json(err);
//   }
// };

// export const createSalary = async (
//   req: Request,
//   res: Response
// ) => {
//   try {
//     const data =
//       await prisma.salaryStructure.create({
//         data: req.body
//       });

//     res.json(data);

//   } catch (err) {
//     console.error(err);

//     res.status(500).json(err);
//   }
// };
