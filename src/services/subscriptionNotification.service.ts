import { PrismaClient } from "@prisma/client";
import { sendMail } from "../utils/mail";

const prisma = new PrismaClient();

export const NOTIFICATION_INTERVALS: { days: number; type: string; title: string }[] = [
  { days: 30, type: "EXPIRY_30_DAYS", title: "Encalm HRMS Subscription Expires in 30 Days" },
  { days: 15, type: "EXPIRY_15_DAYS", title: "Encalm HRMS Subscription Expires in 15 Days" },
  { days: 7,  type: "EXPIRY_7_DAYS",  title: "Urgent: Encalm HRMS Subscription Expires in 7 Days" },
  { days: 3,  type: "EXPIRY_3_DAYS",  title: "Critical: Encalm HRMS Subscription Expires in 3 Days" },
  { days: 1,  type: "EXPIRY_1_DAY",   title: "Final Reminder: Encalm HRMS Subscription Expires Tomorrow" },
  { days: 0,  type: "SUBSCRIPTION_EXPIRED", title: "Your Encalm HRMS Subscription Has Expired" },
];

/**
 * Evaluates active and expiring subscriptions, checks deduplication,
 * creates in-app tenant notifications and dispatches emails.
 */
export async function processSubscriptionExpiryReminders() {
  try {
    const now = new Date();

    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: { in: ["ACTIVE", "EXPIRING_SOON"] },
      },
      include: {
        tenant: {
          include: {
            users: {
              where: {
                role: {
                  name: { in: ["HR_ADMIN", "Admin", "HR Admin", "ADMIN"] },
                },
                isActive: true,
              },
              select: { id: true, email: true, name: true },
            },
          },
        },
        plan: true,
        notifications: true,
      },
    });

    for (const sub of subscriptions) {
      const end = new Date(sub.endDate);
      const diffMs = end.getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      // Synchronize database subscription status
      if (daysRemaining <= 0 && sub.status !== "EXPIRED") {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: "EXPIRED" },
        });
      } else if (daysRemaining <= 7 && daysRemaining > 0 && sub.status !== "EXPIRING_SOON") {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: "EXPIRING_SOON" },
        });
      }

      // Check applicable cadence alert
      for (const cadence of NOTIFICATION_INTERVALS) {
        if (daysRemaining <= cadence.days) {
          // Check if this exact notification has already been sent for this subscription
          const alreadySent = sub.notifications.some(
            (n) => n.notificationType === cadence.type && n.status === "SENT"
          );

          if (!alreadySent) {
            await dispatchExpiryNotification(sub, cadence.type, cadence.title, daysRemaining);
            break; // Send highest-urgency matching cadence only per check
          }
        }
      }
    }
  } catch (error) {
    console.error("Error processing subscription expiry reminders:", error);
  }
}

/**
 * Dispatches notification to in-app notification center and sends email.
 */
