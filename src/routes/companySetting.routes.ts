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
router.put(
  "/signature",
  authenticate,
  authorize(["HR_ADMIN", "SYSTEM_ADMIN"]),
  upload.single("signature"), // ✅ same field name
  uploadAuthorizedSignature
);

/**
 * ✅ OLD delete route support
 */
router.delete(
  "/authorized-signature",
  authenticate,
  authorize(["HR_ADMIN", "SYSTEM_ADMIN"]),
  deleteAuthorizedSignature
);

/**
 * ✅ NEW delete route support:
 * Frontend calls this route, so this fixes your 404.
 */
router.delete(
  "/signature",
  authenticate,
  authorize(["HR_ADMIN", "SYSTEM_ADMIN"]),
  deleteAuthorizedSignature
);

export default router;