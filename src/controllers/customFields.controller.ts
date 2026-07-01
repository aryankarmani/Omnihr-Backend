import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get Custom Fields (optionally filtered by category)
export const getCustomFields = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { category } = req.query;

        const whereClause: any = { tenantId };
        if (category) {
            whereClause.category = String(category);
        }

        const fields = await prisma.customField.findMany({
            where: whereClause,
            orderBy: { createdAt: 'desc' }
        });

        res.json(fields);
    } catch (error: any) {
        console.error("Get custom fields error:", error);
        res.status(500).json({ error: "Failed to fetch custom fields", details: error.message });
    }
};

// Create a new Custom Field and assign it to selected employees
export const createCustomField = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { name, category, type = "TEXT", employeeIds = [] } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Field name is required" });
        }
        if (!category || !["PERSONAL_DETAILS", "DOCUMENT_VAULT"].includes(category)) {
            return res.status(400).json({ error: "Invalid category. Must be PERSONAL_DETAILS or DOCUMENT_VAULT" });
        }

        const validTypes = ["TEXT", "NUMBER", "EMAIL", "PASSWORD", "RADIO", "FILE", "PDF", "IMAGE"];
        const normalizedType = String(type).toUpperCase();
        if (!validTypes.includes(normalizedType)) {
            return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
        }

        const normalizedName = name.trim();

        // Check if a field with the same name already exists in this tenant & category
        const existing = await prisma.customField.findFirst({
            where: { name: normalizedName, category, tenantId }
        });

        if (existing) {
            return res.status(400).json({ error: "A custom field with this name already exists in this category" });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create the CustomField
            const field = await tx.customField.create({
                data: {
                    name: normalizedName,
                    category,
                    type: normalizedType,
                    tenantId
                }
            });

            // 2. Fetch all active EmployeeProfiles for this tenant to assign the field to everyone
            const profiles = await tx.employeeProfile.findMany({
                where: {
                    tenantId,
                    isActive: true,
                    deletedAt: null
                }
            });

            // 3. Create assignments
            if (profiles.length > 0) {
                await tx.customFieldAssignment.createMany({
                    data: profiles.map(p => ({
                        fieldId: field.id,
                        employeeProfileId: p.id,
                        tenantId
                    }))
                });
            }

            return field;
        });

        res.status(201).json(result);
    } catch (error: any) {
        console.error("Create custom field error:", error);
        res.status(500).json({ error: "Failed to create custom field", details: error.message });
    }
};

// Delete a custom field
export const deleteCustomField = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { id } = req.params;

        const field = await prisma.customField.findFirst({
            where: { id, tenantId }
        });

        if (!field) {
            return res.status(404).json({ error: "Custom field not found" });
        }

        await prisma.customField.delete({
            where: { id }
        });

        res.json({ message: "Custom field deleted successfully" });
    } catch (error: any) {
        console.error("Delete custom field error:", error);
        res.status(500).json({ error: "Failed to delete custom field", details: error.message });
    }
};

// Get custom field assignments & values for a specific employee
export const getEmployeeCustomFields = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { id } = req.params; // userId

        const userId = id === 'me' ? (req.user as any).id : Number(id);

        const profile = await prisma.employeeProfile.findFirst({
            where: { userId, tenantId, isActive: true, deletedAt: null }
        });

        if (!profile) {
            return res.status(404).json({ error: "Employee profile not found" });
        }

        const assignments = await prisma.customFieldAssignment.findMany({
            where: { employeeProfileId: profile.id, tenantId },
            include: { field: true }
        });

        res.json(assignments);
    } catch (error: any) {
        console.error("Get employee custom fields error:", error);
        res.status(500).json({ error: "Failed to fetch employee custom fields", details: error.message });
    }
};

// Update personal details custom field values for an employee
export const updateEmployeeCustomFields = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { id } = req.params; // userId
        const { customFields = {} } = req.body; // e.g. { [fieldId]: "value" }

        const userId = id === 'me' ? (req.user as any).id : Number(id);

        const profile = await prisma.employeeProfile.findFirst({
            where: { userId, tenantId, isActive: true, deletedAt: null }
        });

        if (!profile) {
            return res.status(404).json({ error: "Employee profile not found" });
        }

        const promises = Object.entries(customFields).map(async ([fieldId, value]) => {
            return prisma.customFieldAssignment.upsert({
                where: {
                    fieldId_employeeProfileId: {
                        fieldId,
                        employeeProfileId: profile.id
                    }
                },
                update: { value: value !== null ? String(value) : null },
                create: {
                    fieldId,
                    employeeProfileId: profile.id,
                    value: value !== null ? String(value) : null,
                    tenantId
                }
            });
        });

        await Promise.all(promises);

        res.json({ message: "Custom fields updated successfully" });
    } catch (error: any) {
        console.error("Update employee custom fields error:", error);
        res.status(500).json({ error: "Failed to update custom fields", details: error.message });
    }
};

// Upload document for a custom document field
export const uploadCustomFieldDocument = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { id, fieldId } = req.params; // id is userId
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const userId = id === 'me' ? (req.user as any).id : Number(id);

        const profile = await prisma.employeeProfile.findFirst({
            where: { userId, tenantId, isActive: true, deletedAt: null }
        });

        if (!profile) {
            return res.status(404).json({ error: "Employee profile not found" });
        }

        // Upsert assignment with file information
        const assignment = await prisma.customFieldAssignment.upsert({
            where: {
                fieldId_employeeProfileId: {
                    fieldId,
                    employeeProfileId: profile.id
                }
            },
            update: {
                documentUrl: file.filename,
                documentName: file.originalname
            },
            create: {
                fieldId,
                employeeProfileId: profile.id,
                documentUrl: file.filename,
                documentName: file.originalname,
                tenantId
            },
            include: { field: true }
        });

        res.status(201).json(assignment);
    } catch (error: any) {
        console.error("Upload custom field document error:", error);
        res.status(500).json({ error: "Failed to upload document", details: error.message });
    }
};

// Delete document for a custom document field
export const deleteCustomFieldDocument = async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user as any;
        const { id, fieldId } = req.params; // id is userId

        const userId = id === 'me' ? (req.user as any).id : Number(id);

        const profile = await prisma.employeeProfile.findFirst({
            where: { userId, tenantId, isActive: true, deletedAt: null }
        });

        if (!profile) {
            return res.status(404).json({ error: "Employee profile not found" });
        }

        const assignment = await prisma.customFieldAssignment.findUnique({
            where: {
                fieldId_employeeProfileId: {
                    fieldId,
                    employeeProfileId: profile.id
                }
            }
        });

        if (!assignment) {
            return res.status(404).json({ error: "Assignment not found" });
        }

        await prisma.customFieldAssignment.update({
            where: {
                fieldId_employeeProfileId: {
                    fieldId,
                    employeeProfileId: profile.id
                }
            },
            data: {
                documentUrl: null,
                documentName: null
            }
        });

        res.json({ message: "Document deleted successfully" });
    } catch (error: any) {
        console.error("Delete custom field document error:", error);
        res.status(500).json({ error: "Failed to delete document", details: error.message });
    }
};