async function dispatchExpiryNotification(
  subscription: any,
  notificationType: string,
  subjectTitle: string,
  daysRemaining: number
) {
  const tenant = subscription.tenant;
  const plan = subscription.plan;
  const expiryDateFormatted = new Date(subscription.endDate).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const isExpired = daysRemaining <= 0;
  const messageBody = isExpired
    ? `Your ${plan.name} subscription expired on ${expiryDateFormatted}. Please contact the platform administrator to renew.`
    : `Your ${plan.name} subscription will expire in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} on ${expiryDateFormatted}. Please renew your plan to prevent service interruption.`;

  // 1. Create audit record in SubscriptionNotification
  const notifRecord = await prisma.subscriptionNotification.create({
    data: {
      tenantId: tenant.id,
      subscriptionId: subscription.id,
      notificationType,
      scheduledDate: new Date(),
      status: "PENDING",
      channel: "IN_APP",
      message: messageBody,
    },
  });

  try {
    // 2. Deliver in-app notification to all HR Admins of this tenant
    for (const hrUser of tenant.users || []) {
      await prisma.notification.create({
        data: {
          tenantId: tenant.id,
          userId: hrUser.id,
          title: subjectTitle,
          message: messageBody,
          type: isExpired ? "error" : "warning",
          unread: true,
        },
      });
    }

    // 3. Send email to primary tenant email and HR Admins
    const recipientEmails = new Set<string>();
    if (tenant.contactEmail) recipientEmails.add(tenant.contactEmail);
    for (const u of tenant.users || []) {
      if (u.email) recipientEmails.add(u.email);
    }

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;">
        <div style="display: flex; align-items: center; margin-bottom: 20px;">
          <h2 style="color: #111827; margin: 0; font-size: 20px; font-weight: 700;">Encalm HRMS</h2>
        </div>
        <div style="padding: 16px; background-color: ${isExpired ? "#fee2e2" : "#fef3c7"}; border-radius: 6px; margin-bottom: 20px;">
          <strong style="color: ${isExpired ? "#991b1b" : "#92400e"}; font-size: 15px;">
            ${isExpired ? "⚠️ Subscription Expired" : "⏰ Subscription Expiry Notice"}
          </strong>
          <p style="margin: 8px 0 0; color: ${isExpired ? "#b91c1c" : "#b45309"}; font-size: 14px; line-height: 1.5;">
            ${messageBody}
          </p>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Company:</td>
            <td style="padding: 8px 0; color: #111827; font-weight: 600; text-align: right;">${tenant.name}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Plan:</td>
            <td style="padding: 8px 0; color: #111827; font-weight: 600; text-align: right;">${plan.name}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Expiry Date:</td>
            <td style="padding: 8px 0; color: #111827; font-weight: 600; text-align: right;">${expiryDateFormatted}</td>
          </tr>
        </table>
        <p style="color: #4b5563; font-size: 13px; line-height: 1.5;">
          Please contact your platform administrator or account manager to renew your subscription and maintain uninterrupted access.
        </p>
        <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 24px 0;" />
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">
          This is an automated notification from Encalm HRMS SaaS Platform.
        </p>
      </div>
    `;

    for (const email of recipientEmails) {
      await sendMail({
        to: email,
        subject: subjectTitle,
        html: emailHtml,
        text: messageBody,
      });
    }

    // 4. Update audit log
    await prisma.subscriptionNotification.update({
      where: { id: notifRecord.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
      },
    });
  } catch (err: any) {
    console.error("Failed to deliver notification:", err);
    await prisma.subscriptionNotification.update({
      where: { id: notifRecord.id },
      data: {
        status: "FAILED",
        message: `${messageBody} (Error: ${err.message})`,
      },
    });
  }
}

/**
 * Allows Super Admin to manually send an on-demand reminder to any company.
 */
export async function sendManualExpiryReminder(subscriptionId: string, customNote?: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      tenant: {
        include: {
          users: {
            where: {
              role: {
                name: { in: ["HR_ADMIN", "Admin", "HR Admin", "ADMIN"] },
              },
              isActive: true,
            },
            select: { id: true, email: true, name: true },
          },
        },
      },
      plan: true,
    },
  });

  if (!subscription) {
    throw new Error("Subscription not found.");
  }

  const now = new Date();
  const end = new Date(subscription.endDate);
  const daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const subject = `Encalm HRMS: Subscription Update Reminder (${subscription.tenant.name})`;

  await dispatchExpiryNotification(
    subscription,
    "MANUAL_REMINDER",
    subject,
    daysRemaining
  );

  return { success: true, message: "Manual reminder successfully dispatched." };
}

/**
 * Initializes recurring background checking scheduler.
 */
export function initSubscriptionCron() {
  // Run check on startup
  processSubscriptionExpiryReminders();

  // Run every 60 minutes
  setInterval(() => {
    processSubscriptionExpiryReminders();
  }, 60 * 60 * 1000);
}
