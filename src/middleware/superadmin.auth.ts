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

    // Strict validation: Must have role 'SUPER_ADMIN' and token type 'SUPER_ADMIN'
    if (!decoded || decoded.role !== "SUPER_ADMIN" || decoded.type !== "SUPER_ADMIN") {
      return res.status(403).json({
        message: "Forbidden. This endpoint is strictly restricted to Super Administrators.",
      });
    }

    // Verify admin exists and is active in database
    const admin = await prisma.superAdmin.findUnique({
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
