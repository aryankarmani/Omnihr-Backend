import { Router } from 'express';
import { login,
        refreshToken,
        register,
        logout,
        sendOtp,
        verifyOtp,
        resetPassword,
 } from '../controllers/auth.controller';

const router = Router();

router.post('/login', login);
// ✅ NEW: Frontend api.ts calls this route
router.post("/refresh-token", refreshToken);

// POST /api/auth/register
router.post("/register", register);


// ✅ NEW: Optional logout route
router.post("/logout", logout);

// ✅ ADDED: Forgot password OTP routes
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/reset-password", resetPassword);

export default router;
