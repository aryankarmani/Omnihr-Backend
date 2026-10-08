import { Router } from 'express';
import {
    getPunchStatus,
    punchToggle,
    breakIn,
    breakOut,
    getAttendanceHistory,
    getAttendanceStats,
    applyRegularization,
    getMyRegularizationRequests,
    getPendingRegularizations,
    approveRegularization,
    rejectRegularization,
    forceRegularizeAttendance,
     } from '../controllers/attendance.controller';
import { authenticate, requirePermission } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/status', getPunchStatus);
router.post('/punch', punchToggle);
router.post('/break/in', breakIn);
router.post('/break/out', breakOut);
router.get('/history', getAttendanceHistory);
router.get('/stats', getAttendanceStats);

// UPDATED: Employee regularization routes
router.post('/regularize', requirePermission('ATTENDANCE_REGULARIZE'), applyRegularization);
router.get('/regularize/my-requests', getMyRegularizationRequests);

// UPDATED: Admin regularization routes
router.get('/regularize/pending', requirePermission(['ATTENDANCE_APPROVE', 'ATTENDANCE_REJECT']), getPendingRegularizations);
router.put('/regularize/:id/approve', requirePermission('ATTENDANCE_APPROVE'), approveRegularization);
router.put('/regularize/:id/reject', requirePermission('ATTENDANCE_REJECT'), rejectRegularization);

// UPDATED: Admin direct override / force regularize
router.post('/regularize/bypass', requirePermission('EMPLOYEE_ATTENDANCE_MANAGE'), forceRegularizeAttendance);

export default router;
