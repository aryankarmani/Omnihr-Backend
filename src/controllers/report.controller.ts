

// import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";

// // @ts-ignore
// import { Parser } from "json2csv";
// // @ts-ignore
// import PDFDocument from "pdfkit";
// import ExcelJS from "exceljs";

// const prisma = new PrismaClient();

// // helper..
// const getTenantId = (req: Request, res: Response) => {
//   const tenantId =
//   (req.headers["x-tenant-id"] as string) ||
//   (req.query.tenantId as string);
//   if (!tenantId) {
//     res.status(400).json({ message: "Tenant ID missing" });
//     return null;
//   }

//   return tenantId;
// };

// const calculateSalary = (salary: any): number => {
//   if (!salary) return 0;
//   return (salary.basic || 0) + (salary.hra || 0) + (salary.special || 0) + (salary.medical || 0);
// };






// // ================= DASHBOARD =================
// export const getDashboard = async (req: Request, res: Response) => {
//   try {
//     const tenantId = getTenantId(req, res);
//     if (!tenantId) return;
//     console.log("TENANT ID:", tenantId);


//     const employees = await prisma.employeeProfile.findMany({
//       where: { tenantId },
//       include: { salary: true }
//     });
//     console.log("EMPLOYEES:", employees);

//     let totalPayroll = 0;
//     employees.forEach(emp => {
//       if (emp.salary) totalPayroll += calculateSalary(emp.salary);
//     });

//     // ✅ AVG ATTENDANCE — working days based, capped at 100
//     const today = new Date();
//     const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
//     const firstDayStr = firstDayOfMonth.toISOString().split('T')[0];
//     const todayStr = today.toISOString().split('T')[0];

//     const attendance = await prisma.attendanceRecord.findMany({
//       where: {
//         tenantId,
//         date: { gte: firstDayStr, lte: todayStr }
//       }
//     });
//     console.log("ATTENDANCE:", attendance);

//     const totalEmployees = employees.length;

//     // Count working days elapsed this month (Mon-Fri)
//     let workingDaysElapsed = 0;
//     const cursor = new Date(firstDayOfMonth);
//     while (cursor <= today) {
//       const dow = cursor.getDay();
//       if (dow !== 0 && dow !== 6) workingDaysElapsed++;
//       cursor.setDate(cursor.getDate() + 1);
//     }

//     const totalExpected = workingDaysElapsed * totalEmployees;
//     const presentCount = attendance.filter(a => {
//       const s = String(a.status).toLowerCase();
//       return s === 'present' || s === 'late';
//     }).length;

//     const avgAttendance = totalExpected > 0
//       ? Math.min(100, Math.round((presentCount / totalExpected) * 100))
//       : 0;

//     const leaves = await prisma.leave.findMany({
//       where: { tenantId }
//     });
//     console.log("LEAVES:", leaves);



//     const pendingLeaves = leaves.filter(l =>
//       String(l.status).toLowerCase() === "pending"
//     ).length;

//     return res.json({
//       totalPayroll,
//       avgAttendance,
//       pendingLeaves,
//       payrollGrowth: "+5%",
//       attendanceTrend: "Stable",
//       leaveStatus: "Needs Attention"
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Dashboard error" });
//   }
// };

// // ================= ATTENDANCE =================
// export const getAttendance = async (req: Request, res: Response) => {
//   try {
//     const tenantId = getTenantId(req, res);
//     if (!tenantId) return;

//     const records = await prisma.attendanceRecord.findMany({
//       where: { tenantId }
//     });

//     const map: any = {};

//     records.forEach(r => {
//       const day = new Date(r.date).toLocaleDateString("en-US", { weekday: "short" });

//       if (!map[day]) {
//         map[day] = { name: day, present: 0, absent: 0, late: 0 };
//       }

//       const status = (r.status || "").toUpperCase();

//       if (status === "PRESENT") map[day].present++;
//       else if (status === "ABSENT") map[day].absent++;
//       else if (status === "LATE") map[day].late++;
//     });

