import { Router } from 'express';
import {
        register,
        login,
        refreshToken,
        logout,
        sendOtp,
        verifyOtp,
        resetPassword,
} from '../controllers/auth.controller';

const router = Router();

// ✅ Register first/new admin
router.post("/register", register);

router.post('/login', login);
// ✅ NEW: Frontend api.ts calls this route
router.post("/refresh-token", refreshToken);



// ✅ NEW: Optional logout route
router.post("/logout", logout);

// ✅ ADDED: Forgot password OTP routes
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/reset-password", resetPassword);

export default router;
