import { Router } from 'express';
import {
    getPunchStatus,
    punchToggle,
    getAttendanceHistory,
    getAttendanceStats,
    applyRegularization,
    getMyRegularizationRequests,
    getPendingRegularizations,
    approveRegularization,
    rejectRegularization,
    forceRegularizeAttendance,
     } from '../controllers/attendance.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/status', getPunchStatus);
router.post('/punch', punchToggle);
router.get('/history', getAttendanceHistory);
router.get('/stats', getAttendanceStats);

// UPDATED: Employee regularization routes
router.post('/regularize', applyRegularization);
router.get('/regularize/my-requests', getMyRegularizationRequests);

// UPDATED: Admin regularization routes
router.get('/regularize/pending', getPendingRegularizations);
router.put('/regularize/:id/approve', approveRegularization);
router.put('/regularize/:id/reject', rejectRegularization);

// UPDATED: Admin direct override / force regularize
router.post('/regularize/bypass', forceRegularizeAttendance);

export default router;
