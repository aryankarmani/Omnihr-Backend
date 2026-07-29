import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createNotification, notifyAdmins } from '../utils/notification';
import { getManagerTeamMemberIds } from "../utils/teamScope";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendMail, employeeWelcomeTemplate } from "../utils/mail";
import { createAuditLog } from "../utils/auditLog";
import fs from 'fs';
import path from 'path';


const prisma = new PrismaClient();

// ✅ ADDED: calculate salary total
const calculateSalaryTotal = (salary: any) => {
    if (!salary) return 0;

    return (
        Number(salary.basic || 0) +
        Number(salary.hra || 0) +
        Number(salary.special || 0) +
        Number(salary.medical || 0)
    );
};

// ✅ ADDED: current month like "2026-06"
const getCurrentSalaryMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

// ✅ ADDED: compare old salary and new salary
const isSalaryChanged = (oldSalary: any, newSalary: any) => {
    if (!oldSalary || !newSalary) return false;

    return (
        Number(oldSalary.basic || 0) !== Number(newSalary.basic || 0) ||
        Number(oldSalary.hra || 0) !== Number(newSalary.hra || 0) ||
        Number(oldSalary.special || 0) !== Number(newSalary.special || 0) ||
        Number(oldSalary.medical || 0) !== Number(newSalary.medical || 0) ||
        Number(oldSalary.pf || 0) !== Number(newSalary.pf || 0) ||
        Number(oldSalary.pt || 0) !== Number(newSalary.pt || 0) ||
        Number(oldSalary.tax || 0) !== Number(newSalary.tax || 0)
    );
};

// ✅ ADDED: Generates strong random password for every employee
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

// ✅ ADDED: Gets frontend URL from request origin, not .env
const getFrontendLoginUrl = (req: Request) => {
    const origin = req.headers.origin;

    if (origin && origin.startsWith("http")) {
        return `${origin}/login`;
    }

    return "http://localhost:5173/login";
};

const employeeInclude = {
    employeeProfile: {
        include: {
            statutory: true,
            bank: true,
            documents: true,
            salary: true,
            salaryComponents: {
                include: {
                    component: true,
                },
            },
            departmentRef: true,
            designationRef: true,

            locationRef: true,
            shiftRef: true,
        },
    },
    role: true,
    manager: {
        include: {
            employeeProfile: true
        }
    },
    teamMembers: {
        include: {
            team: {
                include: {
                    manager: {
                        include: {
                            employeeProfile: true
                        }
                    }
                }
            }
        }
    }
};

const getOrCreateRoleId = async (
    tenantId: string,
    roleId?: any,
    roleName?: any
) => {
    if (roleId) return Number(roleId);

    const cleanRoleName =
        typeof roleName === "string" ? roleName.trim().toUpperCase() : "";

    // ✅ CHANGED: If frontend sends MANAGER, ignore it and use EMPLOYEE
    const safeRoleName =
        cleanRoleName === "MANAGER" || !cleanRoleName
            ? "EMPLOYEE"
            : cleanRoleName;

    const role = await prisma.role.findFirst({
        where: {
            tenantId,
            name: safeRoleName,
        },
    });

    if (role) return role.id;

    const defaultRole = await prisma.role.findFirst({
        where: {
            tenantId,
            name: 'EMPLOYEE',
        },
    });

    return defaultRole?.id || null;
};

// UPDATED: get or create default company
const getDefaultCompany = async (tenantId: string, tx: any) => {
    let company = await tx.company.findFirst({
        where: { tenantId },
    });

    if (!company) {
        company = await tx.company.create({
            data: {
                tenantId,
                legalName: 'Default Company',
            },
        });
    }

    return company;
};

