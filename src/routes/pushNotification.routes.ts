import express from "express";
import {
  saveFcmToken,
   removeFcmToken,
  testPushNotification,
} from "../controllers/pushNotification.controller";
import { authenticate } from "../middleware/auth";

const router = express.Router();

// ✅ All push routes need login token
router.use(authenticate);

// ✅ Save browser FCM token
router.post("/save-token", saveFcmToken);

// ✅ Remove token on logout
router.delete("/remove-token", removeFcmToken);

// ✅ Test push notification
router.post("/test", testPushNotification);

export default router;