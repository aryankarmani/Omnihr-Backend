
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

// UPDATED: Backend now works according to frontend dropdown period.

const getReportRange = (periodQuery: any) => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const period = String(periodQuery || "monthly");

  let firstDay: Date;

  if (period === "weekly") {
    // Last 7 days including today
    firstDay = new Date(today);
    firstDay.setDate(today.getDate() - 6);
  } else if (period === "quarter") {
    // Last 3 months
    firstDay = new Date(today);
    firstDay.setMonth(today.getMonth() - 2);
    firstDay.setDate(1);
  } else if (period === "semi-annual") {
    // Last 6 months
    firstDay = new Date(today);
    firstDay.setMonth(today.getMonth() - 5);
    firstDay.setDate(1);
  } else if (period === "annual") {
    // Current year
    firstDay = new Date(today.getFullYear(), 0, 1);
  } else {
    // Current month
    firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  }

  firstDay.setHours(0, 0, 0, 0);

  return {
    period,
    startDate: firstDay.toISOString().split("T")[0],
    endDate: today.toISOString().split("T")[0],
    firstDay,
    today,
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

    const { period,startDate, endDate, today, firstDay } =  getReportRange(req.query.period);

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

    const pendingLeaves = await prisma.leave.count({
      where: {
        tenantId,
        status: "PENDING",
      },
    });

    return res.json({
      totalPayroll,
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
export const getAttendance = async (
  req: Request,
  res: Response
) => {
  try {
    const tenantId = getTenantId(req, res);

    if (!tenantId) return;

      const { period, startDate, endDate } = getReportRange(req.query.period);

    const records =
      await prisma.attendanceRecord.findMany({
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

    records.forEach((record) => {
      const dateObj = new Date(record.date);

      let label = "";

      // UPDATED: chart label changes by frontend selected period
      if (period === "weekly") {
        label = dateObj.toLocaleDateString("en-US", {
          weekday: "short",
        });
      } else if (period === "monthly") {
        label = dateObj.toLocaleDateString("en-US", {
          day: "2-digit",
          month: "short",
        });
      } else {
        label = dateObj.toLocaleDateString("en-US", {
          month: "short",
        });
      }

      if (!map[label]) {
        map[label] = {
          name: label,
          present: 0,
          absent: 0,
          late: 0,
        };
      }

      const status = String(record.status).toUpperCase();

      if (status === "PRESENT") {
        map[label].present++;
      } else if (status === "ABSENT") {
        map[label].absent++;
      } else if (status === "LATE") {
        map[label].late++;
      }
    });

    return res.json(Object.values(map));
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

    getReportRange(req.query.period);

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

    const result = Object.entries(departmentMap).map(
      ([name, value]) => ({
        name,
        value
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

    const formatted = employees.map((emp) => ({

      employeeId: emp.userId,

      name: emp.user?.name || "",

      email: emp.user?.email || "",

      department: emp.departmentRef?.name || emp.department || "",
      basic: emp.salary?.basic || 0,
      hra: emp.salary?.hra || 0,
      special: emp.salary?.special || 0,
      medical: emp.salary?.medical || 0,
      grossSalary: calculateSalary(emp.salary),

    }));

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



    const leaves = await prisma.leave.findMany({
       where: {
        tenantId,
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
