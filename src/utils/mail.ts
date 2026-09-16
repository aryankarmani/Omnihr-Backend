import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

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
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log("SMTP not configured. Email skipped.");
    return;
  }

  const sender = process.env.SMTP_FROM || `OmniHR <${process.env.SMTP_USER}>`;

  await transporter.sendMail({
    from: sender,
    to,
    subject,
    html,
    text,
  });
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