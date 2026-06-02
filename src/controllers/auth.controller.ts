// import { Request, Response } from 'express';
// import { PrismaClient } from '@prisma/client';

// import jwt from 'jsonwebtoken';

// const prisma = new PrismaClient();

// export const login = async (req: Request, res: Response) => {
//     try {
//         const { email, password } = req.body;

//         // Basic validation
//         if (!email || !password) {
//             return res.status(400).json({ message: 'Email and password are required' });
//         }

//         // Find user
//         // Note: checking globally first, assuming email is unique per login.
//         // If system is strictly multi-tenant with same email allowed across tenants, we'd need tenantId or domain in login.
//         // For this SaaS, we'll assume email is unique globally for simplicity or user selects tenant later.
//         // Based on schema, user is unique on [email, tenantId].
//         // Let's assume for now we allow login if we find ANY match, or assume email is unique enough.
//         // Better approach: Find user by email. If multiple, asking for tenant is needed. 
//         // For this MVP, let's just findFirst.
//         const user = await prisma.user.findFirst({
//             where: { email },
//             include: { role: true, tenant: true }
//         });

//         if (!user) {
//             return res.status(401).json({ message: 'Invalid credentials' });
//         }

//         // Password check (TODO: Add hashing in production)
//         if (user.password !== password) {
//             return res.status(401).json({ message: 'Invalid credentials' });
//         }

//         // Generate Token
//         const token = jwt.sign(
//             {
//                 id: user.id,
//                 email: user.email,
//                 tenantId: user.tenantId,
//                 roleId: user.roleId,
//                 role: user.role?.name || 'EMPLOYEE'
//             },
//             process.env.JWT_SECRET || 'secret',
//             { expiresIn: '24h' }
//         );

//         // Return user info and token
//         res.json({
//             token,
//             user: {
//                 id: user.id,
//                 name: user.name,
//                 email: user.email,
//                 role: user.role?.name || 'EMPLOYEE',
//                 tenantId: user.tenantId,
//                 tenantName: user.tenant.name,
//                 accessibleModules: user.role?.accessibleModules ? user.role.accessibleModules.split(',') : []
//             }
//         });

//     } catch (error: any) {
//         console.error('Login error:', error);
//         res.status(500).json({ message: 'Server error', details: error.message, stack: error.stack });
//     }
// };
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt  from "jsonwebtoken";

const prisma = new PrismaClient();

const createToken = (user: any) => {
     const secret = process.env.JWT_SECRET || "secret";

  
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roleId: user.roleId,
      role: user.role?.name || "EMPLOYEE",
    },
    secret,
    { expiresIn:  "24hrs",
        
     }
  );
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

    const token = createToken(user);

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
    
    console.log("REQ BODY:", req.body);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase().trim(),
      },
      include: {
        role: true,
        tenant: true,
      },
    });
    console.log("LOGIN EMAIL:", email);
console.log("USER FOUND:", user);
console.log("DB PASSWORD:", user?.password);

    if (!user || !user.password) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

   const isPasswordValid =
  user.password.startsWith("$2a$") || user.password.startsWith("$2b$")
    ? await bcrypt.compare(password, user.password)
    : password === user.password;

    if (!isPasswordValid) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = createToken(user);

    return res.json({
      message: "Login successful",
      token,
      tenantId: user.tenantId,
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
    console.error("Login error:", error);
    return res.status(500).json({
      message: "Server error",
      details: error.message,
    });
  }
};