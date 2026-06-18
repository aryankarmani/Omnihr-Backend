import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { firebaseMessaging } from "../config/firebaseAdmin";

const prisma = new PrismaClient();

/**
 * ✅ Save FCM token for logged-in user.
 * Frontend will call this after login.
 */
export const saveFcmToken = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { fcmToken } = req.body;

    if (!user?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!fcmToken) {
      return res.status(400).json({ message: "FCM token is required" });
    }

    await prisma.user.update({
      where: { id: Number(user.id) },
      data: { fcmToken },
    });

    return res.json({ message: "FCM token saved successfully" });
  } catch (error) {
    console.error("Save FCM token error:", error);
    return res.status(500).json({ message: "Failed to save FCM token" });
  }
};

/**
 * ✅ Remove FCM token when user logs out.
 */
export const removeFcmToken = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    if (!user?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await prisma.user.update({
      where: { id: Number(user.id) },
      data: { fcmToken: null },
    });

    return res.json({ message: "FCM token removed successfully" });
  } catch (error) {
    console.error("Remove FCM token error:", error);
    return res.status(500).json({ message: "Failed to remove FCM token" });
  }
};

/**
 * ✅ Reusable function.
 * Use this function in leave, attendance, team, employee controllers.
 */
export const sendPushNotificationToUser = async (
  userId: number,
  title: string,
  body: string
) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    if (!user?.fcmToken) {
      console.log("No FCM token found for user:", userId);
      return;
    }

    await firebaseMessaging.send({
      token: user.fcmToken,
      notification: {
        title,
        body,
      },
      webpush: {
        notification: {
          title,
          body,
          icon: "/logo.png",
        },
      },
    });

    
  } catch (error: any) {
    console.error("Push notification failed:", error.message);
  }
};

/**
 * ✅ Test API.
 * Use this to check push notification after login.
 */
export const testPushNotification = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    if (!user?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await sendPushNotificationToUser(
      Number(user.id),
      "HRMS Test Notification",
      "Push notification is working successfully."
    );

    return res.json({ message: "Test push notification sent" });
  } catch (error) {
    console.error("Test push notification error:", error);
    return res.status(500).json({ message: "Failed to send push notification" });
  }
};