//     return res.json(Object.values(map));

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Attendance error" });
//   }
// };



// // ================= PAYROLL =================
// export const getPayroll = async (req: Request, res: Response) => {
//   try {
//     const tenantId = getTenantId(req, res);
//     if (!tenantId) return;

//     const employees = await prisma.employeeProfile.findMany({
//       where: { tenantId },
//       include: { salary: true }
//     });

//     const deptMap: any = {};

//     employees.forEach(emp => {
//       const dept = emp.department || "Unknown";

//       if (!deptMap[dept]) deptMap[dept] = 0;

//       if (emp.salary) {
//         deptMap[dept] += calculateSalary(emp.salary);
//       }
//     });

//     const result = Object.entries(deptMap).map(([name, value]) => ({
//       name,
//       value
//     }));

//     return res.json(result);

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Payroll error" });
//   }
// };



// // ================= CSV EXPORT =================
// export const exportMonthlyAttendance = async (req: Request, res: Response) => {
//   try {
//     const tenantId = getTenantId(req, res);
//     if (!tenantId) return;

//     const data = await prisma.attendanceRecord.findMany({
//       where: { tenantId }
//     });

//     if (!data.length) return res.send("No attendance data");

//     const formatted = data.map(a => ({
//       userId: a.userId,
//       date: new Date(a.date).toLocaleDateString("en-GB"),
//       status: a.status,
//       hours: a.hours || 0
//     }));

//     const parser = new Parser({
//       fields: ["userId", "date", "status", "hours"]
//     });

//     const csv = parser.parse(formatted);

//     res.setHeader("Content-Type", "text/csv");
//     res.setHeader("Content-Disposition", "attachment; filename=attendance.csv");

//     return res.send(csv);

//   } catch (err) {
//     console.error(err);
//     res.status(500).send("CSV export error");
//   }
// };



// // ================= PDF EXPORT =================
// export const exportSalaryRegister = async (req: Request, res: Response) => {
//   try {
//     const tenantId = getTenantId(req, res);
//     if (!tenantId) return;

//     const employees = await prisma.employeeProfile.findMany({
//       where: { tenantId },
//       include: { user: true, salary: true }
//     });

//     const doc = new PDFDocument();

//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader("Content-Disposition", "attachment; filename=salary.pdf");

//     doc.pipe(res);

//     doc.fontSize(18).text("Salary Register", { align: "center" });
//     doc.moveDown();

//     employees.forEach(emp => {
//       const salary = calculateSalary(emp.salary);

//       doc.text(`Name: ${emp.user.name}`);
//       doc.text(`Department: ${emp.department}`);
//       doc.text(`Salary: ₹ ${salary}`);
//       doc.moveDown();
//     });

//     doc.end();

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "PDF export error" });
//   }
// };



// // ================= EXCEL EXPORT =================
// export const exportLeaveBalance = async (req: Request, res: Response) => {
//   try {
//     const tenantId = getTenantId(req, res);
//     if (!tenantId) return;

//     const leaves = await prisma.leave.findMany({
//       where: { tenantId },
//       include: { user: true }
//     });

//     const workbook = new ExcelJS.Workbook();
//     const sheet = workbook.addWorksheet("Leaves");

//     sheet.columns = [
//       { header: "Employee", key: "name", width: 20 },
//       { header: "Status", key: "status", width: 15 },
//       { header: "Start Date", key: "start", width: 20 },
//       { header: "End Date", key: "end", width: 20 }
//     ];

//     leaves.forEach(l => {
//       sheet.addRow({
//         name: l.user.name,
//         status: l.status,
//         start: l.startDate,
//         end: l.endDate
//       });
//     });

//     res.setHeader(
//       "Content-Type",
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
//     );

//     res.setHeader("Content-Disposition", "attachment; filename=leave.xlsx");

//     await workbook.xlsx.write(res);
//     res.end();

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Excel export error" });
//   }
// };

