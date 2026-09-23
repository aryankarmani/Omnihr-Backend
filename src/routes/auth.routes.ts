import { Router } from 'express';
import {
        register,
        login,
        refreshToken,
        logout,
        sendOtp,
        verifyOtp,
        resetPassword,
        getMe,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// ✅ Register first/new admin
router.post("/register", register);

router.post('/login', login);
// ✅ NEW: Frontend api.ts calls this route
router.post("/refresh-token", refreshToken);

// ✅ Current user profile & live permissions
router.get("/me", authenticate, getMe);

// ✅ NEW: Optional logout route
router.post("/logout", logout);

// ✅ ADDED: Forgot password OTP routes
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/reset-password", resetPassword);

export default router;
