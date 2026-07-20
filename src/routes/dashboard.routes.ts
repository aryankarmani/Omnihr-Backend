import { Router } from 'express';
import { getStats, getLiveAttendance, getPendingApprovals, getEmployeeOverview } from '../controllers/dashboard.controller';


import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/stats', getStats);
router.get('/live-attendance', getLiveAttendance);
router.get('/pending-approvals', getPendingApprovals);
router.get('/employee-overview', getEmployeeOverview);

export default router;
