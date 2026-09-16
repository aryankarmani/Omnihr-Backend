import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { sendMail } from "../utils/mail";

const prisma = new PrismaClient();

/**
 * POST /api/public/demo-request
 * Public endpoint: Allows visitors to submit a demo request or contact lead
 */
export const createDemoRequest = async (req: Request, res: Response) => {
  try {
    const { email, name, phone, companyName, teamSize, message, source } = req.body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required",
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Create demo request in database
    const demoReq = await (prisma as any).demoRequest.create({
      data: {
        email: cleanEmail,
        name: name ? String(name).trim() : null,
        phone: phone ? String(phone).trim() : null,
        companyName: companyName ? String(companyName).trim() : null,
        teamSize: teamSize ? String(teamSize).trim() : null,
        message: message ? String(message).trim() : null,
        source: source ? String(source).trim() : "BOTTOM_BANNER",
        status: "PENDING",
      },
    });

    // Optionally send an acknowledgment email to the user
    try {
      const displayName = name ? String(name).trim() : "there";
      await sendMail({
        to: cleanEmail,
        subject: "OmniHR Product Walkthrough Request Received",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <div style="margin-bottom: 20px;">
              <span style="background: #2C4FD6; color: #ffffff; padding: 6px 12px; border-radius: 6px; font-weight: 700; font-size: 14px;">OmniHR</span>
            </div>
            <h2 style="color: #0f172a; margin-top: 0;">Thank you for requesting a demo!</h2>
            <p style="color: #475569; font-size: 15px; line-height: 1.6;">
              Hello ${displayName},<br/><br/>
              We have received your demo request for <strong>OmniHR</strong>. One of our dedicated HR solution specialists will connect with you within 24 business hours to schedule your personalized 20-minute walkthrough.
            </p>
            ${companyName ? `<p style="color: #64748b; font-size: 14px;"><strong>Company:</strong> ${companyName}</p>` : ""}
            ${teamSize ? `<p style="color: #64748b; font-size: 14px;"><strong>Team Size:</strong> ${teamSize}</p>` : ""}
            <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9; color: #94a3b8; font-size: 13px;">
              Need immediate assistance? Reply directly to this email or reach us at <a href="mailto:sales@omnihr.com" style="color: #2C4FD6;">sales@omnihr.com</a>.
            </div>
          </div>
        `,
      });
    } catch (mailErr) {
      console.warn("[Demo Request] Acknowledgment email failed to send (non-critical):", mailErr);
    }

    return res.status(201).json({
      success: true,
      message: "Demo request received successfully. Our team will reach out soon!",
      data: {
        id: demoReq.id,
        email: demoReq.email,
        createdAt: demoReq.createdAt,
      },
    });
  } catch (error: any) {
    console.error("[Demo Request] Error creating demo request:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit demo request",
      error: error.message,
    });
  }
};

/**
 * GET /api/superadmin/demo-requests
 * SuperAdmin endpoint: List all demo requests with filtering & metrics
 */
export const getAllDemoRequests = async (req: Request, res: Response) => {
  try {
    const { search, status } = req.query;

    const where: any = {};

    if (status && typeof status === "string" && status !== "ALL") {
      where.status = status.toUpperCase();
    }

    if (search && typeof search === "string" && search.trim() !== "") {
      const q = search.trim();
      where.OR = [
        { email: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { companyName: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ];
    }

    const [requests, total, pendingCount, emailedCount] =
      await Promise.all([
        (prisma as any).demoRequest.findMany({
          where,
          orderBy: { createdAt: "desc" },
        }),
        (prisma as any).demoRequest.count(),
        (prisma as any).demoRequest.count({ where: { status: "PENDING" } }),
        (prisma as any).demoRequest.count({ where: { status: "EMAIL_SENT" } }),
      ]);

    return res.json({
      success: true,
      data: requests,
      counts: {
        total,
        pending: pendingCount,
        emailed: emailedCount,
      },
    });
  } catch (error: any) {
    console.error("[SuperAdmin Demo Requests] Error fetching list:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch demo requests",
      error: error.message,
    });
  }
};

/**
 * POST /api/superadmin/demo-requests/:id/send-email
 * SuperAdmin endpoint: Directly send an email to the customer from SuperAdmin
 */
export const sendEmailToLead = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { subject, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: "Email subject and message body are required",
      });
    }

    const demoReq = await (prisma as any).demoRequest.findUnique({
      where: { id },
    });

    if (!demoReq) {
      return res.status(404).json({
        success: false,
        message: "Demo request not found",
      });
    }

    const formattedHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <div style="margin-bottom: 20px;">
          <span style="background: #2C4FD6; color: #ffffff; padding: 6px 14px; border-radius: 6px; font-weight: 700; font-size: 14px; letter-spacing: 0.5px;">OmniHR</span>
        </div>
        <div style="color: #1e293b; font-size: 15px; line-height: 1.7; white-space: pre-line;">
${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
        </div>
        <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; color: #94a3b8; font-size: 12px; line-height: 1.5;">
          This message was sent from <strong>OmniHR</strong> to ${demoReq.email}.<br/>
          You can reply directly to this email to get in touch with our team.
        </div>
      </div>
    `;

    // Send the email via nodemailer
    await sendMail({
      to: demoReq.email,
      subject: String(subject).trim(),
      html: formattedHtml,
      text: String(message),
    });

    // Update demo request status to EMAIL_SENT and append timestamp log
    const updated = await (prisma as any).demoRequest.update({
      where: { id },
      data: {
        status: "EMAIL_SENT",
        notes: demoReq.notes
          ? `${demoReq.notes}\n[Email sent on ${new Date().toLocaleString()}]: "${subject}"`
          : `[Email sent on ${new Date().toLocaleString()}]: "${subject}"`,
      },
    });

    return res.json({
      success: true,
      message: `Email successfully sent to ${demoReq.email}`,
      data: updated,
    });
  } catch (error: any) {
    console.error("[SuperAdmin Demo Requests] Error sending email:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send email to customer",
      error: error.message,
    });
  }
};


/**
 * PUT /api/superadmin/demo-requests/:id
 * SuperAdmin endpoint: Update status or internal notes for a demo lead
 */
export const updateDemoRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const existing = await (prisma as any).demoRequest.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Demo request not found",
      });
    }

    const updateData: any = {};
    if (status !== undefined) {
      updateData.status = String(status).toUpperCase();
    }
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    const updated = await (prisma as any).demoRequest.update({
      where: { id },
      data: updateData,
    });

    return res.json({
      success: true,
      message: "Demo request updated successfully",
      data: updated,
    });
  } catch (error: any) {
    console.error("[SuperAdmin Demo Requests] Error updating:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update demo request",
      error: error.message,
    });
  }
};

/**
 * DELETE /api/superadmin/demo-requests/:id
 * SuperAdmin endpoint: Delete a demo request
 */
export const deleteDemoRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await (prisma as any).demoRequest.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Demo request not found",
      });
    }

    await (prisma as any).demoRequest.delete({
      where: { id },
    });

    return res.json({
      success: true,
      message: "Demo request deleted successfully",
    });
  } catch (error: any) {
    console.error("[SuperAdmin Demo Requests] Error deleting:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete demo request",
      error: error.message,
    });
  }
};