// UPDATED: auto-create department master
const getOrCreateDepartmentId = async (
    tenantId: string,
    tx: any,
    departmentId?: any,
    departmentName?: any
) => {
    if (departmentId) return String(departmentId);

    if (!departmentName || typeof departmentName !== 'string') return null;

    const cleanName = departmentName.trim();
    if (!cleanName) return null;

    let department = await tx.department.findFirst({
        where: {
            tenantId,
            name: cleanName,
        },
    });

    if (!department) {
        const company = await getDefaultCompany(tenantId, tx);

        department = await tx.department.create({
            data: {
                tenantId,
                companyId: company.id,
                name: cleanName,
            },
        });
    }

    return department.id;
};

// UPDATED: auto-create designation master
const getOrCreateDesignationId = async (
    tenantId: string,
    tx: any,
    designationId?: any,
    designationName?: any
) => {
    if (designationId) return String(designationId);

    if (!designationName || typeof designationName !== 'string') return null;

    const cleanTitle = designationName.trim();
    if (!cleanTitle) return null;

    let designation = await tx.designation.findFirst({
        where: {
            tenantId,
            title: cleanTitle,
        },
    });

    if (!designation) {
        const company = await getDefaultCompany(tenantId, tx);

        designation = await tx.designation.create({
            data: {
                tenantId,
                companyId: company.id,
                title: cleanTitle,
            },
        });
    }

    return designation.id;
};

// Get all employees for the tenant
export const getAllEmployees = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        const userId = (req as any).user?.id;
        const role = (req as any).user?.role;

        if (!tenantId) return res.status(401).json({ message: 'Unauthorized' });

        const { departmentId } = req.query;

        const whereClause: any = {
            tenantId,
            isActive: true,
            deletedAt: null,
            ...(departmentId
                ? {
                    employeeProfile: {
                        departmentId: String(departmentId),
                        isActive: true,
                        deletedAt: null,
                    },
                }
                : {}),
        };

        // ✅ CHANGED: Manager is checked from Team.managerId, not role
        const memberIds = await getManagerTeamMemberIds(tenantId, userId);

        if (memberIds.length > 0 && role !== "HR_ADMIN" && role !== "ADMIN" && role !== "SYSTEM_ADMIN") {
            whereClause.id = {
                in: memberIds,
            };
        }

        const employees = await prisma.user.findMany({
            where: whereClause,
            include: employeeInclude,
            orderBy: { createdAt: 'desc' }
        });


        res.json(employees);
    } catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Create a new employee (Onboarding)
