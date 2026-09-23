import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface SuperAdminRequest extends Request {
  superAdmin?: {
    id: string;
    email: string;
    name: string;
    role: string;
    forcePasswordChange: boolean;
  };
}

export const authenticateSuperAdmin = async (
  req: SuperAdminRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Super Admin access denied. No authentication token provided.",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "secret"
    ) as any;

    if (!decoded || (decoded.role !== "SUPER_ADMIN" && decoded.type !== "SUPER_ADMIN")) {
      return res.status(403).json({
        message: "Forbidden. This endpoint is strictly restricted to Super Administrators.",
      });
    }

    // Look up in SuperAdmin table by id or email
    let admin: any = null;
    if (typeof decoded.id === "string") {
      admin = await prisma.superAdmin.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          forcePasswordChange: true,
        },
      });
    }

    if (!admin && decoded.email) {
      admin = await prisma.superAdmin.findUnique({
        where: { email: decoded.email.toLowerCase().trim() },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          forcePasswordChange: true,
        },
      });
    }

    // Fallback if user is in User table with SUPER_ADMIN role
    if (!admin && decoded.role === "SUPER_ADMIN" && decoded.id) {
      const dbUser = await prisma.user.findFirst({
        where: { id: Number(decoded.id), isActive: true, deletedAt: null },
        include: { role: true },
      });

      if (dbUser && dbUser.role?.name === "SUPER_ADMIN") {
        admin = {
          id: String(dbUser.id),
          email: dbUser.email,
          name: dbUser.name,
          role: "SUPER_ADMIN",
          isActive: true,
          forcePasswordChange: false,
        };
      }
    }

    if (!admin || !admin.isActive) {
      return res.status(403).json({
        message: "Super Admin account is deactivated or not found.",
      });
    }

    req.superAdmin = admin;
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired Super Admin token.",
    });
  }
};