// // ===========v====== TEST CREATE APIs =================
// export const createAttendance = async (req: Request, res: Response) => {
//   try {
//     const data = await prisma.attendanceRecord.create({ data: req.body });
//     res.json(data);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json(err);
//   }
// };

// export const createLeave = async (req: Request, res: Response) => {
//   try {
//     const data = await prisma.leave.create({ data: req.body });
//     res.json(data);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json(err);
//   }
// };

// export const createEmployeeProfile = async (req: Request, res: Response) => {
//   try {
//     const data = await prisma.employeeProfile.create({ data: req.body });
//     res.json(data);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json(err);
//   }
// };

// export const createSalary = async (req: Request, res: Response) => {
//   try {
//     const data = await prisma.salaryStructure.create({ data: req.body });
//     res.json(data);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json(err);
//   }
// };





import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

// @ts-ignore
import { Parser } from "json2csv";

// @ts-ignore
import PDFDocument from "pdfkit";

import ExcelJS from "exceljs";

const prisma = new PrismaClient();

// ================= TENANT HELPER =================
const getTenantId = (req: Request, res: Response) => {
  const tenantId =
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

// ================= DASHBOARD =================
export const getDashboard = async (
  req: Request,
  res: Response
) => {
  try {
    const tenantId = getTenantId(req, res);

    if (!tenantId) return;

    const employees = await prisma.employeeProfile.findMany({
      where: { tenantId },
      include: { salary: true }
    });

    let totalPayroll = 0;

    employees.forEach((emp) => {
      if (emp.salary) {
        totalPayroll += calculateSalary(emp.salary);
      }
    });

    // ===== ATTENDANCE =====
    const today = new Date();

    const firstDayOfMonth = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    const firstDayStr = firstDayOfMonth
      .toISOString()
      .split("T")[0];

    const todayStr = today
      .toISOString()
      .split("T")[0];

    const attendance = await prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        date: {
          gte: firstDayStr,
          lte: todayStr
        }
      }
    });

    const totalEmployees = employees.length;

    // ===== WORKING DAYS =====
    let workingDaysElapsed = 0;

    const cursor = new Date(firstDayOfMonth);

    while (cursor <= today) {
      const dow = cursor.getDay();

      if (dow !== 0 && dow !== 6) {
        workingDaysElapsed++;
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    const totalExpected =
      workingDaysElapsed * totalEmployees;

    const presentCount = attendance.filter((a) => {
      const s = String(a.status).toLowerCase();

      return s === "present" || s === "late";
    }).length;

    const avgAttendance =
      totalExpected > 0
        ? Math.min(
          100,
          Math.round(
            (presentCount / totalExpected) * 100
          )
        )
        : 0;

    // ===== LEAVES =====
    const leaves = await prisma.leave.findMany({
      where: { tenantId }
    });

    const pendingLeaves = leaves.filter(
      (l) =>
        String(l.status).toLowerCase() ===
        "pending"
    ).length;

    return res.json({
      totalPayroll,
      avgAttendance,
      pendingLeaves,
      payrollGrowth: "+5%",
      attendanceTrend: "Stable",
      leaveStatus:
        pendingLeaves > 5
          ? "Needs Attention"
          : "Under Control"
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Dashboard error"
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

    const records =
      await prisma.attendanceRecord.findMany({
        where: { tenantId }
      });

    const map: any = {};

    records.forEach((r) => {
      const day = new Date(r.date)
        .toLocaleDateString("en-US", {
          weekday: "short"
        });

      if (!map[day]) {
        map[day] = {
          name: day,
          present: 0,
          absent: 0,
          late: 0
        };
      }

      const status = (
        r.status || ""
      ).toUpperCase();

      if (status === "PRESENT") {
        map[day].present++;
      } else if (status === "ABSENT") {
        map[day].absent++;
      } else if (status === "LATE") {
        map[day].late++;
      }
    });

    return res.json(Object.values(map));

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Attendance error"
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

    const employees = await prisma.employeeProfile.findMany({
      where: { tenantId },
      include: { salary: true }
    });

    const deptMap: any = {};

    employees.forEach((emp) => {
      const dept =
        emp.department || "Unknown";

      if (!deptMap[dept]) {
        deptMap[dept] = 0;
      }

      if (emp.salary) {
        deptMap[dept] += calculateSalary(
          emp.salary
        );
      }
    });

    const result = Object.entries(deptMap).map(
      ([name, value]) => ({
        name,
        value
      })
    );

    return res.json(result);

  } catch (err) {
    console.error(err);

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

  console.log("EXPORT HIT");
  console.log("QUERY:", req.query);
  console.log("HEADERS:", req.headers);


  try {

    const tenantId =
      (req.headers["x-tenant-id"] as string) ||
      req.query.tenantId as string;

    if (!tenantId) {
      return res.status(400).json({
        message: "Tenant ID missing"
      });
    }

    const data =
      await prisma.attendanceRecord.findMany({
        where: { tenantId },

        include: {
          user: true
        }
      });


    if (!data.length) {
      return res.send(
        "No attendance data"
      );
    }


    const formatted = data.map((a) => ({

      userId: a.userId,

      name: a.user?.name || "",

      email: a.user?.email || "",

      date: new Date(a.date)
        .toLocaleDateString("en-GB"),

      status: a.status,

      hours: a.hours || 0

    }));



    const parser = new Parser({
      fields: [
        "userId",
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

  } catch (err) {
    console.error(err);

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

    const tenantId =
      (req.headers["x-tenant-id"] as string) ||
      req.query.tenantId as string;

    if (!tenantId) {
      return res.status(400).json({
        message: "Tenant ID missing"
      });
    }

    const employees =
      await prisma.employeeProfile.findMany({
        where: { tenantId },

        include: {
          user: true,
          salary: true
        }
      });

    const formatted = employees.map((emp) => ({

      employeeId: emp.userId,

      name: emp.user?.name || "",

      email: emp.user?.email || "",

      department: emp.department || "",

      salary: calculateSalary(emp.salary)

    }));

    const parser = new Parser({
      fields: [
        "employeeId",
        "name",
        "email",
        "department",
        "salary"
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

  } catch (err) {

    console.error(err);

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
  console.log("EXPORT HIT");
  console.log("QUERY:", req.query);
  console.log("HEADERS:", req.headers);

  try {

    const tenantId =
      (req.headers["x-tenant-id"] as string) ||
      req.query.tenantId as string;

    if (!tenantId) {
      return res.status(400).json({
        message: "Tenant ID missing"
      });
    }



    const leaves = await prisma.leave.findMany({
      where: { tenantId },
      include: { user: true }
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


    leaves.forEach((l) => {

      sheet.addRow({

        userId: l.userId,

        name: l.user?.name || "",

        email: l.user?.email || "",

        status: l.status,

        start: l.startDate,

        end: l.endDate

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
export const createAttendance = async (
  req: Request,
  res: Response
) => {
  try {
    const data =
      await prisma.attendanceRecord.create({
        data: req.body
      });

    res.json(data);

  } catch (err) {
    console.error(err);

    res.status(500).json(err);
  }
};

export const createLeave = async (
  req: Request,
  res: Response
) => {
  try {
    const data =
      await prisma.leave.create({
        data: req.body
      });

    res.json(data);

  } catch (err) {
    console.error(err);

    res.status(500).json(err);
  }
};

export const createEmployeeProfile = async (
  req: Request,
  res: Response
) => {
  try {
    const data =
      await prisma.employeeProfile.create({
        data: req.body
      });

    res.json(data);

  } catch (err) {
    console.error(err);

    res.status(500).json(err);
  }
};

export const createSalary = async (
  req: Request,
  res: Response
) => {
  try {
    const data =
      await prisma.salaryStructure.create({
        data: req.body
      });

    res.json(data);

  } catch (err) {
    console.error(err);

    res.status(500).json(err);
  }
};
