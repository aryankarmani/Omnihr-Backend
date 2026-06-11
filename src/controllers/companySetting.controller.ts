import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getCompanySetting = async (req: Request, res: Response) => {
  try {
    //const user = (req as any).user;
    const tenantId = (req as any).user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant ID required" });
    }

    const setting = await prisma.companySetting.findUnique({
      where: { tenantId },
    });

    res.json(setting);
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to fetch company setting",
      error: error.message,
    });
  }
};

export const uploadAuthorizedSignature = async (req: Request, res: Response) => {
  try {
    //const user = (req as any).user;
    const tenantId = (req as any).user?.tenantId;

    const { authorizedSignName, authorizedSignTitle } = req.body;

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant ID required" });
    }
     if (!authorizedSignName || !authorizedSignTitle) {
      return res.status(400).json({
        message: "Authorized sign name and title are required",
      });
    }


    if (!req.file) {
      return res.status(400).json({ message: "Signature image is required" });
    }

    const setting = await prisma.companySetting.upsert({
      where: { tenantId },
      create: {
        tenantId,
        authorizedSignName,
        authorizedSignTitle,
        authorizedSignImage: req.file.filename,
      },
      update: {
        authorizedSignName,
        authorizedSignTitle,
        authorizedSignImage: req.file.filename,
      },
    });

    res.json({
      message: "Authorized signature uploaded successfully",
      setting,
    });
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to upload signature",
      error: error.message,
    });
  }
};
