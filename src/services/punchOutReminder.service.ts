import { PrismaClient } from "@prisma/client";
import { sendMail } from "../utils/mail";
import { createNotification } from "../utils/notification";
import { sendPushNotificationToUser } from "../controllers/pushNotification.controller";

const prisma = new PrismaClient();

interface ShiftTiming {
  name: string;
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  isNightShift: boolean;
}

/**
 * Resolves an employee's assigned shift or falls back to company default.
 */
async function resolveEmployeeShift(userId: number, tenantId: string): Promise<ShiftTiming> {
  try {
    const profile = await prisma.employeeProfile.findFirst({
      where: { userId, tenantId },
      include: { shiftRef: true },
    });

    if (profile?.shiftRef) {
      const s = profile.shiftRef;
      const isNight = Boolean(s.isNightShift) || Boolean(s.startTime && s.endTime && s.endTime < s.startTime);
      return {
        name: s.name || "Shift",
        startTime: s.startTime || "09:00",
        endTime: s.endTime || "18:00",
        isNightShift: isNight,
      };
    }

    const defaultShift = await prisma.shift.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });

    if (defaultShift) {
      const isNight = Boolean(defaultShift.isNightShift) || Boolean(defaultShift.startTime && defaultShift.endTime && defaultShift.endTime < defaultShift.startTime);
      return {
        name: defaultShift.name || "General Shift",
        startTime: defaultShift.startTime || "09:00",
        endTime: defaultShift.endTime || "18:00",
        isNightShift: isNight,
      };
    }
  } catch (err) {
    console.error(`[PunchOutReminder] Error fetching shift for user ${userId}:`, err);
  }

  return {
    name: "General Shift",
    startTime: "09:00",
    endTime: "18:00",
    isNightShift: false,
  };
}

/**
 * Computes the exact Date (in UTC) for the shift end + 45 minute deadline based on IST.
 */
function calculateShiftDeadline(recordDateStr: string, shift: ShiftTiming): Date {
  const [year, month, day] = recordDateStr.split("-").map(Number);
  const [sHour, sMin] = (shift.startTime || "09:00").split(":").map(Number);
  const [eHour, eMin] = (shift.endTime || "18:00").split(":").map(Number);

  // If shift crosses midnight (e.g., starts at 18:00 and ends at 02:00), end time is on next day
  const isOvernight = shift.isNightShift || (eHour < sHour) || (eHour === sHour && (eMin || 0) < (sMin || 0));

  const targetDay = isOvernight ? day + 1 : day;

  // Add 45 minutes to the shift's end time
  const totalDeadlineMinutes = eHour * 60 + (eMin || 0) + 45;
  const deadlineHour = Math.floor(totalDeadlineMinutes / 60);
  const deadlineMin = totalDeadlineMinutes % 60;

  // Handle possible date rollover if deadlineHour >= 24
  const rolloverDays = Math.floor(deadlineHour / 24);
  const normalizedHour = deadlineHour % 24;

  const baseDate = new Date(Date.UTC(year, month - 1, targetDay + rolloverDays, 0, 0, 0));
  const finalYear = baseDate.getUTCFullYear();
  const finalMonth = String(baseDate.getUTCMonth() + 1).padStart(2, "0");
  const finalDay = String(baseDate.getUTCDate()).padStart(2, "0");
  const hStr = String(normalizedHour).padStart(2, "0");
  const mStr = String(deadlineMin).padStart(2, "0");

  // Format as IST (+05:30)
  return new Date(`${finalYear}-${finalMonth}-${finalDay}T${hStr}:${mStr}:00+05:30`);
}

/**
 * Main worker function: checks all open attendance records and dispatches alerts for overdue punch-outs.
 */
