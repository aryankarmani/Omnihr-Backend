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

// ✅ ADDED: Professional employee welcome email template
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
      <div style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,sans-serif;">
        <div style="max-width:620px;margin:0 auto;padding:30px 15px;">
          <div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">
            
            <div style="background:linear-gradient(135deg,#2563eb,#0f172a);padding:28px;text-align:center;color:white;">
              <h1 style="margin:0;font-size:26px;">OmniHR</h1>
              <p style="margin:8px 0 0;font-size:14px;">Employee Management Portal</p>
            </div>

            <div style="padding:32px;">
              <h2 style="margin:0 0 10px;color:#111827;">Welcome, ${name} 👋</h2>
              <p style="color:#4b5563;font-size:15px;line-height:1.6;">
                Your employee account has been created successfully. Use the credentials below to login.
              </p>

              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:18px;margin:24px 0;">
                <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Email</p>
                <p style="margin:0 0 18px;color:#111827;font-size:16px;font-weight:bold;">${email}</p>

                <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Temporary Password</p>
                <p style="margin:0;color:#111827;font-size:18px;font-weight:bold;letter-spacing:1px;">${password}</p>
              </div>

              <div style="text-align:center;margin:30px 0;">
                <a href="${loginUrl}" 
                   style="display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:bold;font-size:15px;">
                  Login To OmniHR
                </a>
              </div>

              <p style="color:#ef4444;font-size:14px;line-height:1.6;">
                Security Note: Please change your password after your first login.
              </p>

              <p style="color:#6b7280;font-size:13px;margin-top:24px;">
                If the button does not work, copy this link:<br/>
                <a href="${loginUrl}" style="color:#2563eb;">${loginUrl}</a>
              </p>
            </div>

            <div style="background:#f9fafb;padding:18px;text-align:center;color:#6b7280;font-size:12px;">
              © ${new Date().getFullYear()} OmniHR. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    `,
    text: `Welcome ${name}. Your OmniHR account has been created. Email: ${email}, Temporary Password: ${password}, Login: ${loginUrl}`,
  };
};

// ✅ ADDED: Professional OTP email template
export const otpTemplate = ({ otp }: { otp: string }) => {
  return {
    html: `
      <div style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,sans-serif;">
        <div style="max-width:560px;margin:0 auto;padding:30px 15px;">
          <div style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">
            <div style="background:#0f172a;padding:24px;text-align:center;color:white;">
              <h2 style="margin:0;">OmniHR</h2>
              <p style="margin:8px 0 0;font-size:14px;">Password Reset Verification</p>
            </div>

            <div style="padding:30px;text-align:center;">
              <h2 style="color:#111827;">Your OTP Code</h2>
              <p style="color:#4b5563;">Use the OTP below to reset your password.</p>

              <div style="margin:25px auto;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:18px;font-size:32px;font-weight:bold;letter-spacing:8px;color:#2563eb;">
                ${otp}
              </div>

              <p style="color:#ef4444;font-size:14px;">This OTP is valid for 10 minutes.</p>
            </div>
          </div>
        </div>
      </div>
    `,
    text: `Your OmniHR OTP is ${otp}. It is valid for 10 minutes.`,
  };
};