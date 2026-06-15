import express from "express";
//import multer from "multer";
import {
  uploadAuthorizedSignature,
  getCompanySetting,
  deleteAuthorizedSignature,
} from "../controllers/companySetting.controller";
import { authenticate, authorize } from "../middleware/auth";
import { upload } from "../middleware/upload";

const router = express.Router();

// const upload = multer({
//   dest: "uploads/signatures",
// });

router.get("/", authenticate, getCompanySetting);

router.post(
  "/authorized-signature",
  authenticate,
  authorize(["HR_ADMIN", "SYSTEM_ADMIN"]),
  upload.single("signature"),
  uploadAuthorizedSignature
);

router.delete(
  "/authorized-signature",
  authenticate,
  authorize(["HR_ADMIN", "SYSTEM_ADMIN"]),
  deleteAuthorizedSignature
);

export default router;