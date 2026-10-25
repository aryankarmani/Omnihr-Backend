import { Request, Response } from 'express';
import 'multer';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendMail, employeeWelcomeTemplate, employeeCorrectionRequestTemplate } from '../utils/mail';
import { notifyAdmins } from '../utils/notification';
import { createAuditLog } from '../utils/auditLog';
import { uploadToCloudinary } from '../services/cloudinary.service';

const prisma = new PrismaClient();

// Helper: send single onboarding invite
export const sendSingleInviteInternal = async (tenantId: any, email: string, origin: string) => {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw new Error('Please enter a valid email address');
    }

    // Check if an existing user already exists with this email in THIS company (regardless of deletedAt)
    const existingUser: any = await prisma.user.findFirst({
        where: {
            email: { equals: cleanEmail, mode: 'insensitive' },
            tenantId,
        },
        include: { employeeProfile: true }
    });

    if (existingUser && !existingUser.deletedAt) {
        if (
            existingUser.password ||
            existingUser.employeeProfile?.status === 'Active' ||
            existingUser.employeeProfile?.status === 'active' ||
            existingUser.employeeProfile?.status === 'Completed' ||
            (existingUser.employeeProfile && !['Pending', 'Submitted', 'Failed', 'Cancelled', 'Expired'].includes(existingUser.employeeProfile.status))
        ) {
            throw new Error('This email is already in use by an active employee.');
        }

        if (existingUser.employeeProfile?.status === 'Pending') {
            throw new Error('An invitation has already been sent to this email and is currently pending. You can only resend if the link expires or is cancelled.');
        }

        if (existingUser.employeeProfile?.status === 'Submitted') {
            throw new Error('This employee has already submitted their profile and is waiting for your approval in the list.');
        }
    }

    let userRecord: any = existingUser;

    if (userRecord && userRecord.deletedAt) {
        // User was previously soft-deleted: reactivate for fresh onboarding invite
        userRecord = await prisma.user.update({
            where: { id: userRecord.id },
            data: {
                isActive: true,
                deletedAt: null,
                password: null
            },
            include: { employeeProfile: true }
        });
    }

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
                deletedAt: null,
                isActive: true,
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

    const primaryUrl = (origin && origin.startsWith('http'))
        ? origin.replace(/\/+$/, '')
        : (process.env.FRONTEND_URL || 'https://omnihr-frontend.vercel.app').replace(/\/+$/, '');
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

        try {
            await createAuditLog({
                tenantId,
                module: 'Employee',
                action: 'Created',
                description: `Onboarding invitation sent to ${invite.email}.`,
                performedById: (req as any).user?.id,
                performedBy: (req as any).user?.name || (req as any).user?.email || 'SystemAdmin',
                performedByRole: (req as any).user?.role,
                targetUserId: invite.id,
                targetUser: invite.email,
                targetUserRole: 'EMPLOYEE'
            });
        } catch (auditErr) {
            console.error('Audit log error on inviteOnboarding:', auditErr);
        }

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

        // Log successful invitations
        for (const r of results) {
            if (r.success && r.invite) {
                try {
                    await createAuditLog({
                        tenantId,
                        module: 'Employee',
                        action: 'Created',
                        description: `Onboarding invitation sent to ${r.email}.`,
                        performedById: (req as any).user?.id,
                        performedBy: (req as any).user?.name || (req as any).user?.email || 'SystemAdmin',
                        performedByRole: (req as any).user?.role,
                        targetUserId: r.invite.id,
                        targetUser: r.email,
                        targetUserRole: 'EMPLOYEE'
                    });
                } catch (auditErr) {
                    console.error('Audit log error on bulk invite:', auditErr);
                }
            }
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
                        { status: { in: ['Pending', 'Submitted', 'Changes_Requested', 'Failed', 'Completed', 'Cancelled', 'Expired'] } },
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
                } else if (rawStatus === 'Submitted' || meta.onboardingSubmitted) {
                    status = 'Submitted';
                } else if (rawStatus === 'Changes_Requested') {
                    status = 'Changes_Requested';
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
                    name: u.name,
                    status,
                    adminRemarks: meta.adminRemarks || '',
                    submittedAt: meta.submittedAt || null,
                    changesRequestedAt: meta.changesRequestedAt || null
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
            include: {
                employeeProfile: {
                    include: {
                        statutory: true,
                        bank: true,
                        salary: true,
                        documents: true,
                        salaryComponents: {
                            include: {
                                component: true
                            }
                        }
                    }
                }
            }
        });

        if (!user || !user.employeeProfile) {
            return res.status(404).json({ message: 'Onboarding invitation record was not found or was removed' });
        }

        // ONE-TIME LINK & SUBMISSION VERIFICATION
        let meta: any = {};
        try {
            meta = user.employeeProfile.customFields ? JSON.parse(user.employeeProfile.customFields) : {};
        } catch {
            meta = {};
        }

        const isChangesRequested = user.employeeProfile.status === 'Changes_Requested';

        // 1. If user already submitted their profile details -> Link is expired, unless admin requested changes
        if (!isChangesRequested && (user.employeeProfile.status === 'Submitted' || meta.onboardingSubmitted === true)) {
            return res.status(400).json({
                message: 'Your profile details have already been submitted and are awaiting administrator approval. This invitation link has expired and cannot be used again.'
            });
        }

        // 2. If user already completed profile and is Active -> Link is expired
        if (
            user.employeeProfile.status === 'Completed' ||
            user.employeeProfile.status === 'Active' ||
            meta.onboardingCompleted === true
        ) {
            return res.status(400).json({
                message: 'Your profile has already been completed and activated. This invitation link has expired.'
            });
        }

        // 3. If onboarding was cancelled
        if (user.employeeProfile.status === 'Cancelled') {
            return res.status(400).json({
                message: 'This onboarding invitation was cancelled. Please request a new invitation link from your administrator.'
            });
        }

        // 4. Check if an updated invitation token was generated
        if (meta.onboardingToken && meta.onboardingToken !== token) {
            return res.status(400).json({
                message: 'This invitation link is no longer valid. A newer invitation was sent to your email.'
            });
        }

        // 5. If link was already marked as used or expired (unless admin requested changes)
        if (!isChangesRequested && (user.employeeProfile.status === 'Expired' || meta.tokenUsed === true)) {
            return res.status(400).json({
                message: 'This invitation link has expired. Please ask your administrator to send a new invite.'
            });
        }

        // Fetch master data for the complete onboarding form
        const [departments, designations, employeeRole, salaryComponents, customFieldMasters] = await Promise.all([
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
            }),
            prisma.salaryComponent.findMany({
                where: { tenantId }
            }),
            prisma.customField.findMany({
                where: { tenantId }
            })
        ]);

        const roles = [
            {
                id: employeeRole?.id || 1,
                name: 'Employee'
            }
        ];

        const nameParts = (user.name || '').trim().split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        return res.json({
            email: decoded.email,
            departments: departments.map(d => ({ id: d.id, name: d.name })),
            designations: designations.map(d => ({ id: d.id, name: d.title, title: d.title })),
            roles,
            salaryComponents: salaryComponents || [],
            customFieldMasters: customFieldMasters || [],
            adminRemarks: meta.adminRemarks || '',
            fieldRemarks: meta.fieldRemarks || {},
            isChangesRequested,
            initialData: {
                firstName: firstName !== decoded.email.split('@')[0] ? firstName : '',
                lastName,
                phone: user.employeeProfile.phone || '',
                dob: user.employeeProfile.dob ? new Date(user.employeeProfile.dob).toISOString().split('T')[0] : '',
                bloodGroup: user.employeeProfile.bloodGroup || '',
                address: user.employeeProfile.address || '',
                departmentId: user.employeeProfile.departmentId || '',
                designationId: user.employeeProfile.designationId || '',
                joiningDate: user.employeeProfile.joiningDate ? new Date(user.employeeProfile.joiningDate).toISOString().split('T')[0] : '',
                pan: user.employeeProfile.statutory?.pan || '',
                aadhaar: user.employeeProfile.statutory?.aadhaar || '',
                uan: user.employeeProfile.statutory?.uan || '',
                esic: user.employeeProfile.statutory?.esic || '',
                bankName: user.employeeProfile.bank?.bankName || '',
                ifsc: user.employeeProfile.bank?.ifsc || '',
                accountNumber: user.employeeProfile.bank?.accountNumber || '',
                salary: {
                    basic: user.employeeProfile.salary?.basic ? String(user.employeeProfile.salary.basic) : ''
                },
                selectedSalaryComponents: (user.employeeProfile.salaryComponents || []).map((sc: any) => ({
                    id: sc.componentId,
                    componentId: sc.componentId,
                    name: sc.component?.name || '',
                    type: sc.component?.type || '',
                    amount: sc.amount
                })),
                documents: (user.employeeProfile.documents || []).map((d: any) => ({
                    id: d.id,
                    name: d.name,
                    url: d.url,
                    type: d.type,
                    originalName: d.originalName
                })),
                avatar: user.employeeProfile.avatar || null
            }
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
    if (origin && origin.startsWith("http") && !origin.includes("localhost") && !origin.includes("127.0.0.1")) {
        return `${origin.replace(/\/+$/, '')}/signin`;
    }
    return "https://omnihr-frontend.vercel.app/signin";
};

// 4. Public: Submit completed onboarding profile
export const submitOnboardingProfile = async (req: Request, res: Response) => {
    try {
        let data: any = req.body.data;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch { data = {}; }
        }
        if (!data) data = req.body;

        const token = req.body.token || data?.token;
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
            pan,
            aadhaar,
            uan,
            esic,
            bankName,
            ifsc,
            accountNumber,
            salary,
            selectedSalaryComponents,
            customFieldValues = {}
        } = data || {};

        if (
            !firstName?.trim() ||
            !lastName?.trim() ||
            !phone?.trim() ||
            !dob ||
            !joiningDate ||
            !departmentId ||
            !designationId ||
            !roleId ||
            !bloodGroup?.trim() ||
            !address?.trim()
        ) {
            return res.status(400).json({ message: 'All personal details are required' });
        }

        const fullName = `${firstName || ''} ${lastName || ''}`.trim() || email.split('@')[0];

        // Fetch Department name and Designation title so they are properly saved
        let deptName: string | null = null;
        if (departmentId) {
            const dept = await prisma.department.findFirst({
                where: { id: String(departmentId), tenantId }
            });
            deptName = dept?.name || null;
        }

        let desigTitle: string | null = null;
        if (designationId) {
            const desig = await prisma.designation.findFirst({
                where: { id: String(designationId), tenantId }
            });
            desigTitle = desig?.title || null;
        }

        let user = await prisma.user.findFirst({
            where: { email, tenantId, deletedAt: null },
            include: { employeeProfile: true }
        });

        if (user && user.employeeProfile) {
            let metaCheck: any = {};
            try {
                metaCheck = user.employeeProfile.customFields ? JSON.parse(user.employeeProfile.customFields) : {};
            } catch {}

            const isChangesRequested = user.employeeProfile.status === 'Changes_Requested';

            if (!isChangesRequested && (user.employeeProfile.status === 'Submitted' || metaCheck.onboardingSubmitted === true)) {
                return res.status(400).json({
                    message: 'Your profile details have already been submitted and are awaiting administrator approval.'
                });
            }

            if (user.employeeProfile.status === 'Completed' || user.employeeProfile.status === 'Active' || metaCheck.onboardingCompleted === true) {
                return res.status(400).json({
                    message: 'Your profile has already been completed.'
                });
            }
        }

        let existingMeta: any = {};
        try {
            existingMeta = user?.employeeProfile?.customFields ? JSON.parse(user.employeeProfile.customFields) : {};
        } catch {
            existingMeta = {};
        }

        // Process uploaded files
        const uploadedFiles = req.files as Express.Multer.File[] | undefined;
        const files: { [fieldname: string]: Express.Multer.File[] } = {};
        if (uploadedFiles) {
            uploadedFiles.forEach(file => {
                if (!files[file.fieldname]) {
                    files[file.fieldname] = [];
                }
                files[file.fieldname].push(file);
            });
        }

        const profilePhotoFile = uploadedFiles?.find(
            (file) => file.fieldname === "profilePhoto" || file.fieldname === "profilePicture"
        );
        let profilePhotoPath: string | null = null;
        if (profilePhotoFile) {
            try {
                const cloudRes = await uploadToCloudinary(profilePhotoFile.path, 'omnihr/profile_pictures');
                profilePhotoPath = cloudRes.secure_url;
            } catch (err) {
                console.error("Cloudinary onboarding avatar upload failed:", err);
                profilePhotoPath = `/uploads/${profilePhotoFile.filename}`;
            }
        }

        // Custom fields map
        const cfMasters = await prisma.customField.findMany({
            where: { tenantId }
        });

        const customFieldsMap: Record<string, any> = {
            ...existingMeta,
            onboardingSubmitted: true,
            onboardingCompleted: false,
            tokenUsed: true,
            onboardingToken: token,
            adminRemarks: null,
            fieldRemarks: null,
            submittedAt: new Date().toISOString()
        };

        if (cfMasters.length > 0) {
            for (const cf of cfMasters) {
                const value = customFieldValues[cf.id] !== undefined ? String(customFieldValues[cf.id]) : null;
                const fileArr = files[`custom-file-${cf.id}`];
                const file = fileArr && fileArr[0];
                let docUrl: string | null = null;
                const docName = file ? file.originalname : null;

                if (file) {
                    try {
                        const cloudRes = await uploadToCloudinary(file.path, 'omnihr/custom_fields');
                        docUrl = cloudRes.secure_url;
                    } catch (err) {
                        docUrl = file.filename;
                    }
                }

                customFieldsMap[cf.id] = {
                    value,
                    documentUrl: docUrl,
                    documentName: docName
                };
            }
        }

        // Run full creation/update in transaction
        await prisma.$transaction(async (tx) => {
            if (user) {
                user = await tx.user.update({
                    where: { id: user.id },
                    data: {
                        name: fullName,
                        roleId: roleId ? Number(roleId) : user.roleId,
                        isActive: false, // Inactive until admin approves
                    },
                    include: { employeeProfile: true }
                });
            } else {
                user = await tx.user.create({
                    data: {
                        email,
                        name: fullName,
                        tenantId,
                        roleId: roleId ? Number(roleId) : undefined,
                        isActive: false
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
                department: deptName,
                designationId: designationId ? String(designationId) : null,
                title: desigTitle,
                bloodGroup: bloodGroup || null,
                address: address || null,
                ...(profilePhotoPath ? { avatar: profilePhotoPath } : {}),
                status: 'Submitted',
                customFields: JSON.stringify(customFieldsMap)
            };

            let profile: any;
            if (user.employeeProfile) {
                profile = await tx.employeeProfile.update({
                    where: { id: user.employeeProfile.id },
                    data: profileData
                });
            } else {
                profile = await tx.employeeProfile.create({
                    data: {
                        userId: user.id,
                        ...profileData
                    }
                });
            }

            // Statutory details
            if (pan || aadhaar || uan || esic) {
                await tx.statutoryDetails.upsert({
                    where: { profileId: profile.id },
                    create: {
                        profileId: profile.id,
                        pan: pan || null,
                        aadhaar: aadhaar || null,
                        uan: uan || null,
                        esic: esic || null
                    },
                    update: {
                        pan: pan || null,
                        aadhaar: aadhaar || null,
                        uan: uan || null,
                        esic: esic || null
                    }
                });
            }

            // Bank details
            if (bankName || ifsc || accountNumber) {
                await tx.bankDetails.upsert({
                    where: { profileId: profile.id },
                    create: {
                        profileId: profile.id,
                        bankName: bankName || 'Not Provided',
                        accountNumber: accountNumber || 'Not Provided',
                        ifsc: ifsc || 'Not Provided'
                    },
                    update: {
                        bankName: bankName || 'Not Provided',
                        accountNumber: accountNumber || 'Not Provided',
                        ifsc: ifsc || 'Not Provided'
                    }
                });
            }

            // Salary Structure
            const basicAmount = Number(salary?.basic || 0);
            if (basicAmount > 0) {
                const salaryData = {
                    basic: basicAmount,
                    hra: Number(salary?.hra || 0),
                    special: Number(salary?.special || 0),
                    medical: Number(salary?.medical || 0),
                    pf: Number(salary?.pf || 0),
                    pt: Number(salary?.pt || 0),
                    tax: Number(salary?.tax || 0),
                    totalSalary: basicAmount
                };

                await tx.salaryStructure.upsert({
                    where: { profileId: profile.id },
                    create: {
                        profileId: profile.id,
                        ...salaryData
                    },
                    update: salaryData
                });
            }

            // Employee Salary Components
            const incomingSalaryComponents = selectedSalaryComponents || data?.salaryComponents;
            if (Array.isArray(incomingSalaryComponents) && incomingSalaryComponents.length > 0) {
                await tx.employeeSalaryComponent.deleteMany({
                    where: { profileId: profile.id, tenantId }
                });

                const componentInserts = incomingSalaryComponents
                    .map((comp: any) => {
                        const componentId = comp.componentId || comp.id;
                        if (!componentId) return null;
                        return {
                            tenantId,
                            profileId: profile.id,
                            componentId: String(componentId),
                            amount: comp.amount !== undefined && comp.amount !== null ? Number(comp.amount) : null,
                        };
                    })
                    .filter(Boolean);

                if (componentInserts.length > 0) {
                    await tx.employeeSalaryComponent.createMany({
                        data: componentInserts as any[],
                        skipDuplicates: true
                    });
                }
            }

            // Documents
            if (uploadedFiles && uploadedFiles.length > 0) {
                for (const fieldName of ['aadhaar', 'pan', 'degree']) {
                    const fileArr = files[fieldName];
                    if (fileArr && fileArr[0]) {
                        const file = fileArr[0];
                        let docUrl = file.filename;
                        try {
                            const cloudRes = await uploadToCloudinary(file.path, 'omnihr/documents');
                            docUrl = cloudRes.secure_url;
                        } catch (err) {
                            console.error('Cloudinary document upload failed:', err);
                        }
                        await tx.document.create({
                            data: {
                                profileId: profile.id,
                                name: fieldName === 'aadhaar' ? 'Aadhaar Card' : fieldName === 'pan' ? 'PAN Card' : 'Highest Qualification Degree',
                                url: docUrl,
                                type: file.mimetype,
                                originalName: file.originalname
                            }
                        });
                    }
                }
            }
        });

        // Notify admins of new complete submission
        try {
            await notifyAdmins({
                tenantId,
                title: 'Employee Onboarding Submitted',
                message: `${fullName} has submitted their complete onboarding details and is awaiting approval.`,
                type: 'employee',
                link: '/profile-completion'
            });
        } catch (e) {
            console.error('Failed to notify admins of onboarding submission:', e);
        }

        return res.json({
            success: true,
            message: 'Your profile details have been submitted successfully! Waiting for administrator approval.'
        });
    } catch (error: any) {
        console.error('Error submitting onboarding profile:', error);
        return res.status(500).json({ message: error.message || 'Failed to submit profile' });
    }
};

// 4b. Admin approves a submitted onboarding profile and sends login credentials
export const approveOnboarding = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { id } = req.params;

        if (!tenantId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const userId = parseInt(id, 10);
        if (isNaN(userId)) {
            return res.status(400).json({ message: 'Invalid employee ID' });
        }

        const user = await prisma.user.findFirst({
            where: { id: userId, tenantId, deletedAt: null },
            include: { employeeProfile: true, role: true }
        });

        if (!user) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        // Generate temporary password
        const plainPassword = generateRandomPassword();
        const hashedPassword = await bcrypt.hash(plainPassword, 10);
        const loginUrl = getFrontendLoginUrl(req);

        // Activate user and set password
        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                isActive: true
            }
        });

        let meta: any = {};
        try {
            meta = user.employeeProfile?.customFields ? JSON.parse(user.employeeProfile.customFields) : {};
        } catch {}

        meta.onboardingCompleted = true;
        meta.approvedAt = new Date().toISOString();

        // Also ensure department and title strings are populated
        let deptName = user.employeeProfile?.department || null;
        let desigTitle = user.employeeProfile?.title || null;

        if (!deptName && user.employeeProfile?.departmentId) {
            const dept = await prisma.department.findFirst({ where: { id: user.employeeProfile.departmentId, tenantId } });
            if (dept) deptName = dept.name;
        }

        if (!desigTitle && user.employeeProfile?.designationId) {
            const desig = await prisma.designation.findFirst({ where: { id: user.employeeProfile.designationId, tenantId } });
            if (desig) desigTitle = desig.title;
        }

        if (user.employeeProfile) {
            await prisma.employeeProfile.update({
                where: { id: user.employeeProfile.id },
                data: {
                    status: 'Active',
                    department: deptName,
                    title: desigTitle,
                    customFields: JSON.stringify(meta)
                }
            });
        }

        // Send Welcome Email with login credentials
        try {
            const emailContent = employeeWelcomeTemplate({
                name: user.name || user.email.split('@')[0],
                email: user.email,
                password: plainPassword,
                loginUrl
            });

            await sendMail({
                to: user.email,
                subject: "Welcome to OmniHR - Your Account is Ready",
                html: emailContent.html,
                text: emailContent.text
            });
            console.log(`[Onboarding] Welcome credentials email dispatched to ${user.email} upon admin approval`);
        } catch (mailError) {
            console.error('[Onboarding] Error sending credentials email:', mailError);
        }

        try {
            await createAuditLog({
                tenantId,
                module: 'Employee',
                action: 'Created',
                description: `New employee ${user.name || user.email} was created.`,
                performedById: (req as any).user?.id,
                performedBy: (req as any).user?.name || (req as any).user?.email || 'SystemAdmin',
                performedByRole: (req as any).user?.role,
                targetUserId: user.id,
                targetUser: user.name || user.email,
                targetUserRole: 'EMPLOYEE'
            });
        } catch (auditErr) {
            console.error('Audit log error on approveOnboarding:', auditErr);
        }

        return res.json({
            success: true,
            message: `Account for ${user.email} has been approved and login credentials have been sent!`
        });
    } catch (error: any) {
        console.error('Error approving onboarding invite:', error);
        return res.status(500).json({ message: error.message || 'Failed to approve employee' });
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

        if (user && user.employeeProfile && user.employeeProfile.status !== 'Completed' && user.employeeProfile.status !== 'Active') {
            let cancelMeta: any = {};
            try {
                cancelMeta = user.employeeProfile.customFields ? JSON.parse(user.employeeProfile.customFields) : {};
            } catch {}

            await prisma.employeeProfile.update({
                where: { id: user.employeeProfile.id },
                data: {
                    status: 'Cancelled',
                    customFields: JSON.stringify({
                        ...cancelMeta,
                        tokenUsed: true,
                        cancelledAt: new Date().toISOString()
                    })
                }
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
            },
            include: { employeeProfile: true }
        });

        if (!existingUser) {
            return res.status(404).json({ message: 'Pending invite not found or cannot be deleted' });
        }

        const deleteOps: any[] = [];

        if (existingUser.employeeProfile) {
            const profileId = existingUser.employeeProfile.id;
            deleteOps.push(
                prisma.statutoryDetails.deleteMany({ where: { profileId } }),
                prisma.bankDetails.deleteMany({ where: { profileId } }),
                prisma.document.deleteMany({ where: { profileId } }),
                prisma.salaryStructure.deleteMany({ where: { profileId } }),
                prisma.salaryRevision.deleteMany({ where: { profileId } }),
                prisma.employeeSalaryComponent.deleteMany({ where: { profileId } }),
                prisma.employeeProfile.delete({ where: { id: profileId } })
            );
        }

        deleteOps.push(
            prisma.refreshToken.deleteMany({ where: { userId } }),
            prisma.notification.deleteMany({ where: { userId } }),
            prisma.directConversationMember.deleteMany({ where: { userId } }),
            prisma.commChannelMember.deleteMany({ where: { userId } }),
            prisma.chatMessageRead.deleteMany({ where: { userId } }),
            prisma.chatMessage.deleteMany({ where: { senderId: userId } }),
            prisma.teamMember.deleteMany({ where: { userId } }),
            prisma.leave.deleteMany({ where: { userId } }),
            prisma.attendanceRecord.deleteMany({ where: { userId } }),
            prisma.attendanceRegularization.deleteMany({ where: { userId } }),
            prisma.taxRegimeSelection.deleteMany({ where: { userId } }),
            prisma.investmentDeclaration.deleteMany({ where: { userId } }),
            prisma.user.delete({ where: { id: userId } })
        );

        await prisma.$transaction(deleteOps);

        try {
            await createAuditLog({
                tenantId,
                module: 'Employee',
                action: 'Deleted',
                description: `Onboarding invite for ${existingUser.name || existingUser.email} was deleted.`,
                performedById: (req as any).user?.id,
                performedBy: (req as any).user?.name || (req as any).user?.email || 'SystemAdmin',
                performedByRole: (req as any).user?.role,
                targetUserId: existingUser.id,
                targetUser: existingUser.name || existingUser.email,
                targetUserRole: 'EMPLOYEE'
            });
        } catch (auditErr) {
            console.error('Audit log error on deleteOnboardingInvite:', auditErr);
        }

        return res.json({ success: true, message: 'Onboarding invite deleted successfully from database' });
    } catch (error: any) {
        console.error('Error deleting onboarding invite:', error);
        return res.status(500).json({ message: error.message || 'Failed to delete invite' });
    }
};

