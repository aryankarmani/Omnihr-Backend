import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendMail, employeeWelcomeTemplate } from '../utils/mail';

const prisma = new PrismaClient();

// Helper: send single onboarding invite
export const sendSingleInviteInternal = async (tenantId: any, email: string, origin: string) => {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw new Error('Please enter a valid email address');
    }

    // Check if an existing user already exists with this email in THIS company
    const existingUser: any = await prisma.user.findFirst({
        where: {
            email: { equals: cleanEmail, mode: 'insensitive' },
            tenantId,
            deletedAt: null
        },
        include: { employeeProfile: true }
    });

    if (
        existingUser &&
        (
            existingUser.password ||
            existingUser.employeeProfile?.status === 'Active' ||
            existingUser.employeeProfile?.status === 'active' ||
            existingUser.employeeProfile?.status === 'Completed' ||
            (existingUser.employeeProfile && !['Pending', 'Failed', 'Cancelled', 'Expired'].includes(existingUser.employeeProfile.status))
        )
    ) {
        throw new Error('This email is already in use by an active employee.');
    }

    if (existingUser && existingUser.employeeProfile?.status === 'Pending') {
        throw new Error('An invitation has already been sent to this email and is currently pending. You can only resend if the link expires or is cancelled.');
    }

    let userRecord: any = existingUser;

    if (!userRecord) {
        let empRole = await prisma.role.findFirst({
            where: {
                tenantId,
                name: { equals: 'EMPLOYEE', mode: 'insensitive' }
            }
        });

        if (!empRole) {
            empRole = await prisma.role.findFirst({ where: { tenantId } });
        }

        userRecord = await prisma.user.create({
            data: {
                email: cleanEmail,
                name: cleanEmail.split('@')[0],
                tenantId,
                roleId: empRole?.id,
                isActive: true,
                employeeProfile: {
                    create: {
                        tenantId,
                        status: 'Pending'
                    }
                }
            },
            include: { employeeProfile: true }
        });
    }

    const token = jwt.sign(
        { email: cleanEmail, tenantId, userId: userRecord.id, type: 'onboarding' },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '7d' }
    );

    const onboardingMeta = {
        onboardingToken: token,
        accessCount: 0,
        tokenUsed: false,
        invitedAt: new Date().toISOString()
    };

    if (userRecord.employeeProfile) {
        await prisma.employeeProfile.update({
            where: { id: userRecord.employeeProfile.id },
            data: {
                status: 'Pending',
                customFields: JSON.stringify(onboardingMeta)
            }
        });
    } else {
        await prisma.employeeProfile.create({
            data: {
                userId: userRecord.id,
                tenantId,
                status: 'Pending',
                customFields: JSON.stringify(onboardingMeta)
            }
        });
    }

    const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
    const liveFrontendUrl = (process.env.FRONTEND_URL || 'https://omnihr-frontend.vercel.app').replace(/\/$/, '');
    const primaryUrl = isLocal ? origin : liveFrontendUrl;
    const inviteLink = `${primaryUrl}/complete-profile?token=${token}`;

    await sendMail({
        to: cleanEmail,
        subject: 'Please complete your details - OmniHR',
        html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 580px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
                <div style="text-align: center; margin-bottom: 25px;">
                    <h2 style="color: #2C4FD6; margin: 0; font-size: 24px;">OmniHR</h2>
                    <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Employee Onboarding Portal</p>
                </div>
                <p style="color: #1e293b; font-size: 15px; line-height: 1.6;">Hello,</p>
                <p style="color: #1e293b; font-size: 15px; line-height: 1.6;">
                    You have been invited to join the organization. <strong>Please complete your details</strong> to finalize your employee profile setup.
                </p>
                <div style="text-align: center; margin: 35px 0;">
                    <a href="${inviteLink}" style="background-color: #2C4FD6; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">Complete Your Profile</a>
                </div>
                <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 25px 0;" />
                <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">
                    This invitation link is valid for one-time use only.
                </p>
            </div>
        `,
        text: `Hello, Please complete your details by visiting this link: ${inviteLink}`
    });

    return {
        id: userRecord.id,
        email: cleanEmail,
        status: 'Pending'
    };
};

// 1. Admin sends onboarding invitation email to single user
export const inviteOnboarding = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { email } = req.body;

        if (!tenantId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const requestOrigin = (req.headers.origin as string) || (req.headers.referer ? new URL(req.headers.referer as string).origin : '');
        const invite = await sendSingleInviteInternal(tenantId, email, requestOrigin);

        return res.json({
            success: true,
            message: `Invitation email sent successfully to ${invite.email}`,
            invite
        });
    } catch (error: any) {
        console.error('Error in inviteOnboarding:', error);
        return res.status(400).json({ message: error.message || 'Failed to send invitation email' });
    }
};

// 1b. Admin sends onboarding invitation emails to multiple users in one click
export const bulkInviteOnboarding = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { emails } = req.body;

        if (!tenantId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({ message: 'Emails array is required' });
        }

        const requestOrigin = (req.headers.origin as string) || (req.headers.referer ? new URL(req.headers.referer as string).origin : '');

        const results: any[] = [];
        // Concurrency chunks of 4 to respect SMTP server throughput
        const chunkSize = 4;
        for (let i = 0; i < emails.length; i += chunkSize) {
            const chunk = emails.slice(i, i + chunkSize);
            const chunkPromises = chunk.map(async (em: string) => {
                const cleanEmail = String(em || '').trim().toLowerCase();
                try {
                    const invite = await sendSingleInviteInternal(tenantId, cleanEmail, requestOrigin);
                    return { email: cleanEmail, success: true, invite };
                } catch (err: any) {
                    return { email: cleanEmail, success: false, error: err.message };
                }
            });
            const chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults);
        }

        return res.json({
            success: true,
            results
        });
    } catch (error: any) {
        console.error('Error in bulkInviteOnboarding:', error);
        return res.status(500).json({ message: error.message || 'Failed to send bulk invitations' });
    }
};

// 2. Admin retrieves all onboarding invitees (Pending, Failed, Completed)
export const getOnboardingInvites = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        if (!tenantId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const inviteUsers = await prisma.user.findMany({
            where: {
                tenantId,
                deletedAt: null,
                employeeProfile: {
                    OR: [
                        { status: { in: ['Pending', 'Failed', 'Completed', 'Cancelled', 'Expired'] } },
                        { customFields: { contains: 'onboarding' } }
                    ]
                }
            },
            include: {
                employeeProfile: true
            },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = inviteUsers
            .map((u: any) => {
                let meta: any = {};
                try {
                    meta = u.employeeProfile?.customFields ? JSON.parse(u.employeeProfile.customFields) : {};
                } catch {}

                const rawStatus = u.employeeProfile?.status || 'Pending';
                let status = 'Pending';
                if (rawStatus === 'Completed' || meta.onboardingCompleted || (rawStatus === 'Active' && meta.onboardingCompleted)) {
                    status = 'Completed';
                } else if (rawStatus === 'Cancelled') {
                    status = 'Cancelled';
                } else if (rawStatus === 'Expired') {
                    status = 'Expired';
                } else if (rawStatus === 'Failed') {
                    status = 'Failed';
                } else {
                    status = 'Pending';
                }

                return {
                    id: u.id,
                    email: u.email,
                    status
                };
            })
            // Once completed, employee is in the Employee List and removed from Profile Completion
            .filter((u: any) => u.status !== 'Completed');

        return res.json(formatted);
    } catch (error: any) {
        console.error('Error fetching onboarding invites:', error);
        return res.status(500).json({ message: 'Failed to load invites' });
    }
};

// 3. Public: Get onboarding metadata for invited user via token (ONE-TIME VALID LINK)
export const getOnboardingData = async (req: Request, res: Response) => {
    try {
        const { token } = req.query;
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ message: 'Invitation token is missing or invalid' });
        }

        let decoded: any;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        } catch (jwtErr: any) {
            if (jwtErr.name === 'TokenExpiredError') {
                const unverified: any = jwt.decode(token);
                if (unverified?.userId) {
                    await prisma.employeeProfile.updateMany({
                        where: { userId: unverified.userId, status: 'Pending' },
                        data: { status: 'Expired' }
                    });
                }
                return res.status(400).json({
                    message: 'This invitation link has expired. Please ask your administrator to send a new invite.'
                });
            }
            return res.status(400).json({ message: 'Invalid or expired invitation token' });
        }

        if (!decoded || decoded.type !== 'onboarding' || !decoded.tenantId || !decoded.userId || !decoded.email) {
            return res.status(400).json({ message: 'Invalid token payload' });
        }

        const tenantId = decoded.tenantId;

        const user = await prisma.user.findFirst({
            where: { id: decoded.userId, tenantId, deletedAt: null },
            include: { employeeProfile: true }
        });

        if (!user || !user.employeeProfile) {
            return res.status(404).json({ message: 'Onboarding invitation record was not found or was removed' });
        }

        // If user already completed profile
        if (user.employeeProfile.status === 'Completed' || user.employeeProfile.status === 'Active') {
            return res.status(400).json({
                message: 'Your profile has already been completed. Thank you!'
            });
        }

        // ONE-TIME LINK VERIFICATION
        let meta: any = {};
        try {
            meta = user.employeeProfile.customFields ? JSON.parse(user.employeeProfile.customFields) : {};
        } catch {
            meta = {};
        }

        // Check if an updated invitation token was generated
        if (meta.onboardingToken && meta.onboardingToken !== token) {
            return res.status(400).json({
                message: 'This invitation link is no longer valid. A newer invitation was sent to your email.'
            });
        }

        // If link was already accessed once -> ONE-TIME USE VIOLATED
        if (meta.accessCount && meta.accessCount >= 1) {
            // Mark status as Expired in database so admin sees it and can resend
            await prisma.employeeProfile.update({
                where: { id: user.employeeProfile.id },
                data: { status: 'Expired' }
            });
            return res.status(400).json({
                message: 'This invitation link was valid for one-time use only and has already been accessed. Please ask your administrator to send a new invite.'
            });
        }

        // First time accessing: mark link as consumed (accessCount: 1)
        await prisma.employeeProfile.update({
            where: { id: user.employeeProfile.id },
            data: {
                customFields: JSON.stringify({
                    ...meta,
                    onboardingToken: token,
                    accessCount: 1,
                    tokenUsed: true,
                    firstAccessedAt: new Date().toISOString()
                })
            }
        });

        // Fetch master data for the form
        const [departments, designations, employeeRole] = await Promise.all([
            prisma.department.findMany({
                where: { tenantId },
                select: { id: true, name: true }
            }),
            prisma.designation.findMany({
                where: { tenantId },
                select: { id: true, title: true }
            }),
            prisma.role.findFirst({
                where: {
                    tenantId,
                    name: { equals: 'EMPLOYEE', mode: 'insensitive' }
                },
                select: { id: true, name: true }
            })
        ]);

        const roles = [
            {
                id: employeeRole?.id || 1,
                name: 'Employee'
            }
        ];

        return res.json({
            email: decoded.email,
            departments,
            designations,
            roles
        });
    } catch (error: any) {
        console.error('Error in getOnboardingData:', error);
        if (error.name === 'TokenExpiredError') {
            return res.status(400).json({ message: 'This onboarding invitation link has expired. Please ask your administrator to send a new invite.' });
        }
        return res.status(400).json({ message: 'Invalid or expired invitation token.' });
    }
};

// Helpers for employee credentials generation and portal URL
const generateRandomPassword = () => {
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const symbols = "@#$!";
    const all = upper + lower + numbers + symbols;

    let password =
        upper[crypto.randomInt(upper.length)] +
        lower[crypto.randomInt(lower.length)] +
        numbers[crypto.randomInt(numbers.length)] +
        symbols[crypto.randomInt(symbols.length)];

    for (let i = 0; i < 8; i++) {
        password += all[crypto.randomInt(all.length)];
    }

    return password
        .split("")
        .sort(() => crypto.randomInt(3) - 1)
        .join("");
};

const getFrontendLoginUrl = (req: Request) => {
    if (process.env.FRONTEND_URL) {
        return `${process.env.FRONTEND_URL.replace(/\/+$/, '')}/signin`;
    }
    const origin = (req.headers.origin as string) || (req.headers.referer ? new URL(req.headers.referer as string).origin : '');
    if (origin && origin.startsWith("http") && !origin.includes("localhost")) {
        return `${origin.replace(/\/+$/, '')}/signin`;
    }
    return "https://omnihr-frontend.vercel.app/signin";
};

// 4. Public: Submit completed onboarding profile
export const submitOnboardingProfile = async (req: Request, res: Response) => {
    try {
        const { token, data } = req.body;
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ message: 'Invitation token is missing' });
        }

        const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        if (!decoded || decoded.type !== 'onboarding' || !decoded.tenantId || !decoded.email) {
            return res.status(400).json({ message: 'Invalid invitation token' });
        }

        const tenantId = decoded.tenantId;
        const email = decoded.email;

        const {
            firstName,
            lastName,
            phone,
            dob,
            joiningDate,
            departmentId,
            designationId,
            roleId,
            bloodGroup,
            address,
            password
        } = data || {};

        const fullName = `${firstName || ''} ${lastName || ''}`.trim() || email.split('@')[0];

        // Generate password if not supplied or use employee provided password
        const plainPassword = (password && password.trim()) ? password.trim() : generateRandomPassword();
        const hashedPassword = await bcrypt.hash(plainPassword, 10);
        const loginUrl = getFrontendLoginUrl(req);

        let user = await prisma.user.findFirst({
            where: { email, tenantId, deletedAt: null },
            include: { employeeProfile: true }
        });

        if (user) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    name: fullName,
                    roleId: roleId ? Number(roleId) : user.roleId,
                    password: hashedPassword,
                    isActive: true,
                },
                include: { employeeProfile: true }
            });
        } else {
            user = await prisma.user.create({
                data: {
                    email,
                    name: fullName,
                    tenantId,
                    roleId: roleId ? Number(roleId) : undefined,
                    password: hashedPassword,
                    isActive: true
                },
                include: { employeeProfile: true }
            });
        }

        const profileData: any = {
            tenantId,
            phone: phone || null,
            dob: dob ? new Date(dob) : null,
            joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
            departmentId: departmentId ? String(departmentId) : null,
            designationId: designationId ? String(designationId) : null,
            bloodGroup: bloodGroup || null,
            address: address || null,
            status: 'Active',
            customFields: JSON.stringify({ onboardingCompleted: true, completedAt: new Date().toISOString() })
        };

        if (user.employeeProfile) {
            await prisma.employeeProfile.update({
                where: { id: user.employeeProfile.id },
                data: profileData
            });
        } else {
            await prisma.employeeProfile.create({
                data: {
                    userId: user.id,
                    ...profileData
                }
            });
        }

        // Send Welcome Email with login credentials (same template as manual Add Employee)
        try {
            const emailContent = employeeWelcomeTemplate({
                name: fullName,
                email,
                password: plainPassword,
                loginUrl,
            });

            await sendMail({
                to: email,
                subject: "Welcome to OmniHR - Your Account is Ready",
                html: emailContent.html,
                text: emailContent.text,
            });
            console.log(`[Onboarding] Welcome credentials email dispatched to ${email}`);
        } catch (mailError) {
            console.error('[Onboarding] Error sending credentials email:', mailError);
        }

        return res.json({
            success: true,
            message: 'Your profile has been completed and submitted successfully! Your login credentials have been sent to your email.'
        });
    } catch (error: any) {
        console.error('Error submitting onboarding profile:', error);
        return res.status(500).json({ message: error.message || 'Failed to submit profile' });
    }
};

// 5. Public: Employee cancels onboarding form
export const cancelOnboarding = async (req: Request, res: Response) => {
    try {
        const { token } = req.body;
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ message: 'Token missing' });
        }

        const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        if (!decoded || !decoded.userId) {
            return res.status(400).json({ message: 'Invalid token' });
        }

        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            include: { employeeProfile: true }
        });

        if (user && user.employeeProfile && user.employeeProfile.status !== 'Completed') {
            await prisma.employeeProfile.update({
                where: { id: user.employeeProfile.id },
                data: { status: 'Cancelled' }
            });
        }

        return res.json({ success: true, message: 'Onboarding marked as cancelled' });
    } catch (error: any) {
        console.error('Error cancelling onboarding:', error);
        return res.status(400).json({ message: 'Failed to cancel' });
    }
};

// 6. Admin deletes a pending, failed, cancelled, or expired onboarding invitation from database
export const deleteOnboardingInvite = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { id } = req.params;

        if (!tenantId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const userId = parseInt(id, 10);
        if (isNaN(userId)) {
            return res.status(400).json({ message: 'Invalid invite ID' });
        }

        const existingUser = await prisma.user.findFirst({
            where: {
                id: userId,
                tenantId,
                password: null,
                employeeProfile: {
                    status: { in: ['Pending', 'Failed', 'Completed', 'Cancelled', 'Expired'] }
                }
            },
            include: { employeeProfile: true }
        });

        if (!existingUser) {
            return res.status(404).json({ message: 'Pending invite not found or cannot be deleted' });
        }

        if (existingUser.employeeProfile) {
            await prisma.statutoryDetails.deleteMany({ where: { profileId: existingUser.employeeProfile.id } });
            await prisma.bankDetails.deleteMany({ where: { profileId: existingUser.employeeProfile.id } });
            await prisma.employeeProfile.delete({ where: { id: existingUser.employeeProfile.id } });
        }

        await prisma.user.delete({ where: { id: userId } });

        return res.json({ success: true, message: 'Onboarding invite deleted successfully from database' });
    } catch (error: any) {
        console.error('Error deleting onboarding invite:', error);
        return res.status(500).json({ message: error.message || 'Failed to delete invite' });
    }
};
