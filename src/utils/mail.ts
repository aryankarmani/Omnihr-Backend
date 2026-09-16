import nodemailer from "nodemailer";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();

// Force Node.js to prefer IPv4 over IPv6 for all DNS lookups.
// Render's free tier doesn't support outbound IPv6, causing ENETUNREACH errors.
dns.setDefaultResultOrder("ipv4first");

const getTransporter = () => {
  const user = process.env.SMTP_USER?.trim();
  const rawPass = process.env.SMTP_PASS?.trim();
  const pass = rawPass?.replace(/\s+/g, ""); // Remove spaces from Google App Password

  if (!user || !pass) {
    return null;
  }

  const host = (process.env.SMTP_HOST || "smtp.gmail.com").trim();

  // If using Gmail, use the native 'gmail' service configuration for maximum cloud compatibility
  if (host.includes("gmail") || user.endsWith("@gmail.com")) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user,
        pass,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
};

export const sendMail = async ({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}) => {
  // 1. If Brevo API Key is provided, send via Brevo HTTPS REST API (allows sending to ANY recipient email)
  const brevoApiKey = process.env.BREVO_API_KEY?.trim();
  if (brevoApiKey) {
    try {
      const senderEmail = (process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER || "aryankarmani2003@gmail.com").trim();
      const senderName = process.env.BREVO_SENDER_NAME || "OmniHR";
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: to }],
          subject: subject,
          htmlContent: html,
          textContent: text,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || `Brevo API error: ${response.statusText}`);
      }

      console.log(`✅ Email sent successfully to ${to} via Brevo HTTP API`);
      return data;
    } catch (err) {
      console.error(`❌ Brevo HTTP error when sending email to ${to}:`, err);
      throw err;
    }
  }

  // 2. If Resend API Key is provided, send via HTTPS
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (resendApiKey) {
    try {
      const fromEmail = process.env.RESEND_FROM || "OmniHR <onboarding@resend.dev>";
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [to],
          subject: subject,
          html: html,
          text: text,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || `Resend API error: ${response.statusText}`);
      }

      console.log(`✅ Email sent successfully to ${to} via Resend HTTP API`);
      return data;
    } catch (err) {
      console.error(`❌ Resend HTTP error when sending email to ${to}:`, err);
      throw err;
    }
  }

  // 2. Fallback to Nodemailer SMTP (for local development)
  const transporter = getTransporter();

  if (!transporter) {
    console.log("⚠️ Email not configured (RESEND_API_KEY or SMTP_USER missing). Email skipped.");
    return;
  }

  const sender = process.env.SMTP_FROM || `OmniHR <${process.env.SMTP_USER}>`;

  try {
    const info = await transporter.sendMail({
      from: (process.env.SMTP_FROM || process.env.SMTP_USER || "").trim(),
      to,
      subject,
      html,
      text,
    });
    console.log(`✅ Email sent successfully to ${to} via SMTP`);
    return info;
  } catch (error) {
    console.error(`❌ Failed to send email to ${to} via SMTP:`, error);
    throw error;
  }
};

