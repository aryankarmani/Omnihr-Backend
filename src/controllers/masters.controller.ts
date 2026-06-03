import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Generic handler for fetching all records of a master
export const getAll = (model: string) => async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        // @ts-ignore
        let data = await prisma[model].findMany({
            where: { tenantId }
        });

        // ✅ UPDATED: convert title to name for frontend
        if (model === 'designation') {
            data = data.map((item: any) => ({
                ...item,
                name: item.title,
            }));
        }
        res.json(data);
    } catch (error:any) {
        res.status(500).json({ error: 'Failed to fetch data' ,
            details: error.message,
        });
    }
};

export const createHoliday = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;

        const {
            name,
            date,
            type,
            isOptional,
            stateId,
        } = req.body;

        if (!name || !date) {
            return res.status(400).json({
                error: "Holiday name and date are required",
            });
        }

        const holiday = await prisma.holiday.create({
            data: {
                tenantId,

                name,

                date: new Date(date),

                type: type || "PUBLIC",

                isOptional: isOptional || false,

                stateId: stateId ? Number(stateId) : null,
            },
        });

        res.status(201).json(holiday);
    } catch (error: any) {
        console.error("Holiday create error:", error);

        res.status(500).json({
            error: "Failed to create holiday",
            details: error.message,
        });
    }
};

// Generic handler for creating a record
export const create = (model: string) => async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;

        // FIX: frontend sends name, but Designation schema needs title
        if (model === 'designation') {
            if (req.body.name && !req.body.title) {
                req.body.title = req.body.name;
            }

            delete req.body.name;
            delete req.body.reportTo;
        }
        // @ts-ignore
        const data = await prisma[model].create({
            data: { ...req.body, tenantId }
        });
         if (model === 'designation') {
            return res.json({
                ...data,
                name: data.title,
            });
        }
        res.json(data);
    } catch (error:any) {
        res.status(500).json({ error: 'Failed to create record' ,
            details: error.message,
        });
    }
};

export const update = (model: string) => async (req: Request, res: Response) => {
    try {
        const { tenantId } = (req as any).user;
        const { id } = req.params;

        if (model === 'designation') {
            if (req.body.name && !req.body.title) {
                req.body.title = req.body.name;
            }

            delete req.body.name;
            delete req.body.reportTo;
        }

        // @ts-ignore
        await prisma[model].updateMany({
            where: { id, tenantId },
            data: req.body,
        });

        // @ts-ignore
        const updated = await prisma[model].findFirst({
            where: { id, tenantId },
        });
          if (model === 'designation' && updated) {
            return res.json({
                ...updated,
                name: updated.title,
            });
        }

        res.json(updated);
    } catch (error: any) {
        res.status(500).json({
            error: 'Failed to update record',
            details: error.message,
        });
    }
};

export const remove = (model: string) => async (req: Request, res: Response) => {
    try {
        const { tenantId } = (req as any).user;
        const { id } = req.params;

        // @ts-ignore
        await prisma[model].deleteMany({
            where: { id, tenantId },
        });

        res.json({ message: 'Deleted successfully' });
    } catch (error: any) {
        res.status(500).json({
            error: 'Failed to delete record',
            details: error.message,
        });
    }
};


// COMPANY
export const getCompany = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const company = await prisma.company.findFirst({
            where: { tenantId },
            include: { locations: true, departments: true, designations: true }
        });
        res.json(company);
    } catch (error: any) {
        res.status(500).json({ error: "Failed to fetch company" , 
            details: error.message });
    }
};

export const updateCompany = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { legalName, cin, pan, tan, gstin, regAddress, website, logo, primaryColor, secondaryColor } = req.body;

        // Upsert company
        const company = await prisma.company.findFirst({ where: { tenantId } });

        if (company) {
            const updated = await prisma.company.update({
                where: { id: company.id },
                data: { legalName, cin, pan, tan, gstin, regAddress, website, logo, primaryColor, secondaryColor }
            });
            res.json(updated);
        } else {
            const newCompany = await prisma.company.create({
                data: {
                    tenantId, legalName: legalName || 'Default Company', cin, pan, tan, gstin, regAddress, website, logo, primaryColor, secondaryColor
                }
            });
            res.json(newCompany);
        }
    } catch (error: any) {
        res.status(500).json({ error: "Failed to update company",
            details: error.message
         });
    }
};


// SPECIFIC CONTROLLERS FOR NESTED LOGIC

export const createLocation = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { companyId, ...data } = req.body;
        // Ensure company belongs to tenant
        const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
        if (!company) return res.status(404).json({ error: "Company not found" });

        const location = await prisma.location.create({
            data: { ...data, companyId, tenantId }
        });
        res.json(location);
    } catch (error:any) {
        res.status(500).json({ error: "Failed to create location", details: error.message, });
    }
}

