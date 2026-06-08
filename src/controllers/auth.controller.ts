import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt  from "jsonwebtoken";
import crypto from "crypto";
import { sendMail, otpTemplate } from "../utils/mail";

const prisma = new PrismaClient();

const ACCESS_TOKEN_EXPIRES_IN = "24h";
const REFRESH_TOKEN_DAYS = 7;

const createAccessToken = (user: any) => {
     //const secret = process.env.JWT_SECRET || "secret";

  
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roleId: user.roleId,
      role: user.role?.name || "EMPLOYEE",
    },
    process.env.JWT_SECRET || "secret",
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
};

// ✅ Creates random refresh token and stores it in DB
const createRefreshToken = async (user: any) => {
  const token = crypto.randomBytes(64).toString("hex");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_DAYS);

  await prisma.refreshToken.create({
    data: {
      token,
      userId: user.id,
      tenantId: user.tenantId,
      expiresAt,
    },
  });

  return token;
};

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        message: "Name, email, password and role are required",
      });
    }

    const tenant = await prisma.tenant.findFirst({
      where: { domain: "encalm" },
    });

    if (!tenant) {
      return res.status(400).json({ message: "Tenant not found" });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase().trim(),
        tenantId: tenant.id,
      },
    });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    const userRole = await prisma.role.findFirst({
      where: {
        name: role || "EMPLOYEE",
        tenantId: tenant.id,
      },
    });

    if (!userRole) {
      return res.status(400).json({
        message: "Role not found",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        tenantId: tenant.id,
        roleId: userRole.id,
      },
      include: {
        role: true,
        tenant: true,
      },
    });

    const token = createAccessToken(user);

    return res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role?.name || "EMPLOYEE",
        tenantId: user.tenantId,
        tenantName: user.tenant?.name,
        accessibleModules: user.role?.accessibleModules
          ? user.role.accessibleModules.split(",")
          : [],
      },
    });
  } catch (error: any) {
    console.error("Register error:", error);
    return res.status(500).json({
      message: "Server error",
      details: error.message,
    });
  }
};


export const login = async (req: Request, res: Response) => {
  try {
    
    
    const email = req.body.email?.toLowerCase().trim();
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase().trim(),
        isActive: true,
        deletedAt: null,
      },
      include: {
        role: true,
        tenant: true,
      },
    });
    



    if (!user || !user.password) {
      return res.status(401).json({
        message: "Email not found",
      });
    }

   const isPasswordValid =
   await bcrypt.compare(password, user.password);
    

    if (!isPasswordValid) {
      return res.status(401).json({
        message: "Incorrect password",
      });
    }

   

    
    const token = createAccessToken(user);
    const refreshToken = await createRefreshToken(user);

    return res.json({
      message: "Login successful",
      token,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role?.name || "EMPLOYEE",
        tenantId: user.tenantId,
        tenantName: user.tenant?.name,
        accessibleModules: user.role?.accessibleModules
          ? user.role.accessibleModules.split(",")
          : [],
      },
    });
  } catch (error: any) {
    console.error( error);
    return res.status(500).json({
      message: "Server error",
      details: error.message,
    });
  }
};

// ✅ REFRESH TOKEN: frontend calls /api/auth/refresh-token
export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        message: "Refresh token is required",
      });
    }

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        user: {
          include: {
            role: true,
            tenant: true,
          },
        },
      },
    });

    if (!storedToken) {
      return res.status(401).json({
        message: "Invalid refresh token",
      });
    }

    if (storedToken.expiresAt < new Date()) {
      await prisma.refreshToken.delete({
        where: { id: storedToken.id },
      });

      return res.status(401).json({
        message: "Refresh token expired",
      });
    }

    if (!storedToken.user.isActive || storedToken.user.deletedAt) {
      return res.status(401).json({
        message: "User account is inactive",
      });
    }

    const newAccessToken = createAccessToken(storedToken.user);

    return res.json({
      token: newAccessToken,
    });
  } catch (error: any) {
    console.error("Refresh token error:", error);
    return res.status(500).json({
      message: "Server error",
      details: error.message,
    });
  }
};

// ✅ LOGOUT: deletes refresh token from DB
export const logout = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await prisma.refreshToken.deleteMany({
        where: { token: refreshToken },
      });
    }

    return res.json({
      message: "Logged out successfully",
    });
  } catch (error: any) {
    console.error("Logout error:", error);
    return res.status(500).json({
      message: "Server error",
      details: error.message,
    });
  }
};

// ✅ ADDED: Send OTP for forgot password
export const sendOtp = async (req: Request, res: Response) => {
  try {
    const email = req.body.email?.toLowerCase().trim();

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        email,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!user) {
      return res.status(404).json({
        message: "No active user found with this email",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    await prisma.otp.deleteMany({
      where: { email },
    });

    await prisma.otp.create({
      data: {
        email,
        code: otp,
        expiresAt,
      },
    });

    // ✅ CHANGED: Professional OTP email template
    const otpEmail = otpTemplate({ otp });

    await sendMail({
      to: email,
      subject: "Your EnCalm HRMS Password Reset OTP",
      html: otpEmail.html,
      text: otpEmail.text,
    });

    return res.json({
      message: "OTP sent successfully",
    });
  } catch (error: any) {
    console.error("Send OTP error:", error);
    return res.status(500).json({
      message: "Failed to send OTP",
      details: error.message,
    });
  }
};

// ✅ ADDED: Optional OTP verification route
export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const email = req.body.email?.toLowerCase().trim();
    const { otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        message: "Email and OTP are required",
      });
    }

    const record = await prisma.otp.findFirst({
      where: {
        email,
        code: otp,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!record) {
      return res.status(400).json({
        message: "Invalid OTP",
      });
    }

    if (record.expiresAt < new Date()) {
      return res.status(400).json({
        message: "OTP expired",
      });
    }

    return res.json({
      message: "OTP verified successfully",
    });
  } catch (error: any) {
    console.error("Verify OTP error:", error);
    return res.status(500).json({
      message: "Failed to verify OTP",
      details: error.message,
    });
  }
};

// ✅ ADDED: Reset password using OTP
// ✅ CHANGED: matches ForgotPassword.tsx which sends { email, password, otp }
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const email = req.body.email?.toLowerCase().trim();
    const { otp, password } = req.body;

    if (!email || !otp || !password) {
      return res.status(400).json({
        message: "Email, OTP and password are required",
      });
    }

    const record = await prisma.otp.findFirst({
      where: {
        email,
        code: otp,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!record) {
      return res.status(400).json({
        message: "Invalid OTP",
      });
    }

    if (record.expiresAt < new Date()) {
      return res.status(400).json({
        message: "OTP expired",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.updateMany({
      where: {
        email,
        isActive: true,
        deletedAt: null,
      },
      data: {
        password: hashedPassword,
      },
    });

    await prisma.otp.deleteMany({
      where: { email },
    });

    return res.json({
      message: "Password reset successfully",
    });
  } catch (error: any) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      message: "Failed to reset password",
      details: error.message,
    });
  }
};