// 7. Admin reviews submitted employee onboarding profile
export const getOnboardingDetails = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { id } = req.params;

        if (!tenantId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const userId = parseInt(id, 10);
        if (isNaN(userId)) {
            return res.status(400).json({ message: 'Invalid employee ID' });
        }

        const user = await prisma.user.findFirst({
            where: { id: userId, tenantId, deletedAt: null },
            include: {
                role: true,
                employeeProfile: {
                    include: {
                        statutory: true,
                        bank: true,
                        salary: true,
                        documents: true,
                        salaryComponents: {
                            include: {
                                component: true
                            }
                        }
                    }
                }
            }
        });

        if (!user || !user.employeeProfile) {
            return res.status(404).json({ message: 'Employee onboarding profile not found' });
        }

        let meta: any = {};
        try {
            meta = user.employeeProfile.customFields ? JSON.parse(user.employeeProfile.customFields) : {};
        } catch {
            meta = {};
        }

        const cfMasters = await prisma.customField.findMany({
            where: { tenantId }
        });

        return res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role?.name || 'Employee',
                roleId: user.roleId
            },
            profile: {
                id: user.employeeProfile.id,
                status: user.employeeProfile.status,
                phone: user.employeeProfile.phone,
                dob: user.employeeProfile.dob,
                joiningDate: user.employeeProfile.joiningDate,
                departmentId: user.employeeProfile.departmentId,
                department: user.employeeProfile.department,
                designationId: user.employeeProfile.designationId,
                title: user.employeeProfile.title,
                bloodGroup: user.employeeProfile.bloodGroup,
                address: user.employeeProfile.address,
                avatar: user.employeeProfile.avatar
            },
            statutory: user.employeeProfile.statutory,
            bank: user.employeeProfile.bank,
            salary: user.employeeProfile.salary,
            salaryComponents: (user.employeeProfile.salaryComponents || []).map((sc: any) => ({
                id: sc.componentId,
                componentId: sc.componentId,
                name: sc.component?.name || '',
                type: sc.component?.type || '',
                amount: sc.amount
            })),
            documents: user.employeeProfile.documents || [],
            customFieldsMeta: meta,
            customFieldMasters: cfMasters || [],
            adminRemarks: meta.adminRemarks || '',
            fieldRemarks: meta.fieldRemarks || {},
            submittedAt: meta.submittedAt || null,
            changesRequestedAt: meta.changesRequestedAt || null
        });
    } catch (error: any) {
        console.error('Error in getOnboardingDetails:', error);
        return res.status(500).json({ message: error.message || 'Failed to fetch submitted details' });
    }
};

