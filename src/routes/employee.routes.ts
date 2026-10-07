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
import { authenticate, authorize, requirePermission } from '../middleware/auth';
import { upload } from '../middleware/upload';

const router = Router();

router.get('/check-email', authenticate, checkEmployeeEmail);
router.get('/', authenticate, requirePermission('EMPLOYEE_VIEW'), getAllEmployees);
router.post('/', authenticate, requirePermission('EMPLOYEE_CREATE'), upload.any(), createEmployee);

router.get('/me', authenticate, getCurrentEmployee);
router.put('/me', authenticate, updateEmployee);

// Profile Picture Routes
router.put('/me/profile-picture', authenticate, upload.single('profilePicture'), updateProfilePicture);
router.delete('/me/profile-picture', authenticate, deleteProfilePicture);

router.put('/:id/profile-picture', authenticate, upload.single('profilePicture'), updateProfilePicture);
router.delete('/:id/profile-picture', authenticate, deleteProfilePicture);


// UPDATED: HR_ADMIN and SYSTEM_ADMIN can upload employee documents
router.post(
  "/:id/documents",
  authenticate,
  authorize(["HR_ADMIN", "SYSTEM_ADMIN"]),
  upload.single("file"),
  addDocument
);

// UPDATED: HR_ADMIN and SYSTEM_ADMIN can delete employee documents
router.delete(
  "/:id/documents/:docId",
  authenticate,
  authorize(["HR_ADMIN", "SYSTEM_ADMIN"]),
  deleteDocument
);


// Bulk delete route (placed before /:id)
router.post('/bulk-delete', authenticate, requirePermission('EMPLOYEE_DELETE'), bulkDeleteEmployees);

router.get('/:id', authenticate, requirePermission('EMPLOYEE_VIEW'), getEmployee);
router.put('/:id', authenticate, requirePermission('EMPLOYEE_UPDATE'), updateEmployee);
router.delete('/:id', authenticate, requirePermission('EMPLOYEE_DELETE'), deleteEmployee);
export default router;
