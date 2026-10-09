import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { sendMail } from '../utils/mail';

const prisma = new PrismaClient();

// 1. Admin sends onboarding invitation email
export const inviteOnboarding = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { email } = req.body;

        if (!tenantId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const cleanEmail = String(email || '').trim().toLowerCase();
        if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({ message: 'Please enter a valid email address' });
        }

        // Check if an active employee already exists with this email in THIS company
        const existingUser = await prisma.user.findFirst({
            where: {
                email: { equals: cleanEmail, mode: 'insensitive' },
                tenantId,
                deletedAt: null,
                isActive: true
            },
            include: { employeeProfile: true }
        });

        // If user already exists and is an active, completed employee
        if (
            existingUser &&
            (
                existingUser.password ||
                existingUser.employeeProfile?.status === 'Active' ||
                existingUser.employeeProfile?.status === 'active' ||
                existingUser.employeeProfile?.status === 'Completed' ||
                (existingUser.employeeProfile && existingUser.employeeProfile.status !== 'Pending' && existingUser.employeeProfile.status !== 'Failed')
            )
        ) {
            return res.status(400).json({
                message: 'This email is already in use. Please use a different email address.'
            });
        }

        let userRecord = existingUser;

        // If user record doesn't exist, create a pending user and profile
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

        // Generate a 7-day secure onboarding token
        const token = jwt.sign(
            { email: cleanEmail, tenantId, userId: userRecord.id, type: 'onboarding' },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        // Reset status to Pending and save fresh one-time token metadata
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

        const requestOrigin = (req.headers.origin as string) || (req.headers.referer ? new URL(req.headers.referer as string).origin : '');
        const isLocal = requestOrigin.includes('localhost') || requestOrigin.includes('127.0.0.1');
        const liveFrontendUrl = (process.env.FRONTEND_URL || 'https://omnihr-frontend.vercel.app').replace(/\/$/, '');
        
        // During local testing, direct to local dev server so it renders immediately without blank screen
        const primaryUrl = isLocal ? requestOrigin : liveFrontendUrl;
        const inviteLink = `${primaryUrl}/complete-profile?token=${token}`;
        const liveLink = `${liveFrontendUrl}/complete-profile?token=${token}`;

        console.log(`[inviteOnboarding] Sending onboarding invitation email to ${cleanEmail} (link: ${inviteLink})...`);

        // Send onboarding invitation email
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
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${inviteLink}" style="background-color: #2C4FD6; color: #ffffff; padding: 13px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">Complete Your Profile</a>
                    </div>
                    <p style="color: #64748b; font-size: 12px; line-height: 1.5; text-align: center;">
                        If the button above does not work, copy and paste this link into your browser:<br/>
                        <a href="${inviteLink}" style="color: #2C4FD6; word-break: break-all;">${inviteLink}</a>
                    </p>
                    ${isLocal ? `
                    <div style="background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 6px; padding: 10px; margin-top: 20px; font-size: 11px; color: #64748b; text-align: center;">
                        <strong>Note for testing:</strong> Once you push your changes to GitHub / Vercel, this link will also be live at:<br/>
                        <a href="${liveLink}" style="color: #2C4FD6; word-break: break-all;">${liveLink}</a>
                    </div>
                    ` : ''}
                    <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 25px 0;" />
                    <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">
                        This invitation link is valid for one-time use only.
                    </p>
                </div>
            `,
            text: `Hello, Please complete your details by visiting this link: ${inviteLink}`
        });

        console.log(`[inviteOnboarding] Successfully sent onboarding email to ${cleanEmail}`);

        return res.json({
            success: true,
            message: `Invitation email sent successfully to ${cleanEmail}`,
            invite: {
                id: userRecord.id,
                email: cleanEmail,
                status: 'Pending'
            }
        });
    } catch (error: any) {
        console.error('Error in inviteOnboarding:', error);
        return res.status(500).json({ message: error.message || 'Failed to send invitation email' });
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
                password: null,
                employeeProfile: {
                    status: { in: ['Pending', 'Failed', 'Completed'] }
                }
            },
            include: {
                employeeProfile: true
            },
            orderBy: { createdAt: 'desc' }
        });

        const formatted = inviteUsers.map((u: any) => {
            const rawStatus = u.employeeProfile?.status || 'Pending';
            let status = 'Pending';
            if (rawStatus === 'Completed') status = 'Completed';
            else if (rawStatus === 'Failed') status = 'Failed';
            else status = 'Pending';

            return {
                id: u.id,
                email: u.email,
                status
            };
        });

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

        const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'secret');
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
            // Mark status as Failed in database so admin sees it and can resend
            await prisma.employeeProfile.update({
                where: { id: user.employeeProfile.id },
                data: { status: 'Failed' }
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

        let hashedPassword: string | undefined;
        if (password && password.trim()) {
            hashedPassword = await bcrypt.hash(password.trim(), 10);
        }

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
                    ...(hashedPassword ? { password: hashedPassword } : {})
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
            status: 'Completed',
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

        return res.json({
            success: true,
            message: 'Your profile has been completed and submitted successfully!'
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
                data: { status: 'Failed' }
            });
        }

        return res.json({ success: true, message: 'Onboarding marked as cancelled' });
    } catch (error: any) {
        console.error('Error cancelling onboarding:', error);
        return res.status(400).json({ message: 'Failed to cancel' });
    }
};

// 6. Admin deletes a pending or failed onboarding invitation from database
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
                    status: { in: ['Pending', 'Failed', 'Completed'] }
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
