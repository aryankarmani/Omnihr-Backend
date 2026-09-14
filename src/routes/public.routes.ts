import { Router } from "express";
import { validateApiKey } from "../middleware/apiKeyAuth";
import {
  createOrder,
  verifyAndOnboard,
} from "../controllers/public.onboarding.controller";

const router = Router();

// ==========================================
// PUBLIC LANDING PAGE ENDPOINTS
// All routes protected by API Key (x-api-key header)
// NOT protected by JWT — landing page has no JWT token
// ==========================================

/**
 * POST /api/public/create-order
 * Called by landing page to create a Razorpay order before payment popup.
 * Body: { planId, billingCycle }
 * Returns: { orderId, amount, currency, keyId }
 */
router.post("/create-order", validateApiKey, createOrder);

/**
 * POST /api/public/verify-payment
 * Called by landing page after Razorpay payment success.
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature,
 *         companyName, adminName, email, planId, billingCycle }
 * Returns: { success, domain, email, tempPassword, loginUrl }
 */
router.post("/verify-payment", validateApiKey, verifyAndOnboard);

export default router;