export async function processMissedPunchOutReminders() {
  try {
    const now = new Date();
    // Only check records from the last 48 hours to avoid old abandoned records
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const openRecords = await prisma.attendanceRecord.findMany({
      where: {
        inTime: {
          not: null,
          gte: fortyEightHoursAgo,
        },
        outTime: null,
        user: {
          isActive: true,
          deletedAt: null,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (openRecords.length === 0) {
      return;
    }

    for (const record of openRecords) {
      try {
        if (!record.inTime || !record.date || !record.user) continue;

        const shift = await resolveEmployeeShift(record.userId, record.tenantId);
        const deadline = calculateShiftDeadline(record.date, shift);

        // Check if current time has passed the Shift End + 45 minute deadline
        if (now.getTime() < deadline.getTime()) {
          // Still within shift hours or under the 45-minute grace period
          continue;
        }

        // Check if an alert was already sent for this punch session
        const alreadyNotified = await prisma.notification.findFirst({
          where: {
            tenantId: record.tenantId,
            userId: record.userId,
            type: "attendance",
            title: "Missed Punch-Out Alert",
            createdAt: { gte: new Date(record.inTime) },
          },
        });

        if (alreadyNotified) {
          // Already alerted once for this punch-in session
          continue;
        }

        console.log(`[PunchOutReminder] Triggering missed punch-out alert for ${record.user.name} (${record.user.email}). Shift: ${shift.name} (${shift.startTime} - ${shift.endTime})`);

        const formattedInTime = new Date(record.inTime).toLocaleTimeString("en-US", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
        });

        const alertMessage = `You clocked in at ${formattedInTime} for your ${shift.name} shift (ended at ${shift.endTime}), but haven't punched out yet. Please punch out or request attendance regularization.`;

        // 1. In-App Notification
        await createNotification({
          tenantId: record.tenantId,
          userId: record.userId,
          title: "Missed Punch-Out Alert",
          message: alertMessage,
          type: "attendance",
          link: "/attendance",
        });

        // 2. Mobile/Web Push Notification (if token registered)
        try {
          await sendPushNotificationToUser(record.userId, "Missed Punch-Out Alert", alertMessage);
        } catch (pushErr) {
          // Non-blocking if FCM token is missing or expired
          console.warn(`[PunchOutReminder] Push notification skipped for user ${record.userId}:`, pushErr);
        }

        // 3. Email Alert
        if (record.user.email) {
          const frontendUrl = process.env.FRONTEND_URL || "https://omnihr-frontend.vercel.app";
          const emailHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h2 style="color: #4F46E5; margin: 0; font-size: 24px; font-weight: 700;">OmniHR</h2>
                <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Attendance & Workforce Management</p>
              </div>

              <div style="background-color: #FEF3C7; border-left: 4px solid #F59E0B; padding: 14px 16px; border-radius: 4px; margin-bottom: 20px;">
                <p style="margin: 0; color: #92400E; font-weight: 600; font-size: 14px;">
                  ⚠️ Missed Punch-Out Reminder
                </p>
              </div>

              <p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0;">
                Hi <strong>${record.user.name}</strong>,
              </p>

              <p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
                Our system detected that you are currently punched in, but it has been <strong>more than 45 minutes</strong> since your scheduled shift ended.
              </p>

              <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 14px 18px; margin: 18px 0;">
                <p style="margin: 4px 0; color: #475569; font-size: 13px;"><strong>Assigned Shift:</strong> ${shift.name}</p>
                <p style="margin: 4px 0; color: #475569; font-size: 13px;"><strong>Shift Timing:</strong> ${shift.startTime} – ${shift.endTime}</p>
                <p style="margin: 4px 0; color: #475569; font-size: 13px;"><strong>Punch-In Recorded:</strong> ${formattedInTime}</p>
              </div>

              <p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                If you are still working, you may ignore this message until you finish. If you already left, please clock out or submit an attendance correction request to ensure accurate payroll calculation.
              </p>

              <div style="text-align: center; margin: 24px 0;">
                <a href="${frontendUrl}/attendance" style="background-color: #4F46E5; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">
                  Punch Out Now
                </a>
              </div>

              <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 24px 0 16px 0;" />
              <p style="color: #94A3B8; font-size: 11px; text-align: center; margin: 0;">
                This is an automated attendance reminder from OmniHR. Please do not reply directly to this email.
              </p>
            </div>
          `;

          await sendMail({
            to: record.user.email,
            subject: `[OmniHR] Reminder: Missed Punch-Out for ${shift.name}`,
            html: emailHtml,
          });

          console.log(`[PunchOutReminder] ✅ Email reminder sent successfully to ${record.user.email}`);
        }
      } catch (itemErr) {
        console.error(`[PunchOutReminder] Failed processing record ID ${record.id} for user ${record.userId}:`, itemErr);
      }
    }
  } catch (error) {
    console.error("[PunchOutReminder] Error running missed punch-out background job:", error);
  }
}

/**
 * Initializes recurring background checking scheduler.
 */
export function initPunchOutReminderCron() {
  console.log("[PunchOutReminder] Initializing missed punch-out reminder scheduler (every 5 minutes)...");

  // Initial check after 15 seconds to allow DB connection to stabilize
  setTimeout(() => {
    processMissedPunchOutReminders();
  }, 15 * 1000);

  // Check every 5 minutes
  setInterval(() => {
    processMissedPunchOutReminders();
  }, 5 * 60 * 1000);
}
