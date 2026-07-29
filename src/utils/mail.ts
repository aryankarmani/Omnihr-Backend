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

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    text,
  });
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