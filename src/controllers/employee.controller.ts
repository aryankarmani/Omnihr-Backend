import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createNotification, notifyAdmins } from '../utils/notification';
import { getManagerTeamMemberIds } from "../utils/teamScope";
import bcrypt from "bcryptjs"; 
import { sendMail } from "../utils/mail";

const prisma = new PrismaClient();

const employeeInclude = {
    employeeProfile: {
        include: {
            statutory: true,
            bank: true,
            documents: true,
            salary: true,
            departmentRef: true,
            designationRef: true,

            locationRef: true,
            shiftRef: true,
        },
    },
    role: true,
    manager: true,
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

        const {
            name, email, password, phone, role, roleId,
            department, location, title, departmentId, designationId, locationId, shiftId, joiningDate,
            dob,
            address,
            bloodGroup,
            uan, pfNumber, esic, pan, aadhaar,
            bankName, accountNumber, ifsc,
            salary,
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
        };

        let targetRoleId = roleId;
        if (!targetRoleId) {
            const defaultRole = await prisma.role.findFirst({
                where: { name: 'EMPLOYEE', tenantId }
            });
            targetRoleId = defaultRole?.id;
        }

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

            // ✅ ADDED: Hash password before saving user
            const plainPassword = password || "Welcome@123";
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

    
            const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
            if (files) {
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

        // ✅ ADDED: Send welcome email to new employee
        try {
            await sendMail({
                to: email,
                subject: "Welcome to EnCalm HRMS",
                html: `
            <h2>Welcome ${name}</h2>
            <p>Your employee account has been created in EnCalm HRMS.</p>
            <p><b>Email:</b> ${email}</p>
            <p><b>Temporary Password:</b> ${password || "Welcome@123"}</p>
            <p>Please login and change your password.</p>
        `,
            });
        } catch (mailError) {
            console.log("Employee created but email failed:", mailError);
        }

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
                        salary: true
                    }
                },
                role: true,
                manager: true
            }
        });

        if (!employee) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        res.json(employee);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update Employee Profile (Personal, Statutory, Bank)
export const updateEmployee = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = Number(id);

        const {
            // User model
            name, email,
            // Profile model
            phone, dob, bloodGroup, address, role, roleId, location, department, title, status,

            departmentId,
            designationId,
            locationId,
            shiftId,

            // Statutory
            uan, pfNumber, esic, pan, aadhaar,
            // Bank
            bankName, accountNumber, ifsc,
            // Salary
            salary
        } = req.body;

        const tenantId = (req as any).user?.tenantId;
        if (!tenantId) return res.status(401).json({ message: 'Unauthorized' });

        const existingEmployee = await prisma.user.findFirst({
            where: {
                id: Number(id),
                tenantId,
            },
        });

        if (!existingEmployee) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        const finalRoleId = await getOrCreateRoleId(tenantId, roleId, role);

        // UPDATED: auto-create/find department and designation masters
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
            where: {
                id: userId,
            },
            data: {
                ...(name && { name }),
                ...(email && { email }),
                ...(finalRoleId && { roleId: finalRoleId }),
            },
        });

        // NEW UPDATE: Convert salary string values into numbers
        const salaryData = {
            basic: Number(salary?.basic || 0),
            hra: Number(salary?.hra || 0),
            special: Number(salary?.special || 0),
            medical: Number(salary?.medical || 0),
            pf: Number(salary?.pf || 0),
            pt: Number(salary?.pt || 0),
            tax: Number(salary?.tax || 0),
        };


        // Upsert Profile
        const updatedProfile = await prisma.employeeProfile.upsert({
            where: { userId: Number(id) },
            create: {
                userId: Number(id),
                tenantId,
                title, department, location, phone, status, dob: dob ? new Date(dob) : undefined, bloodGroup, address,
                departmentId: finalDepartmentId,
                designationId: finalDesignationId,
                locationId: locationId || null,
                shiftId: shiftId || null,
                statutory: {
                    create: { uan, pfNumber, esic, pan, aadhaar }
                },
                bank: {
                    create: {
                        bankName: bankName || 'Not Provided',
                        accountNumber: accountNumber || 'Not Provided',
                        ifsc: ifsc || 'Not Provided'
                    }
                },

                // UPDATED: create salary if profile did not exist
                salary: {
                    create: salaryData
                }
            },
            update: {
                title, department, location, phone, status, dob: dob ? new Date(dob) : undefined, bloodGroup, address,

                // UPDATED: save selected master ids also while editing
                departmentId: finalDepartmentId,
                designationId: finalDesignationId,
                locationId: locationId || null,
                shiftId: shiftId || null,

                statutory: {
                    upsert: {
                        create: { uan, pfNumber, esic, pan, aadhaar },
                        update: { uan, pfNumber, esic, pan, aadhaar }
                    }
                },
                bank: {
                    upsert: {
                        create: {
                            bankName: bankName || 'Not Provided',
                            accountNumber: accountNumber || 'Not Provided',
                            ifsc: ifsc || 'Not Provided'
                        },
                        update: {
                            bankName: bankName || 'Not Provided',
                            accountNumber: accountNumber || 'Not Provided',
                            ifsc: ifsc || 'Not Provided'
                        }
                    }
                },

                // UPDATED: this was missing, salary was not updating
                salary: {
                    upsert: {
                        create: salaryData,
                        update: salaryData
                    }
                }
            }
        });

        // Update User Model if name or email changed
        if (name || email) {
            await prisma.user.update({
                where: { id: Number(id) },
                data: {
                    ...(name && { name }),
                    ...(email && { email })
                }
            });
        }

        await createNotification({
            tenantId,
            userId: Number(id),
            title: 'Profile Updated',
            message: 'Your employee profile has been updated by admin.',
            type: 'employee',
        });

        res.json(updatedProfile);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Add Document
export const addDocument = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ message: 'File is required' });
        }

        const name = req.body.name || file.originalname;
        const type = req.body.type || file.mimetype;

        // Find Profile ID first
        const profile = await prisma.employeeProfile.findUnique({ where: { userId: Number(id) } });
        if (!profile) return res.status(404).json({ message: 'Profile not found. Create profile first.' });

        // Overwrite if same file type already exists
        const existingDoc = await prisma.document.findFirst({
            where: { profileId: profile.id, name }
        });

        if (existingDoc) {
            await prisma.document.delete({ where: { id: existingDoc.id } });
        }

        const doc = await prisma.document.create({
            data: {
                profileId: profile.id,
                name,
                url: file.filename,
                type,
                originalName: file.originalname
            }
        });

        res.status(201).json(doc);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
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

        res.json({ message: 'Employee and all associated records deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Delete Document
export const deleteDocument = async (req: Request, res: Response) => {
    try {
        const { docId } = req.params;
        await prisma.document.delete({ where: { id: Number(docId) } });
        res.json({ message: 'Document deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
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
                        salary: true
                    }
                },
                role: true,
                manager: true
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
