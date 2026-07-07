
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

// ✅ NEW: Attendance-based salary deduction helper
const calculateAttendanceDeduction = async ({
  tenantId,
  userId,
  grossSalary,
  startDate,
  endDate,
  firstDay,
  today,
}: {
  tenantId: string;
  userId: number;
  grossSalary: number;
  startDate: string;
  endDate: string;
  firstDay: Date;
  today: Date;
}) => {
  const workingDays = getWorkingDays(firstDay, today);
  const perDaySalary = workingDays > 0 ? grossSalary / workingDays : 0;

  const policy = await prisma.attendancePolicy.findUnique({
    where: { tenantId },
  });

  const minHalfDayHours = policy?.minHalfDayHours ?? 4;
  const minFullDayHours = policy?.minFullDayHours ?? 8;
  const lateMarkThreshold = policy?.lateMarkThreshold ?? 3;
  const lateMarkDeduction = policy?.lateMarkDeduction ?? "HALF_DAY";

  const records = await prisma.attendanceRecord.findMany({
    where: {
      tenantId,
      userId,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  let lwpDays = 0;
  let lateCount = 0;

  records.forEach((record) => {
    const status = String(record.status || "").toUpperCase();
    const hours = record.hours || 0;

    if (status === "ABSENT") {
      lwpDays += 1;
      return;
    }

    if (status === "HALF DAY" || status === "HALF_DAY") {
      lwpDays += 0.5;
      return;
    }

    if (status === "LATE") {
      lateCount += 1;
    }

    // ✅ Short-hours deduction
    if (hours > 0 && hours < minHalfDayHours) {
      lwpDays += 1;
    } else if (hours > 0 && hours < minFullDayHours) {
      lwpDays += 0.5;
    }
  });

  // ✅ Late mark deduction
  if (lateMarkThreshold > 0) {
    const latePenaltyCount = Math.floor(lateCount / lateMarkThreshold);

    if (latePenaltyCount > 0) {
      lwpDays +=
        latePenaltyCount *
        (lateMarkDeduction === "ONE_DAY" ? 1 : 0.5);
    }
  }

  const lwpDeduction = Math.round(perDaySalary * lwpDays);
  const netSalary = Math.max(0, Math.round(grossSalary - lwpDeduction));

  return {
    workingDays,
    perDaySalary: Math.round(perDaySalary),
    lateCount,
    lwpDays,
    lwpDeduction,
    netSalary,
  };
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

// ✅ CHANGED: Common active employee query from User table
const activeUserWhere = (tenantId: string) => ({
  tenantId,
  isActive: true,
  deletedAt: null,
});

// ✅ CHANGED: Get all active users with profile/salary
const getActiveEmployees = async (tenantId: string) => {
  return prisma.user.findMany({
    where: activeUserWhere(tenantId),
    include: {
      role: true,
      employeeProfile: {
        include: {
          salary: true,
          departmentRef: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
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

    // ✅ CHANGED: Users are source of truth, not EmployeeProfile
    const employees = await getActiveEmployees(tenantId);

    const totalPayroll = employees.reduce((sum, emp) => {
      return sum + calculateSalary(emp.employeeProfile?.salary);
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

    // ===== PREVIOUS PERIOD PAYROLL FOR GROWTH CALCULATION =====
    let prevFirstDay: Date;
    let prevToday: Date;

    if (period === "weekly") {
      prevFirstDay = new Date(firstDay);
      prevFirstDay.setDate(prevFirstDay.getDate() - 7);
      prevToday = new Date(today);
      prevToday.setDate(prevToday.getDate() - 7);
    } else if (period === "quarter") {
      prevFirstDay = new Date(firstDay.getFullYear(), firstDay.getMonth() - 3, 1);
      prevToday = new Date(firstDay.getFullYear(), firstDay.getMonth(), 0);
      prevToday.setHours(23, 59, 59, 999);
    } else if (period === "semi-annual") {
      prevFirstDay = new Date(firstDay.getFullYear(), firstDay.getMonth() - 6, 1);
      prevToday = new Date(firstDay.getFullYear(), firstDay.getMonth(), 0);
      prevToday.setHours(23, 59, 59, 999);
    } else if (period === "annual") {
      prevFirstDay = new Date(firstDay.getFullYear(), firstDay.getMonth() - 12, 1);
      prevToday = new Date(firstDay.getFullYear(), firstDay.getMonth(), 0);
      prevToday.setHours(23, 59, 59, 999);
    } else {
      // monthly
      prevFirstDay = new Date(firstDay.getFullYear(), firstDay.getMonth() - 1, 1);
      prevToday = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
      const lastDayOfPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      if (prevToday > lastDayOfPrevMonth) {
        prevToday.setDate(lastDayOfPrevMonth.getDate());
      }
       prevFirstDay.setHours(0, 0, 0, 0);
      prevToday.setHours(23, 59, 59, 999);
    }

    // ✅ CHANGED: Previous payroll also uses User table
    const prevEmployees = await prisma.user.findMany({
      where: {
        tenantId,
        createdAt: {
          lte: prevToday,
        },
        OR: [
          { deletedAt: null },
          { deletedAt: { gte: prevFirstDay } },
        ],
      },
      include: {
        employeeProfile: {
          include: {
            salary: true,
          },
        },
      },
    });

    const prevTotalPayroll = prevEmployees.reduce((sum, emp) => {
      return sum + calculateSalary(emp.employeeProfile?.salary);
    }, 0);

    let prevPeriodPayroll = prevTotalPayroll;
    if (period === "weekly") {
      prevPeriodPayroll = Math.round(prevTotalPayroll * (7 / 30));
    } else if (period === "quarter") {
      prevPeriodPayroll = prevTotalPayroll * 3;
    } else if (period === "semi-annual") {
      prevPeriodPayroll = prevTotalPayroll * 6;
    } else if (period === "annual") {
      prevPeriodPayroll = prevTotalPayroll * 12;
    }

    let growthPercent = 0;
    if (prevPeriodPayroll > 0) {
      growthPercent = Math.round(((periodPayroll - prevPeriodPayroll) / prevPeriodPayroll) * 100);
    } else if (periodPayroll > 0) {
      growthPercent = 100;
    }

    const payrollGrowth = `${growthPercent >= 0 ? "+" : ""}${growthPercent}%`;
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
        totalEmployees: employees.length,
      totalPayroll: periodPayroll,
      avgAttendance,
      pendingLeaves,
      payrollGrowth,

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


// // ================= ATTENDANCE =================
// // Helper to get month names list in range
// const getMonthsInRange = (start: Date, end: Date) => {
//   const months: string[] = [];
//   const cursor = new Date(start);
//   cursor.setDate(1);
//   while (cursor <= end) {
//     const monthName = cursor.toLocaleDateString("en-US", { month: "short" });
//     if (!months.includes(monthName)) {
//       months.push(monthName);
//     }
//     cursor.setMonth(cursor.getMonth() + 1);
//   }
//   return months;
// };

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

     // ✅ CHANGED: Count users instead of employeeProfile
    const activeEmployeesCount = await prisma.user.count({
      where: activeUserWhere(tenantId),
    });

    const map: Record<
      string,
      { name: string; present: number; absent: number; late: number }
    > = {};

    let orderedLabels: string[] = [];
    const monthRanges: Record<string, { start: Date; end: Date }> = {};

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
      const cursor = new Date(firstDay);
      cursor.setDate(1);
      while (cursor <= today) {
        const label = cursor.toLocaleDateString("en-US", { month: "short" });
        if (!orderedLabels.includes(label)) {
          orderedLabels.push(label);
          map[label] = { name: label, present: 0, absent: 0, late: 0 };
          monthRanges[label] = {
            start: new Date(cursor.getFullYear(), cursor.getMonth(), 1),
            end: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0),
          };
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
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
        }
      }
    });

    // Calculate absent counts based on working days in the period
    orderedLabels.forEach((label, i) => {
      let workingDays = 0;

      if (period === "weekly") {
        const dayDate = new Date(firstDay);
        dayDate.setDate(firstDay.getDate() + i);
        dayDate.setHours(0, 0, 0, 0);

        const currentToday = new Date(today);
        currentToday.setHours(23, 59, 59, 999);

        if (dayDate <= currentToday) {
          const dayOfWeek = dayDate.getDay();
          // Monday (1) to Friday (5) are working days
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            workingDays = 1;
          }
        }
      } else if (period === "monthly") {
        const year = firstDay.getFullYear();
        const month = firstDay.getMonth();
        let weekStart: Date;
        let weekEnd: Date;

        if (i === 0) {
          weekStart = new Date(year, month, 1);
          weekEnd = new Date(year, month, 7);
        } else if (i === 1) {
          weekStart = new Date(year, month, 8);
          weekEnd = new Date(year, month, 14);
        } else if (i === 2) {
          weekStart = new Date(year, month, 15);
          weekEnd = new Date(year, month, 21);
        } else if (i === 3) {
          weekStart = new Date(year, month, 22);
          weekEnd = new Date(year, month, 28);
        } else {
          weekStart = new Date(year, month, 29);
          weekEnd = new Date(year, month + 1, 0);
        }

        const start = weekStart > firstDay ? weekStart : firstDay;
        const end = weekEnd < today ? weekEnd : today;

        if (start <= end) {
          workingDays = getWorkingDays(start, end);
        }
      } else {
        const range = monthRanges[label];
        if (range) {
          const start = range.start > firstDay ? range.start : firstDay;
          const end = range.end < today ? range.end : today;

          if (start <= end) {
            workingDays = getWorkingDays(start, end);
          }
        }
      }

      const expected = workingDays * activeEmployeesCount;
      map[label].absent = Math.max(0, expected - map[label].present);
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

    // ✅ CHANGED: Payroll reads from User, profile is optional
    const employees = await getActiveEmployees(tenantId);


    const departmentMap: Record<string, number> = {};

    employees.forEach((user) => {
        const profile = user.employeeProfile;

      const department =
        profile?.departmentRef?.name || profile?.department || "Unknown";

      if (!departmentMap[department]) {
        departmentMap[department] = 0;
      }

      departmentMap[department] +=  calculateSalary(profile?.salary);
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

    const {  startDate, endDate } = getReportRange(req.query.period);


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

    const { period, startDate, endDate, firstDay, today } = getReportRange(req.query.period);

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

    // ✅ CHANGED: Salary export also reads all active users
    const employees = await getActiveEmployees(tenantId);

    const formatted = await Promise.all(
      employees.map(async (user) => {
        const profile = user.employeeProfile;
        const salary = profile?.salary;

        const basic = salary?.basic || 0;
        const hra = salary?.hra || 0;
        const special = salary?.special || 0;
        const medical = salary?.medical || 0;
        const grossSalary = calculateSalary(salary);
        const finalGrossSalary = Math.round(grossSalary * multiplier);

        const deduction = await calculateAttendanceDeduction({
          tenantId,
          userId: user.id,
          grossSalary: finalGrossSalary,
          startDate,
          endDate,
          firstDay,
          today,
        });


        return {
          employeeId: user.id,
          name: user.name || "",
          email: user.email || "",
          department: profile?.departmentRef?.name || profile?.department || "",
          basic: Math.round(basic * multiplier),
          hra: Math.round(hra * multiplier),
          special: Math.round(special * multiplier),
          medical: Math.round(medical * multiplier),
          grossSalary: Math.round(grossSalary * multiplier),
          // ✅ NEW deduction fields
          workingDays: deduction.workingDays,
          lateCount: deduction.lateCount,
          lwpDays: deduction.lwpDays,
          lwpDeduction: deduction.lwpDeduction,
          netSalary: deduction.netSalary,
        };
      })
    );

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

         { header: "Employee ID", key: "employeeId", width: 15 },

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

// ✅ ADDED: Convert salary object safely
const toSalaryObject = (salary: any) => ({
  basic: Number(salary?.basic || 0),
  hra: Number(salary?.hra || 0),
  special: Number(salary?.special || 0),
  medical: Number(salary?.medical || 0),
  pf: Number(salary?.pf || 0),
  pt: Number(salary?.pt || 0),
  tax: Number(salary?.tax || 0),
  total: calculateSalary(salary),
});

// ✅ CHANGED: Salary is prorated only in joining month.
// ✅ From next month, salary will be full month.
const prorateSalaryByJoiningDate = (
  salary: any,
  joiningDate: Date | null | undefined,
  salaryMonth: string
) => {
  const [year, month] = salaryMonth.split("-").map(Number);

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const totalDays = monthEnd.getDate();

  let payableDays = totalDays;

  if (joiningDate) {
    const join = new Date(joiningDate);

    // ✅ If selected payslip month is before joining month
    if (monthEnd < join) {
      payableDays = 0;
    }

    // ✅ If selected payslip month is joining month
    else if (
      join.getFullYear() === year &&
      join.getMonth() === month - 1
    ) {
      payableDays = totalDays - join.getDate() + 1;
    }

    // ✅ If selected payslip month is after joining month
    else if (monthStart > join) {
      payableDays = totalDays;
    }
  }

  const ratio = payableDays / totalDays;

  return {
    payableDays,
    totalDays,

    basic: Math.round(Number(salary.basic || 0) * ratio),
    hra: Math.round(Number(salary.hra || 0) * ratio),
    special: Math.round(Number(salary.special || 0) * ratio),
    medical: Math.round(Number(salary.medical || 0) * ratio),

    pf: Math.round(Number(salary.pf || 0) * ratio),
    pt: Math.round(Number(salary.pt || 0) * ratio),
    tax: Math.round(Number(salary.tax || 0) * ratio),

    total: Math.round(Number(salary.total || 0) * ratio),
  };
};

// ✅ ADDED: Payslip API with month-wise salary + joining date proration
export const getEmployeePayslip = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req, res);
    if (!tenantId) return;

    const employeeId = Number(req.params.id);

    if (!employeeId || Number.isNaN(employeeId)) {
      return res.status(400).json({ message: "Invalid employee id" });
    }

    const salaryMonth =
      String(req.query.salaryMonth || "").trim() ||
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

    const employee = await prisma.user.findFirst({
      where: {
        id: employeeId,
        tenantId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        employeeProfile: {
          include: {
            salary: true,
            departmentRef: true,
            designationRef: true,

            // ✅ ADDED: salary revision history
            salaryHistory: {
              orderBy: {
                salaryMonth: "asc",
              },
            },
          },
        },
      },
    });

    if (!employee || !employee.employeeProfile) {
      return res.status(404).json({ message: "Employee not found" });
    }

    const profile = employee.employeeProfile;

    // ✅ ADDED: Block payslip before joining month
if (profile.joiningDate) {
  const join = new Date(profile.joiningDate);
  const [year, month] = salaryMonth.split("-").map(Number);

  // Selected payslip month end date
  const selectedMonthEnd = new Date(year, month, 0);

  // Example:
  // Joining date = 13 May 2026
  // April 2026 monthEnd = 30 Apr 2026, so block
  // May 2026 monthEnd = 31 May 2026, so allow
  if (selectedMonthEnd < join) {
    return res.status(400).json({
      message: `Payslip cannot be generated before joining month. Employee joined on ${join.toLocaleDateString("en-IN")}.`,
    });
  }
}

    // ✅ Find latest revision before or same selected month
    const latestRevisionBeforeOrSame = profile.salaryHistory
      .filter((item) => item.salaryMonth <= salaryMonth)
      .sort((a, b) => b.salaryMonth.localeCompare(a.salaryMonth))[0];

    // ✅ Find first revision after selected month
    const firstRevisionAfter = profile.salaryHistory
      .filter((item) => item.salaryMonth > salaryMonth)
      .sort((a, b) => a.salaryMonth.localeCompare(b.salaryMonth))[0];

    let selectedSalary: any;

    if (latestRevisionBeforeOrSame) {
      // ✅ Selected month is after salary update, use updated salary
      selectedSalary = {
        basic: latestRevisionBeforeOrSame.updatedBasic,
        hra: latestRevisionBeforeOrSame.updatedHra,
        special: latestRevisionBeforeOrSame.updatedSpecial,
        medical: latestRevisionBeforeOrSame.updatedMedical,
        pf: latestRevisionBeforeOrSame.updatedPf,
        pt: latestRevisionBeforeOrSame.updatedPt,
        tax: latestRevisionBeforeOrSame.updatedTax,
        total: latestRevisionBeforeOrSame.updatedTotal,
      };
    } else if (firstRevisionAfter) {
      // ✅ Selected month is before update, use previous salary
      selectedSalary = {
        basic: firstRevisionAfter.previousBasic,
        hra: firstRevisionAfter.previousHra,
        special: firstRevisionAfter.previousSpecial,
        medical: firstRevisionAfter.previousMedical,
        pf: firstRevisionAfter.previousPf,
        pt: firstRevisionAfter.previousPt,
        tax: firstRevisionAfter.previousTax,
        total: firstRevisionAfter.previousTotal,
      };
    } else {
      // ✅ No revision found, use current salary
      selectedSalary = toSalaryObject(profile.salary);
    }

    const payableSalary = prorateSalaryByJoiningDate(
      selectedSalary,
      profile.joiningDate,
      salaryMonth
    );

    return res.json({
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        department: profile.departmentRef?.name || profile.department || "",
        designation: profile.designationRef?.title || profile.title || "",
        joiningDate: profile.joiningDate,
      },

      salaryMonth,

      originalMonthlySalary: selectedSalary,

      payableSalary,

      salaryRevisionForMonth: latestRevisionBeforeOrSame || null,
    });
  } catch (error: any) {
    console.error("Payslip error:", error);
    return res.status(500).json({
      message: "Failed to load payslip",
      error: error.message,
    });
  }
};