// ============================================================
// 1. Employee Welcome Email Template
// ============================================================
export const employeeWelcomeTemplate = ({
  name,
  email,
  password,
  loginUrl,
}: {
  name: string;
  email: string;
  password: string;
  loginUrl: string;
}) => {
  return {
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to OmniHR</title>
      </head>
      <body style="margin:0;padding:0;background-color:#F4F6FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#12151C;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#F4F6FB;padding:40px 16px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(44,79,214,0.08);border:1px solid #E2E6ED;">
                
                <!-- Brand Header -->
                <tr>
                  <td style="background:linear-gradient(135deg,#2C4FD6 0%,#1B36A8 100%);padding:36px 32px;text-align:center;">
                    <div style="display:inline-block;width:44px;height:44px;background:#ffffff;border-radius:8px;text-align:center;line-height:44px;font-size:22px;font-weight:800;color:#2C4FD6;margin-bottom:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                      O
                    </div>
                    <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">OmniHR</h1>
                    <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);font-weight:400;">All-in-One HR & Workforce Management</p>
                  </td>
                </tr>

                <!-- Content Area -->
                <tr>
                  <td style="padding:36px 32px;">
                    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#12151C;">Welcome aboard, ${name}! 👋</h2>
                    <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#5B6472;">
                      Your employee account has been created on the <strong>OmniHR</strong> portal. You can now access your attendance, leaves, directory, and workspace tools.
                    </p>

                    <!-- Credentials Box -->
                    <div style="background:#F7F8FA;border:1px solid #E2E6ED;border-radius:8px;padding:20px;margin-bottom:24px;">
                      <div style="margin-bottom:14px;">
                        <span style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#717E95;margin-bottom:4px;">Registered Email</span>
                        <span style="font-size:15px;font-weight:600;color:#12151C;">${email}</span>
                      </div>
                      <div>
                        <span style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#717E95;margin-bottom:4px;">Temporary Password</span>
                        <span style="display:inline-block;background:#E8ECFC;color:#2C4FD6;font-family:monospace;font-size:16px;font-weight:700;padding:4px 10px;border-radius:6px;letter-spacing:1px;">${password}</span>
                      </div>
                    </div>

                    <!-- Security / Action Notice -->
                    <div style="background:#FFF9EB;border-left:4px solid #F59E0B;border-radius:0 8px 8px 0;padding:16px;margin-bottom:28px;">
                      <div style="display:flex;align-items:center;margin-bottom:4px;">
                        <strong style="color:#B45309;font-size:13px;">🔒 Security Step (Recommended before login)</strong>
                      </div>
                      <p style="margin:0;color:#92400E;font-size:13px;line-height:1.5;">
                        Before logging in for the first time, please click on <strong>"Forgot Password"</strong> on the sign-in screen to set your own secure permanent password using your registered email.
                      </p>
                    </div>

                    <!-- CTA Button -->
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center" style="padding-bottom:24px;">
                          <a href="${loginUrl}" style="display:inline-block;background:#2C4FD6;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 32px;border-radius:6px;box-shadow:0 4px 14px rgba(44,79,214,0.3);">
                            Open OmniHR Portal →
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:0;font-size:12px;color:#9AA3B1;line-height:1.5;text-align:center;">
                      If the button does not work, copy and paste this link into your browser:<br/>
                      <a href="${loginUrl}" style="color:#2C4FD6;text-decoration:none;word-break:break-all;">${loginUrl}</a>
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background:#F7F8FA;border-top:1px solid #E2E6ED;padding:20px 32px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#717E95;">
                      © ${new Date().getFullYear()} OmniHR SaaS Platform. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `Welcome to OmniHR, ${name}! Your employee account is ready. Registered Email: ${email} | Temporary Password: ${password}. For security, before your first login, please click 'Forgot Password' on the login screen (${loginUrl}) to set your own password.`,
  };
};