// 8. Admin requests correction/changes from candidate with remarks
export const requestOnboardingChanges = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const { id } = req.params;
        const { remarks, fieldRemarks } = req.body;

        if (!tenantId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const cleanRemarks = String(remarks || '').trim();
        if (!cleanRemarks) {
            return res.status(400).json({ message: 'Please write remarks explaining what the employee needs to correct.' });
        }

        const userId = parseInt(id, 10);
        if (isNaN(userId)) {
            return res.status(400).json({ message: 'Invalid employee ID' });
        }

        const user = await prisma.user.findFirst({
            where: { id: userId, tenantId, deletedAt: null },
            include: { employeeProfile: true }
        });

        if (!user || !user.employeeProfile) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        // Generate fresh 7-day token so employee can reopen form and correct
        const token = jwt.sign(
            { email: user.email, tenantId, userId: user.id, type: 'onboarding' },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        let meta: any = {};
        try {
            meta = user.employeeProfile.customFields ? JSON.parse(user.employeeProfile.customFields) : {};
        } catch {
            meta = {};
        }

        const updatedMeta = {
            ...meta,
            onboardingToken: token,
            tokenUsed: false,
            onboardingSubmitted: false,
            adminRemarks: cleanRemarks,
            fieldRemarks: fieldRemarks || {},
            changesRequestedAt: new Date().toISOString()
        };

        await prisma.employeeProfile.update({
            where: { id: user.employeeProfile.id },
            data: {
                status: 'Changes_Requested',
                customFields: JSON.stringify(updatedMeta)
            }
        });

        // Determine link URL
        const requestOrigin = (req.headers.origin as string) || (req.headers.referer ? new URL(req.headers.referer as string).origin : '');
        const primaryUrl = (requestOrigin && requestOrigin.startsWith('http'))
            ? requestOrigin.replace(/\/+$/, '')
            : (process.env.FRONTEND_URL || 'https://omnihr-frontend.vercel.app').replace(/\/+$/, '');
        const correctionUrl = `${primaryUrl}/complete-profile?token=${token}`;

        // Send email to candidate with remarks
        try {
            const emailContent = employeeCorrectionRequestTemplate({
                name: user.name || user.email.split('@')[0],
                remarks: cleanRemarks,
                correctionUrl
            });

            await sendMail({
                to: user.email,
                subject: 'Action Required: Updates needed on your onboarding profile - OmniHR',
                html: emailContent.html,
                text: emailContent.text
            });
            console.log(`[Onboarding] Sent correction email with remarks to ${user.email}`);
        } catch (mailError) {
            console.error('[Onboarding] Error sending correction email:', mailError);
        }

        return res.json({
            success: true,
            message: `Correction remarks sent to ${user.email} successfully!`,
            status: 'Changes_Requested'
        });
    } catch (error: any) {
        console.error('Error requesting onboarding changes:', error);
        return res.status(500).json({ message: error.message || 'Failed to send remarks' });
    }
};
