import express from "express";
import multer from "multer";
import {
  uploadAuthorizedSignature,
  getCompanySetting,
} from "../controllers/companySetting.controller";
import { authenticate } from "../middleware/auth";

const router = express.Router();

const upload = multer({
  dest: "uploads/signatures",
});

router.get("/", authenticate, getCompanySetting);

router.post(
  "/authorized-signature",
  authenticate,
  upload.single("signature"),
  uploadAuthorizedSignature
);

export default router;