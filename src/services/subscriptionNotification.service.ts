import { PrismaClient } from "@prisma/client";
import { sendMail } from "../utils/mail";

const prisma = new PrismaClient();

export const NOTIFICATION_INTERVALS: { days: number; type: string; title: string }[] = [
  { days: 30, type: "EXPIRY_30_DAYS", title: "OmniHR Subscription Expires in 30 Days" },
  { days: 15, type: "EXPIRY_15_DAYS", title: "OmniHR Subscription Expires in 15 Days" },
  { days: 7,  type: "EXPIRY_7_DAYS",  title: "Urgent: OmniHR Subscription Expires in 7 Days" },
  { days: 3,  type: "EXPIRY_3_DAYS",  title: "Critical: OmniHR Subscription Expires in 3 Days" },
  { days: 1,  type: "EXPIRY_1_DAY",   title: "Final Reminder: OmniHR Subscription Expires Tomorrow" },
  { days: 0,  type: "SUBSCRIPTION_EXPIRED", title: "Your OmniHR Subscription Has Expired" },
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
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 16px; background-color: #F4F6FB;">
        <div style="background: #ffffff; border: 1px solid #E2E6ED; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
          <div style="background: linear-gradient(135deg, #2C4FD6 0%, #1B36A8 100%); padding: 28px; text-align: center;">
            <div style="display: inline-block; width: 40px; height: 40px; background: #ffffff; border-radius: 8px; text-align: center; line-height: 40px; font-size: 20px; font-weight: 800; color: #2C4FD6; margin-bottom: 8px;">
              O
            </div>
            <h2 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">OmniHR</h2>
            <p style="margin: 4px 0 0; font-size: 12px; color: rgba(255,255,255,0.85);">Subscription & Billing</p>
          </div>

          <div style="padding: 28px;">
            <div style="padding: 16px; background-color: ${isExpired ? '#FEF2F2' : '#FFFBEB'}; border-left: 4px solid ${isExpired ? '#EF4444' : '#F59E0B'}; border-radius: 0 8px 8px 0; margin-bottom: 22px;">
              <strong style="color: ${isExpired ? '#991B1B' : '#92400E'}; font-size: 14px; display: block; margin-bottom: 4px;">
                ${isExpired ? '⚠️ Subscription Expired' : '⏰ Subscription Expiry Notice'}
              </strong>
              <p style="margin: 0; color: ${isExpired ? '#B91C1C' : '#B45309'}; font-size: 13px; line-height: 1.5;">
                ${messageBody}
              </p>
            </div>

            <div style="background: #F7F8FA; border: 1px solid #E2E6ED; border-radius: 8px; padding: 18px; margin-bottom: 22px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">
                <tr>
                  <td style="padding: 6px 0; color: #717E95; font-size: 12px; font-weight: 600; text-transform: uppercase;">Company:</td>
                  <td style="padding: 6px 0; color: #12151C; font-weight: 700; text-align: right;">${tenant.name}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #717E95; font-size: 12px; font-weight: 600; text-transform: uppercase;">Plan:</td>
                  <td style="padding: 6px 0; color: #2C4FD6; font-weight: 700; text-align: right;">${plan.name}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #717E95; font-size: 12px; font-weight: 600; text-transform: uppercase;">Expiry Date:</td>
                  <td style="padding: 6px 0; color: #12151C; font-weight: 700; text-align: right;">${expiryDateFormatted}</td>
                </tr>
              </table>
            </div>

            <p style="color: #5B6472; font-size: 13px; line-height: 1.6; margin: 0 0 20px;">
              Please renew your plan or contact support to ensure uninterrupted service for your team and organization.
            </p>

            <hr style="border: none; border-top: 1px solid #E2E6ED; margin: 20px 0;" />
            <p style="color: #9AA3B1; font-size: 11px; margin: 0; text-align: center;">
              This is an automated notification from OmniHR SaaS Platform.
            </p>
          </div>
        </div>
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
  const subject = `OmniHR: Subscription Update Reminder (${subscription.tenant.name})`;

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