export const createDepartment = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { companyId, ...data } = req.body;
        const company = await prisma.company.findFirst({ where: { id: companyId, tenantId } });
        if (!company) return res.status(404).json({ error: "Company not found" });

        const dept = await prisma.department.create({
            data: { ...data, companyId, tenantId }
        });
        res.json(dept);
    } catch (error:any) {
        res.status(500).json({ error: "Failed to create department", details: error.message });
    }
}

// STATUTORY SETTINGS
export const getStatutorySettings = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const settings = await prisma.statutorySettings.findUnique({ where: { tenantId } });
        res.json(settings || {});
    } catch (error:any) {
        res.status(500).json({ error: "Failed to fetch statutory settings", details: error.message });
    }
}

export const updateStatutorySettings = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const settings = await prisma.statutorySettings.upsert({
            where: { tenantId },
            update: req.body,
            create: { ...req.body, tenantId }
        });
        res.json(settings);
    } catch (error:any) {
        res.status(500).json({ error: "Failed to update statutory settings", details: error.message });
    }
}

// GEO MASTERS
export const getStates = async (req: Request, res: Response) => {
    try {
        const states = await prisma.state.findMany({ orderBy: { name: 'asc' } });
        res.json(states);
    } catch (error:any) {
        res.status(500).json({ error: "Failed to fetch states" , details: error.message});
    }
}

export const getCities = async (req: Request, res: Response) => {
    try {
        const { stateId } = req.query;
        if (!stateId) return res.status(400).json({ error: "State ID is required" });

        const cities = await prisma.city.findMany({
            where: { stateId: Number(stateId) },
            orderBy: { name: 'asc' }
        });
        res.json(cities);
    } catch (error:any) {
        res.status(500).json({ error: "Failed to fetch cities", details: error.message });
    }
}

// ATTENDANCE & LEAVE MASTERS

// Attendance Polcy
export const getAttendancePolicy = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const policy = await prisma.attendancePolicy.findUnique({ where: { tenantId } });
        res.json(policy || {});
    } catch (error:any) { res.status(500).json({ error: "Failed to fetch policy", details: error.message }); }
};

export const updateAttendancePolicy = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const policy = await prisma.attendancePolicy.upsert({
            where: { tenantId },
            update: req.body,
            create: { ...req.body, tenantId }
        });
        res.json(policy);
    } catch (error) { res.status(500).json({ error: "Failed to update policy" }); }
};

// ACCESS CONTROL
export const getPermissions = async (req: Request, res: Response) => {
    try {
        const permissions = await prisma.permission.findMany();
        res.json(permissions);
    } catch (error){console.error("Get permissions error:", error);
          res.status(500).json({ error: "Failed to fetch permissions" }); 
        }
};

export const getRoles = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const roles = await prisma.role.findMany({
            where: {
                tenantId,
                NOT: {
                    name: "MANAGER",
                },
            },
            include: { permissions: true }
        });
        res.json(roles);
    } catch (error){console.error("Get roles error:", error);
          res.status(500).json({ error: "Failed to fetch roles" }); }
};

export const createRole = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { name, permissionIds= [], accessibleModules = ""} = req.body;

        // ✅ CHANGED: Manager role should not be created from Masters
        if (String(name).trim().toUpperCase() === "MANAGER") {
            return res.status(400).json({
                error: "MANAGER role is not allowed. Manager access is handled from Team Access Control.",
            });
        }

        const role = await prisma.role.create({
            data: {
                name,
                tenantId,
                accessibleModules: accessibleModules || "",
                permissions: {
                    connect: permissionIds.map((id: string) => ({ id }))
                }
            },
            include: { permissions: true }
        });
        res.json(role);
    } catch (error:any){console.error("Create role error:", error);
          res.status(500).json({ error: "Failed to create role",
             details: error.message
          }); 
        }
};

export const updateRole = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, permissionIds= [], accessibleModules= "" } = req.body;
        
        console.log("Update role body:", req.body);

        const role = await prisma.role.update({
            where: { id: Number(id) },
            data: {
                name,
                accessibleModules: accessibleModules || "",
                permissions: {
                    set: [],
                    connect: permissionIds.map((pid: string) => ({ id: pid }))
                }
            },
            include: { permissions: true }
        });
        res.json(role);
    } catch (error:any){console.error("Update role error:", error);
          res.status(500).json({ error: "Failed to update role" ,
                details: error.message
         });
         }
};
export const deleteRole = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        await prisma.role.delete({
            where: { id: Number(id) }
        });

        res.json({ message: "Role deleted successfully" });
    } catch (error:any) {
        console.error("Delete role error:", error);
        res.status(500).json({ error: "Failed to delete role",
            details: error.message
         });
    }
};