import { Router } from 'express';
import { login,
        refreshToken,
        logout,
 } from '../controllers/auth.controller';

const router = Router();

router.post('/login', login);
// ✅ NEW: Frontend api.ts calls this route
router.post("/refresh-token", refreshToken);

// ✅ NEW: Optional logout route
router.post("/logout", logout);

export default router;
