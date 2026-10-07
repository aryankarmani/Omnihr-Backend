import { Router } from 'express';
import { getLeaveBalances, getLeaveHistory, applyLeave, updateLeaveStatus } from '../controllers/leave.controller';
import { authenticate, requirePermission } from '../middleware/auth';

const router = Router();

router.get("/test", (req, res) => {
  res.json({ message: "Leave routes working ✅" });
});

router.use(authenticate);

router.get('/balances', requirePermission('LEAVE_VIEW'), getLeaveBalances);
router.get('/history', requirePermission('LEAVE_VIEW'), getLeaveHistory);
router.post('/apply', requirePermission('LEAVE_APPLY'), applyLeave);
router.post("/", requirePermission('LEAVE_APPLY'), applyLeave);
router.put('/:id/status', (req, res, next) => {
  const status = req.body?.status;
  if (status === 'REJECTED') {
    return requirePermission('LEAVE_REJECT')(req as any, res, next);
  }
  return requirePermission('LEAVE_APPROVE')(req as any, res, next);
}, updateLeaveStatus);

export default router;
