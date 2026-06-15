import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();


const getSignatureUrl = (filename?: string | null) => {
  if (!filename) return null;
   return `/uploads/${filename}`;

};


export const getCompanySetting = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant ID required" });
    }

    const setting = await prisma.companySetting.findUnique({
      where: { tenantId },
    });

    return res.json({
      id: setting?.id || null,
      tenantId,

      authorizedSignName: setting?.authorizedSignName || "",
      authorizedSignTitle: setting?.authorizedSignTitle || "",

      // ✅ OLD database filename
      authorizedSignImage: setting?.authorizedSignImage || null,

      // ✅ NEW frontend-friendly field
      // Your frontend can use this directly.
      authorizedSignature: getSignatureUrl(setting?.authorizedSignImage),
    });
  } catch (error: any) {
    return res.status(500).json({
      message: "Failed to fetch company setting",
      error: error.message,
    });
  }
};

export const uploadAuthorizedSignature = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;

    // ✅ CHANGED: Frontend currently sends only "signature" file.
    // So name/title are optional from backend side.
    const authorizedSignName = req.body.authorizedSignName || "";
    const authorizedSignTitle = req.body.authorizedSignTitle || "";

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant ID required" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Signature image is required" });
    }

    const oldSetting = await prisma.companySetting.findUnique({
      where: { tenantId },
    });

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

    if (
      oldSetting?.authorizedSignImage &&
      oldSetting.authorizedSignImage !== req.file.filename
    ) {
      const oldFilePath = path.join(
        process.cwd(),
        "uploads",
        
        oldSetting.authorizedSignImage
      );

      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }

    return res.json({
      message: "Authorized signature uploaded successfully",
      setting: {
        ...setting,
        authorizedSignImage: setting.authorizedSignImage,
        authorizedSignature: getSignatureUrl(setting.authorizedSignImage),
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      message: "Failed to upload signature",
      error: error.message,
    });
  }
};
/**
 * ✅ DELETE /api/company-setting/authorized-signature
 * Required because your frontend already calls this API.
 */
export const deleteAuthorizedSignature = async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({ message: "Tenant ID required" });
    }

    const setting = await prisma.companySetting.findUnique({
      where: { tenantId },
    });

    if (!setting) {
      return res.status(404).json({ message: "Company setting not found" });
    }

    // ✅ Delete file from uploads folder
    if (setting.authorizedSignImage) {
      const filePath = path.join(
        process.cwd(),
        "uploads",
        
        setting.authorizedSignImage
      );

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // ✅ Keep signatory name/title, only remove image
    const updated = await prisma.companySetting.update({
      where: { tenantId },
      data: {
        authorizedSignImage: null,
      },
    });

    return res.json({
      message: "Authorized signature deleted successfully",
      setting: {
        ...updated,
        authorizedSignature: null,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      message: "Failed to delete signature",
      error: error.message,
    });
  }
};