export const createEmployee = async (req: Request, res: Response) => {
    try {
        const tenantId = (req as any).user?.tenantId;
        if (!tenantId) return res.status(401).json({ message: 'Unauthorized' });

        const data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body;
        const uploadedFiles = req.files as Express.Multer.File[] | undefined;

const profilePhotoFile = uploadedFiles?.find(
    (file) => file.fieldname === "profilePhoto" || file.fieldname === "profilePicture"
);

const profilePhotoPath = profilePhotoFile
    ? `/uploads/${profilePhotoFile.filename}`
    : null;

        const {
            name, email, password, phone, role, roleId,
            department, location, title, departmentId, designationId, locationId, shiftId, joiningDate,
            dob,
            address,
            bloodGroup,
            uan, pfNumber, esic, pan, aadhaar,
            bankName, accountNumber, ifsc,
            salary,
            customFieldValues = {},
        } = data;

        // Basic validation
        if (!email || !name) {
            return res.status(400).json({ message: 'Name and email are required' });
        }

        // Check if user already exists in this tenant
        const existingUser = await prisma.user.findUnique({
            where: { email_tenantId: { email, tenantId } }
        });

        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // If no roleId provided, find the default 'EMPLOYEE' role
        const finalRoleId = await getOrCreateRoleId(tenantId, roleId, role);

        // NEW UPDATE: Convert salary values safely into numbers
        const salaryData = {
            basic: Number(salary?.basic || 0),
            hra: Number(salary?.hra || 0),
            special: Number(salary?.special || 0),
            medical: Number(salary?.medical || 0),
            pf: Number(salary?.pf || 0),
            pt: Number(salary?.pt || 0),
            tax: Number(salary?.tax || 0),
            totalSalary: calculateSalaryTotal(salary),
        };

        let targetRoleId = roleId;
        if (!targetRoleId) {
            const defaultRole = await prisma.role.findFirst({
                where: { name: 'EMPLOYEE', tenantId }
            });
            targetRoleId = defaultRole?.id;
        }

        // ✅ ADDED: Generated once so we can hash it and also send it in email
        const plainPassword = generateRandomPassword();
        const loginUrl = getFrontendLoginUrl(req);

        const newUser = await prisma.$transaction(async (tx) => {
            // UPDATED: auto-create/find department and designation masters
            const finalDepartmentId = await getOrCreateDepartmentId(
                tenantId,
                tx,
                departmentId,
                department
            );

            const finalDesignationId = await getOrCreateDesignationId(
                tenantId,
                tx,
                designationId,
                title || "Employee"
            );

            // ✅ CHANGED: Always generate random password for every employee
            const hashedPassword = await bcrypt.hash(plainPassword, 10);

            // 1. Create User
            const user = await tx.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword, // Default password
                    tenantId,
                    roleId: finalRoleId,
                    isActive: true, // ✅ ADDED: ensure login query can find user
                    deletedAt: null,
                }
            });

            // 2. Create Employee Profile
            const profile = await tx.employeeProfile.create({
                data: {
                    userId: user.id,
                    tenantId,
                    phone,

                    department,
                    location,
                    title: title || 'Employee',

                    departmentId: finalDepartmentId,
                    designationId: finalDesignationId,

                    locationId: locationId || null,
                    shiftId: shiftId || null,
                    joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
                    status: 'Active',

                    // NEW UPDATE: Save DOB, Address and Blood Group
                    dob: dob ? new Date(dob) : null,
                    address: address || null,
                    bloodGroup: bloodGroup || null,
                    avatar: profilePhotoPath,

                    isActive: true, // ✅ ADDED
                    deletedAt: null,

                    // NEW UPDATE: Create Salary Structure while onboarding
                    salary: {
                        create: salaryData,
                    },
                },
            });

            // 3. Create Statutory Details
            await tx.statutoryDetails.create({
                data: {
                    profileId: profile.id,
                    uan,
                    pfNumber,
                    esic,
                    pan,
                    aadhaar
                }
            });

            // 4. Create Bank Details
            await tx.bankDetails.create({
                data: {
                    profileId: profile.id,
                    bankName: bankName || 'Not Provided',
                    accountNumber: accountNumber || 'Not Provided',
                    ifsc: ifsc || 'Not Provided'
                }
            });


            // Parse flat req.files array into a fieldname mapping
            const filesArray = req.files as Express.Multer.File[] | undefined;
            const files: { [fieldname: string]: Express.Multer.File[] } = {};
            if (filesArray) {
                filesArray.forEach(file => {
                    if (!files[file.fieldname]) {
                        files[file.fieldname] = [];
                    }
                    files[file.fieldname].push(file);
                });
            }

            // Create custom field assignments for all active custom fields for the tenant
            const cfMasters = await tx.customField.findMany({
                where: { tenantId }
            });

            if (cfMasters.length > 0) {
                const customFieldsMap: Record<string, any> = {};
                cfMasters.forEach((cf) => {
                    const value = customFieldValues[cf.id] !== undefined ? String(customFieldValues[cf.id]) : null;
                    
                    // Check if there is an uploaded file for this custom field
                    const fileArr = files[`custom-file-${cf.id}`];
                    const file = fileArr && fileArr[0];
                    const docUrl = file ? file.filename : null;
                    const docName = file ? file.originalname : null;

                    customFieldsMap[cf.id] = {
                        value,
                        documentUrl: docUrl,
                        documentName: docName
                    };
                });

                await tx.employeeProfile.update({
                    where: { id: profile.id },
                    data: {
                        customFields: JSON.stringify(customFieldsMap)
                    }
                });
            }

            // Save standard documents
            if (filesArray && filesArray.length > 0) {
                const docPromises = [];
                for (const fieldName of ['aadhaar', 'pan', 'degree']) {
                    const fileArr = files[fieldName];
                    if (fileArr && fileArr[0]) {
                        const file = fileArr[0];
                        docPromises.push(tx.document.create({
                            data: {
                                profileId: profile.id,
                                name: fieldName === 'aadhaar' ? 'Aadhaar Card' : fieldName === 'pan' ? 'PAN Card' : 'Highest Qualification Degree',
                                url: file.filename,
                                type: file.mimetype,
                                originalName: file.originalname
                            }
                        }));
                    }
                }
                await Promise.all(docPromises);
            }

            return user;
        });

        const fullEmployee = await prisma.user.findFirst({
            where: { id: newUser.id, tenantId },
            include: employeeInclude,
        });

        await createNotification({
            tenantId,
            userId: newUser.id,
            title: 'Welcome!',
            message: 'Your employee account has been created in Encalm HRMS.',
            type: 'employee',
        });

        await notifyAdmins({
            tenantId,
            title: 'New Employee Added',
            message: `${name} has been added as ${title || role || 'Employee'}.`,
            type: 'employee',
        });

        // ✅ CHANGED: Professional email with dynamic login link and random password
        try {
            const emailContent = employeeWelcomeTemplate({
                name,
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
        } catch (mailError) {
            console.log("Employee created but email failed:", mailError);
        }

        await createAuditLog({
            tenantId,
            module: "Employee",
            action: "Created",
            description: `New employee ${name} was created.`,
            performedById: (req as any).user?.id,
            performedBy: (req as any).user?.name || "Admin",
            performedByRole: (req as any).user?.role,
            targetUserId: newUser.id,
            targetUser: name,
            targetUserRole: "EMPLOYEE",
        });

        res.status(201).json(fullEmployee);
    } catch (error: any) {
        console.error('Error creating employee:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get Employee Profile with all details
export const getEmployee = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const tenantId = (req as any).user?.tenantId; // Assuming auth middleware attaches user

        if (!tenantId) return res.status(401).json({ message: 'Unauthorized' });

        const employee = await prisma.user.findFirst({
            where: {
                id: Number(id),
                tenantId
            },
            include: {
                employeeProfile: {
                    include: {
                        statutory: true,
                        bank: true,
                        documents: true,
                        salary: true,
                        salaryComponents: {
                            include: {
                                component: true,
                            },
                        },
                    },
                },
                role: true,
                manager: {
                    include: {
                        employeeProfile: true
                    }
                },
                teamMembers: {
                    include: {
                        team: {
                            include: {
                                manager: {
                                    include: {
                                        employeeProfile: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        const companySetting = await prisma.companySetting.findUnique({
            where: { tenantId }
        });

        if (!employee) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        res.json({
            ...employee,

            companySetting: {
                authorizedSignName:
                    companySetting?.authorizedSignName || "",

                authorizedSignTitle:
                    companySetting?.authorizedSignTitle || "",

                authorizedSignature:
                    companySetting?.authorizedSignImage
                        ? `/uploads/signatures/${companySetting.authorizedSignImage}`
                        : null,
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update Employee Profile (Personal, Statutory, Bank, Salary)
export const updateEmployee = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const loggedInUser = (req as any).user;

        const userId =
            req.path === "/me" || !id
                ? Number(loggedInUser?.id)
                : Number(id);

        if (!userId || Number.isNaN(userId)) {
            return res.status(400).json({ message: "Invalid employee id" });
        }

        const tenantId = loggedInUser?.tenantId;
        if (!tenantId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const {
            name,
            email,
            phone,
            dob,
            joiningDate,
            bloodGroup,
            address,
            role,
            roleId,
            location,
            department,
            title,
            status,
            departmentId,
            designationId,
            locationId,
            shiftId,
            uan,
            pfNumber,
            esic,
            pan,
            aadhaar,
            bankName,
            accountNumber,
            ifsc,
            salary,
            salaryMonth, // ✅ Example: "2026-06"
        } = req.body;

        const existingEmployee = await prisma.user.findFirst({
            where: {
                id: userId,
                tenantId,
                isActive: true,
                deletedAt: null,
            },
        });

        if (!existingEmployee) {
            return res.status(404).json({ message: "Employee not found" });
        }

        const oldProfile = await prisma.employeeProfile.findUnique({
            where: { userId },
            include: {
                salary: true,
            },
        });

        const finalRoleId = await getOrCreateRoleId(tenantId, roleId, role);

        const finalDepartmentId = await getOrCreateDepartmentId(
            tenantId,
            prisma,
            departmentId,
            department
        );

        const finalDesignationId = await getOrCreateDesignationId(
            tenantId,
            prisma,
            designationId,
            title || "Employee"
        );

        await prisma.user.update({
            where: { id: userId },
            data: {
                ...(name && { name }),
                ...(email && { email }),
                ...(finalRoleId && { roleId: finalRoleId }),
            },
        });

        const finalSalaryMonth = salaryMonth || getCurrentSalaryMonth();
        const hasSalaryInRequest = !!salary;

        const salaryData = hasSalaryInRequest
            ? {
                basic: Number(salary?.basic || 0),
                hra: Number(salary?.hra || 0),
                special: Number(salary?.special || 0),
                medical: Number(salary?.medical || 0),
                pf: Number(salary?.pf || 0),
                pt: Number(salary?.pt || 0),
                tax: Number(salary?.tax || 0),
                totalSalary: calculateSalaryTotal(salary),
            }
            : null;

        const updatedProfile = await prisma.employeeProfile.upsert({
            where: { userId },

            create: {
                userId,
                tenantId,
                title: title || "Employee",
                department: department || null,
                location: location || null,
                phone: phone || null,
                status: status || "Active",
                dob: dob ? new Date(dob) : null,
                joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
                bloodGroup: bloodGroup || null,
                address: address || null,
                departmentId: finalDepartmentId,
                designationId: finalDesignationId,
                locationId: locationId || null,
                shiftId: shiftId || null,
                
                isActive: true,
                deletedAt: null,

                statutory: {
                    create: {
                        uan,
                        pfNumber,
                        esic,
                        pan,
                        aadhaar,
                    },
                },

                bank: {
                    create: {
                        bankName: bankName || "Not Provided",
                        accountNumber: accountNumber || "Not Provided",
                        ifsc: ifsc || "Not Provided",
                    },
                },

                ...(salaryData && {
                    salary: {
                        create: salaryData,
                    },
                }),
            },

            update: {
                title: title || "Employee",
                department: department || null,
                location: location || null,
                phone: phone || null,
                status: status || "Active",
                dob: dob ? new Date(dob) : null,

                // ✅ ADDED: Update joining date when edited from frontend
                ...(joiningDate && {
                    joiningDate: new Date(joiningDate),
                }),
                bloodGroup: bloodGroup || null,
                address: address || null,
                departmentId: finalDepartmentId,
                designationId: finalDesignationId,
                locationId: locationId || null,
                shiftId: shiftId || null,
                isActive: true,
                deletedAt: null,

                statutory: {
                    upsert: {
                        create: {
                            uan,
                            pfNumber,
                            esic,
                            pan,
                            aadhaar,
                        },
                        update: {
                            uan,
                            pfNumber,
                            esic,
                            pan,
                            aadhaar,
                        },
                    },
                },

                bank: {
                    upsert: {
                        create: {
                            bankName: bankName || "Not Provided",
                            accountNumber: accountNumber || "Not Provided",
                            ifsc: ifsc || "Not Provided",
                        },
                        update: {
                            bankName: bankName || "Not Provided",
                            accountNumber: accountNumber || "Not Provided",
                            ifsc: ifsc || "Not Provided",
                        },
                    },
                },

                ...(salaryData && {
                    salary: {
                        upsert: {
                            create: salaryData,
                            update: salaryData,
                        },
                    },
                }),
            },
        });

        // ✅ Store salary month-wise only when salary changed
        if (
            salaryData &&
            oldProfile &&
            isSalaryChanged(oldProfile.salary, salaryData)
        ) {
            await prisma.salaryRevision.upsert({
                where: {
                    profileId_salaryMonth: {
                        profileId: oldProfile.id,
                        salaryMonth: finalSalaryMonth,
                    },
                },
                create: {
                    profileId: oldProfile.id,
                    tenantId,
                    salaryMonth: finalSalaryMonth,

                    previousBasic: Number(oldProfile.salary?.basic || 0),
                    previousHra: Number(oldProfile.salary?.hra || 0),
                    previousSpecial: Number(oldProfile.salary?.special || 0),
                    previousMedical: Number(oldProfile.salary?.medical || 0),
                    previousPf: Number(oldProfile.salary?.pf || 0),
                    previousPt: Number(oldProfile.salary?.pt || 0),
                    previousTax: Number(oldProfile.salary?.tax || 0),
                    previousTotal: calculateSalaryTotal(oldProfile.salary),

                    updatedBasic: salaryData.basic,
                    updatedHra: salaryData.hra,
                    updatedSpecial: salaryData.special,
                    updatedMedical: salaryData.medical,
                    updatedPf: salaryData.pf,
                    updatedPt: salaryData.pt,
                    updatedTax: salaryData.tax,
                    updatedTotal: salaryData.totalSalary,

                    updatedById: loggedInUser?.id || null,
                },
                update: {
                    updatedBasic: salaryData.basic,
                    updatedHra: salaryData.hra,
                    updatedSpecial: salaryData.special,
                    updatedMedical: salaryData.medical,
                    updatedPf: salaryData.pf,
                    updatedPt: salaryData.pt,
                    updatedTax: salaryData.tax,
                    updatedTotal: salaryData.totalSalary,
                    updatedById: loggedInUser?.id || null,
                },
            });
        }

        await createNotification({
            tenantId,
            userId,
            title: "Profile Updated",
            message: "Your employee profile has been updated by admin.",
            type: "employee",
        });

        await createAuditLog({
            tenantId,
            module: "Employee",
            action: "Updated",
            description: `${existingEmployee.name}'s profile was updated.`,
            performedById: loggedInUser?.id,
            performedBy: loggedInUser?.name || "Admin",
            performedByRole: loggedInUser?.role,
            targetUserId: userId,
            targetUser: name || existingEmployee.name,
            targetUserRole: role || "EMPLOYEE",
        });

        return res.json(updatedProfile);
    } catch (error: any) {
        console.error("Update employee error:", error);
        return res.status(500).json({
            message: "Server error",
            error: error.message,
        });
    }
};

// Add Document
export const addDocument = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const file = req.file;
        const tenantId = (req as any).user?.tenantId;

        if (!tenantId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (!file) {
            return res.status(400).json({ message: "File is required" });
        }

        const userId = Number(id);

        if (!userId || Number.isNaN(userId)) {
            return res.status(400).json({ message: "Invalid employee id" });
        }

        // ✅ ADDED: Check user exists first
        const user = await prisma.user.findFirst({
            where: {
                id: userId,
                tenantId,
                isActive: true,
                deletedAt: null,
            },
            include: {
                role: true,
            },
        });

        if (!user) {
            return res.status(404).json({ message: "Employee user not found" });
        }

        // ✅ CHANGED: Find profile, and if missing create it
        let profile = await prisma.employeeProfile.findFirst({
            where: {
                userId,
                tenantId,
                isActive: true,
                deletedAt: null,
            },
        });

        // ✅ ADDED: Auto-create EmployeeProfile for HR Admin/System Admin/old users
        if (!profile) {
            profile = await prisma.employeeProfile.create({
                data: {
                    userId,
                    tenantId,
                    title: user.role?.name === "HR_ADMIN" ? "System Admin" : "Employee",
                    department: user.role?.name === "HR_ADMIN" ? "HR" : null,
                    location: "Head Office",
                    joiningDate: new Date(),
                    status: "Active",
                    isActive: true,
                    deletedAt: null,
                },
            });
        }

        const name = req.body.name || file.originalname;
        const type = req.body.type || file.mimetype;

        // ✅ Existing same document name delete, then upload new
        const existingDoc = await prisma.document.findFirst({
            where: {
                profileId: profile.id,
                name,
            },
        });

        if (existingDoc) {
            await prisma.document.delete({
                where: { id: existingDoc.id },
            });
        }

        const doc = await prisma.document.create({
            data: {
                profileId: profile.id,
                name,
                url: file.filename,
                type,
                originalName: file.originalname,
            },
        });

        return res.status(201).json(doc);
    } catch (error: any) {
        console.error("Add document error:", error);
        return res.status(500).json({
            message: "Server error",
            error: error.message,
        });
    }
};
// Delete Employee
export const deleteEmployee = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const tenantId = (req as any).user?.tenantId;

        if (!tenantId) return res.status(401).json({ message: 'Unauthorized' });

        const userId = Number(id);

        const employee = await prisma.user.findFirst({
            where: {
                id: userId,
                tenantId,
                isActive: true,
                deletedAt: null,
            },
            include: {
                employeeProfile: true,
                role: true,
            },
        });

        if (!employee) {
            return res.status(404).json({ message: 'Employee not found or already deleted' });
        }

        // Use transaction to ensure everything is deleted
        await prisma.$transaction(async (tx) => {
            // 0. Handle subordinates (nullify their managerId)
            await tx.user.updateMany({
                where: {
                    managerId: userId,
                    tenantId,
                },
                data: { managerId: null }
            });

            // 1. Delete dependent records (Bank, Statutory, Documents, Salary)

            // UPDATED: Soft delete EmployeeProfile
            // No bank/statutory/document/salary records are deleted now
            await tx.employeeProfile.updateMany({
                where: {
                    userId,
                    tenantId,
                },
                data: {
                    isActive: false,
                    deletedAt: new Date(),
                    status: 'Inactive',
                },
            });

            // UPDATED: Soft delete User
            // Attendance, leave, tax, investment and payroll history remain saved
            await tx.user.update({
                where: {
                    id: userId,
                },
                data: {
                    isActive: false,
                    deletedAt: new Date(),
                },
            });
        });

        await createAuditLog({
    tenantId,
    module: "Employee",
    action: "Deleted",

    // ✅ FIXED: variable name is employee, not existingEmployee
    description: `${employee.name} was deleted/inactivated.`,

    performedById: (req as any).user?.id,
    performedBy: (req as any).user?.name || (req as any).user?.email || "Admin",
    performedByRole: (req as any).user?.role,

    targetUserId: userId,
    targetUser: employee.name,
    targetUserRole: employee.role?.name || "EMPLOYEE",
});

        res.json({ message: 'Employee and all associated records deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

export const deleteDocument = async (req: Request, res: Response) => {
    try {
        const { id, docId } = req.params;
        const tenantId = (req as any).user?.tenantId;

        if (!tenantId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // UPDATED: tenant-safe document lookup
        const document = await prisma.document.findFirst({
            where: {
                id: Number(docId),
                profile: {
                    userId: Number(id),
                    tenantId,
                },
            },
        });

        if (!document) {
            return res.status(404).json({
                message: "Document not found",
            });
        }

        await prisma.document.delete({
            where: { id: Number(docId) },
        });

        return res.json({ message: "Document deleted successfully" });
    } catch (error: any) {
        console.error("Delete document error:", error);
        return res.status(500).json({
            message: "Server error",
            error: error.message,
        });
    }
};

// Get profile of the currently logged-in user
export const getCurrentEmployee = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        const tenantId = (req as any).user?.tenantId;

        if (!userId || !tenantId) return res.status(401).json({ message: 'Unauthorized' });

        const employee = await prisma.user.findFirst({
            where: {
                id: userId,
                tenantId
            },
            include: {
                employeeProfile: {
                    include: {
                        statutory: true,
                        bank: true,
                        documents: true,
                        salary: true,
                        salaryComponents: {
                            include: {
                                component: true,
                            },
                        },
                    },
                },
                role: true,
                manager: {
                    include: {
                        employeeProfile: true
                    }
                },
                teamMembers: {
                    include: {
                        team: {
                            include: {
                                manager: {
                                    include: {
                                        employeeProfile: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!employee) {
            return res.status(404).json({ message: 'Employee profile not found' });
        }

        res.json(employee);
    } catch (error) {
        console.error('Error fetching current employee:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update profile picture for employee (self or by id)
export const updateProfilePicture = async (req: Request, res: Response) => {
    try {
        const loggedInUser = (req as any).user;
        const { id } = req.params;

        const userId =
            req.path.includes('/me') || !id
                ? Number(loggedInUser?.id)
                : Number(id);

        if (!userId || Number.isNaN(userId)) {
            return res.status(400).json({ message: "Invalid employee id" });
        }

        const tenantId = loggedInUser?.tenantId;
        if (!tenantId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const file = req.file;
        if (!file) {
            return res.status(400).json({ message: "Profile picture file is required" });
        }

        // Find existing employee profile
        const profile = await prisma.employeeProfile.findFirst({
            where: {
                userId,
                tenantId,
                isActive: true,
                deletedAt: null,
            }
        });

        if (!profile) {
            return res.status(404).json({ message: "Employee profile not found" });
        }

        // Delete old profile picture if it exists on disk and is a file path
        if (profile.avatar && profile.avatar.startsWith('/uploads/')) {
            const oldFilePath = path.join(process.cwd(), profile.avatar);
            if (fs.existsSync(oldFilePath)) {
                try {
                    fs.unlinkSync(oldFilePath);
                } catch (err) {
                    console.error("Failed to delete old avatar file:", err);
                }
            }
        }

        // Save new profile picture path
        const profilePhotoPath = `/uploads/${file.filename}`;

        const updatedProfile = await prisma.employeeProfile.update({
            where: { id: profile.id },
            data: { avatar: profilePhotoPath }
        });

        return res.json(updatedProfile);
    } catch (error: any) {
        console.error("Update profile picture error:", error);
        return res.status(500).json({
            message: "Server error",
            error: error.message
        });
    }
};

// Delete profile picture for employee (self or by id)
export const deleteProfilePicture = async (req: Request, res: Response) => {
    try {
        const loggedInUser = (req as any).user;
        const { id } = req.params;

        const userId =
            req.path.includes('/me') || !id
                ? Number(loggedInUser?.id)
                : Number(id);

        if (!userId || Number.isNaN(userId)) {
            return res.status(400).json({ message: "Invalid employee id" });
        }

        const tenantId = loggedInUser?.tenantId;
        if (!tenantId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // Find existing employee profile
        const profile = await prisma.employeeProfile.findFirst({
            where: {
                userId,
                tenantId,
                isActive: true,
                deletedAt: null,
            }
        });

        if (!profile) {
            return res.status(404).json({ message: "Employee profile not found" });
        }

        // Delete old profile picture if it exists on disk
        if (profile.avatar && profile.avatar.startsWith('/uploads/')) {
            const oldFilePath = path.join(process.cwd(), profile.avatar);
            if (fs.existsSync(oldFilePath)) {
                try {
                    fs.unlinkSync(oldFilePath);
                } catch (err) {
                    console.error("Failed to delete old avatar file:", err);
                }
            }
        }

        const updatedProfile = await prisma.employeeProfile.update({
            where: { id: profile.id },
            data: { avatar: null }
        });

        return res.json(updatedProfile);
    } catch (error: any) {
        console.error("Delete profile picture error:", error);
        return res.status(500).json({
            message: "Server error",
            error: error.message
        });
    }
};