// ============================================================
// 2. Company Onboarding Email Template (Subscription / Payment)
// ============================================================
export const companyOnboardingTemplate = ({
  companyName,
  adminName,
  email,
  password,
  loginUrl,
  planName,
  billingCycle,
}: {
  companyName: string;
  adminName: string;
  email: string;
  password: string;
  loginUrl: string;
  planName: string;
  billingCycle: string;
}) => {
  return {
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to OmniHR</title>
      </head>
      <body style="margin:0;padding:0;background-color:#F4F6FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#12151C;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#F4F6FB;padding:40px 16px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(44,79,214,0.08);border:1px solid #E2E6ED;">
                
                <!-- Brand Header -->
                <tr>
                  <td style="background:linear-gradient(135deg,#2C4FD6 0%,#1B36A8 100%);padding:36px 32px;text-align:center;">
                    <div style="display:inline-block;width:46px;height:46px;background:#ffffff;border-radius:8px;text-align:center;line-height:46px;font-size:24px;font-weight:800;color:#2C4FD6;margin-bottom:12px;box-shadow:0 4px 14px rgba(0,0,0,0.15);">
                      O
                    </div>
                    <h1 style="margin:0;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">OmniHR</h1>
                    <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.9);">All-in-One HR & Organization Management</p>
                  </td>
                </tr>

                <!-- Content Body -->
                <tr>
                  <td style="padding:36px 32px;">
                    <h2 style="margin:0 0 12px;font-size:21px;font-weight:700;color:#12151C;">Welcome to OmniHR, ${adminName}! 🎉</h2>
                    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#5B6472;">
                      Thank you for choosing OmniHR. Your <strong>${planName} Plan (${billingCycle})</strong> subscription for <strong>${companyName}</strong> has been activated, and your organization admin workspace is ready.
                    </p>

                    <!-- Account Details Box -->
                    <div style="background:#F7F8FA;border:1px solid #E2E6ED;border-radius:8px;padding:22px;margin-bottom:24px;">
                      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size:14px;">
                        <tr>
                          <td style="padding:6px 0;color:#717E95;font-size:12px;font-weight:600;text-transform:uppercase;">Company Workspace:</td>
                          <td style="padding:6px 0;color:#12151C;font-weight:700;text-align:right;">${companyName}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#717E95;font-size:12px;font-weight:600;text-transform:uppercase;">Subscription Plan:</td>
                          <td style="padding:6px 0;color:#2C4FD6;font-weight:700;text-align:right;">${planName} (${billingCycle})</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#717E95;font-size:12px;font-weight:600;text-transform:uppercase;">Admin Login Email:</td>
                          <td style="padding:6px 0;color:#12151C;font-weight:700;text-align:right;">${email}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#717E95;font-size:12px;font-weight:600;text-transform:uppercase;">Temporary Password:</td>
                          <td style="padding:6px 0;text-align:right;">
                            <span style="background:#E8ECFC;color:#2C4FD6;font-family:monospace;font-size:15px;font-weight:700;padding:3px 8px;border-radius:4px;">${password}</span>
                          </td>
                        </tr>
                      </table>
                    </div>

                    <!-- Security Notice Box -->
                    <div style="background:#FFF9EB;border-left:4px solid #F59E0B;border-radius:0 8px 8px 0;padding:16px;margin-bottom:28px;">
                      <div style="margin-bottom:4px;">
                        <strong style="color:#B45309;font-size:13px;">🔒 Important Security Step</strong>
                      </div>
                      <p style="margin:0;color:#92400E;font-size:13px;line-height:1.5;">
                        Before logging in for the first time, please click on <strong>"Forgot Password"</strong> on the sign-in page to verify your email and set your own secure permanent password.
                      </p>
                    </div>

                    <!-- CTA Button -->
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center" style="padding-bottom:24px;">
                          <a href="${loginUrl}" style="display:inline-block;background:#2C4FD6;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 36px;border-radius:6px;box-shadow:0 4px 14px rgba(44,79,214,0.3);">
                            Log In to Your Workspace →
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:0;font-size:12px;color:#9AA3B1;line-height:1.5;text-align:center;">
                      If the button above does not work, visit:<br/>
                      <a href="${loginUrl}" style="color:#2C4FD6;text-decoration:none;word-break:break-all;">${loginUrl}</a>
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background:#F7F8FA;border-top:1px solid #E2E6ED;padding:20px 32px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#717E95;">
                      © ${new Date().getFullYear()} OmniHR SaaS Platform. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `Welcome to OmniHR, ${adminName}! Your ${planName} subscription (${billingCycle}) for ${companyName} is ready. Workspace Login: ${loginUrl} | Email: ${email} | Temporary Password: ${password}. Important: Before logging in for the first time, please click on 'Forgot Password' on the login page to set your own password.`,
  };
};

// ============================================================
// 3. OTP Verification Email Template
// ============================================================
export const otpTemplate = ({ otp }: { otp: string }) => {
  return {
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>OmniHR Verification Code</title>
      </head>
      <body style="margin:0;padding:0;background-color:#F4F6FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#12151C;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#F4F6FB;padding:40px 16px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(44,79,214,0.08);border:1px solid #E2E6ED;">
                
                <!-- Brand Header -->
                <tr>
                  <td style="background:linear-gradient(135deg,#2C4FD6 0%,#1B36A8 100%);padding:30px 24px;text-align:center;">
                    <div style="display:inline-block;width:42px;height:42px;background:#ffffff;border-radius:8px;text-align:center;line-height:42px;font-size:20px;font-weight:800;color:#2C4FD6;margin-bottom:10px;">
                      O
                    </div>
                    <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">OmniHR</h1>
                    <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.85);">Security Verification</p>
                  </td>
                </tr>

                <!-- Content Area -->
                <tr>
                  <td style="padding:32px 28px;text-align:center;">
                    <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#12151C;">Your One-Time Password (OTP)</h2>
                    <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#5B6472;">
                      Use the 6-digit verification code below to reset your password.
                    </p>

                    <div style="display:inline-block;background:#E8ECFC;border:1px solid #2C4FD6;border-radius:8px;padding:14px 28px;margin-bottom:20px;">
                      <span style="font-family:monospace;font-size:30px;font-weight:800;letter-spacing:8px;color:#2C4FD6;">
                        ${otp}
                      </span>
                    </div>

                    <p style="margin:0 0 4px;font-size:12px;color:#B45309;font-weight:600;">
                      ⏰ This code will expire in 10 minutes.
                    </p>
                    <p style="margin:0;font-size:12px;color:#9AA3B1;">
                      If you did not request this verification code, you can safely ignore this email.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background:#F7F8FA;border-top:1px solid #E2E6ED;padding:16px 24px;text-align:center;">
                    <p style="margin:0;font-size:11px;color:#717E95;">
                      © ${new Date().getFullYear()} OmniHR SaaS Platform. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `Your OmniHR verification code is ${otp}. This code is valid for 10 minutes.`,
  };
};