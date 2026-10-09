import { Router } from 'express';
import {
  getEmployee,
  updateEmployee,
  addDocument,
  deleteDocument,
  getAllEmployees,
  createEmployee,
  getCurrentEmployee,
  deleteEmployee,
  bulkDeleteEmployees,
  updateProfilePicture,
  deleteProfilePicture,
  checkEmployeeEmail
} from '../controllers/employee.controller';
import {
  inviteOnboarding,
  getOnboardingInvites,
  getOnboardingData,
  submitOnboardingProfile,
  deleteOnboardingInvite,
  cancelOnboarding
} from '../controllers/onboarding.controller';
import { authenticate, requirePermission, checkUserHasPermission } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

const authorizeDocumentAccess = async (req: any, res: any, next: any) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  const role = String(user.role || "").toUpperCase();
  if (role === "SUPER_ADMIN" || role === "HR_ADMIN" || role === "ADMIN" || role === "SYSTEM_ADMIN") {
    return next();
  }
  const targetId = Number(req.params.id);
  if (targetId && Number(user.id) === targetId) {
    const canEditSelf = await checkUserHasPermission(user.id, "MY_PROFILE_EDIT");
    if (canEditSelf) {
      return next();
    }
    return res.status(403).json({ message: "You don't have access to edit your profile" });
  }
  const hasUpdatePerm = await checkUserHasPermission(user.id, "EMPLOYEE_UPDATE");
  if (hasUpdatePerm) {
    return next();
  }
  return res.status(403).json({ message: "You don't have access to this" });
};

// Onboarding & Invitation Endpoints
router.post('/invite-onboarding', authenticate, inviteOnboarding);
router.get('/onboarding-invites', authenticate, getOnboardingInvites);
router.delete('/onboarding-invite/:id', authenticate, deleteOnboardingInvite);
router.get('/public-onboarding-data', getOnboardingData);
router.post('/public-onboard', submitOnboardingProfile);
router.post('/public-onboard-cancel', cancelOnboarding);

router.get('/check-email', authenticate, checkEmployeeEmail);
router.get('/', authenticate, getAllEmployees);
router.post('/', authenticate, requirePermission('EMPLOYEE_CREATE'), upload.any(), createEmployee);

router.get('/me', authenticate, getCurrentEmployee);
router.put('/me', authenticate, updateEmployee);

// Profile Picture Routes
router.put('/me/profile-picture', authenticate, upload.single('profilePicture'), updateProfilePicture);
router.delete('/me/profile-picture', authenticate, deleteProfilePicture);

router.put('/:id/profile-picture', authenticate, upload.single('profilePicture'), updateProfilePicture);
router.delete('/:id/profile-picture', authenticate, deleteProfilePicture);

// Document upload & delete routes (Admin, self, or EMPLOYEE_UPDATE)
router.post(
  "/:id/documents",
  authenticate,
  authorizeDocumentAccess,
  upload.single("file"),
  addDocument
);

router.delete(
  "/:id/documents/:docId",
  authenticate,
  authorizeDocumentAccess,
  deleteDocument
);

// Bulk delete route (placed before /:id)
router.post('/bulk-delete', authenticate, requirePermission('EMPLOYEE_DELETE'), bulkDeleteEmployees);

router.get('/:id', authenticate, getEmployee);
router.put('/:id', authenticate, updateEmployee);
router.delete('/:id', authenticate, requirePermission('EMPLOYEE_DELETE'), deleteEmployee);
export default router;
