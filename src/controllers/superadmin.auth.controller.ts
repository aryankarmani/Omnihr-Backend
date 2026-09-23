import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { SuperAdminRequest } from "../middleware/superadmin.auth";

const prisma = new PrismaClient();

// ✅ REGISTER: Create a new Super Admin via API (Postman / frontend)
export const registerSuperAdmin = async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required." });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters long." });
    }

    // Check if superadmin already exists
    const existing = await prisma.superAdmin.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existing) {
      return res.status(400).json({ message: "A Super Admin with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const superAdmin = await prisma.superAdmin.create({
      data: {
        name,
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: "SUPER_ADMIN",
        isActive: true,
        forcePasswordChange: false,
      },
    });

    // Auto-generate a token so the admin can immediately use it
    const token = jwt.sign(
      {
        id: superAdmin.id,
        email: superAdmin.email,
        name: superAdmin.name,
        role: "SUPER_ADMIN",
        type: "SUPER_ADMIN",
      },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      message: "Super Admin registered successfully.",
      token,
      superAdmin: {
        id: superAdmin.id,
        email: superAdmin.email,
        name: superAdmin.name,
        role: superAdmin.role,
      },
    });
  } catch (error: any) {
    console.error("Super Admin register error:", error);
    return res.status(500).json({ message: "Internal server error during registration." });
  }
};

export const superAdminLogin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const admin = await prisma.superAdmin.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!admin) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (!admin.isActive) {
      return res.status(403).json({ message: "This Super Admin account has been deactivated." });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: "SUPER_ADMIN",
        type: "SUPER_ADMIN",
      },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "7d" }
    );

    return res.json({
      message: "Super Admin authenticated successfully.",
      token,
      superAdmin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        forcePasswordChange: admin.forcePasswordChange,
      },
    });
  } catch (error: any) {
    console.error("Super Admin login error:", error);
    return res.status(500).json({ message: "Internal server error during login." });
  }
};

export const getSuperAdminProfile = async (req: SuperAdminRequest, res: Response) => {
  try {
    return res.json({
      superAdmin: req.superAdmin,
    });
  } catch (error: any) {
    console.error("Super Admin profile error:", error);
    return res.status(500).json({ message: "Failed to fetch profile." });
  }
};

export const changeSuperAdminPassword = async (req: SuperAdminRequest, res: Response) => {
  try {
    const adminId = req.superAdmin?.id;
    const { currentPassword, newPassword } = req.body;

    if (!adminId) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required." });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters long." });
    }

    const admin = await prisma.superAdmin.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      return res.status(404).json({ message: "Super Admin not found." });
    }

    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect." });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await prisma.superAdmin.update({
      where: { id: adminId },
      data: {
        password: hashed,
        forcePasswordChange: false,
      },
    });

    return res.json({ message: "Password updated successfully." });
  } catch (error: any) {
    console.error("Change password error:", error);
    return res.status(500).json({ message: "Failed to update password." });
  }
};
