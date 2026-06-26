import { Router } from 'express';
import { getEmployee, updateEmployee, addDocument, deleteDocument, getAllEmployees, createEmployee, getCurrentEmployee, deleteEmployee } from '../controllers/employee.controller';
import { authenticate, authorize } from '../middleware/auth'; // Assuming auth middleware exists
import { upload } from '../middleware/upload';


const router = Router();

router.get('/', authenticate, getAllEmployees);
router.post('/', authenticate, upload.any(), createEmployee);

router.get('/me', authenticate, getCurrentEmployee);
router.put('/me', authenticate, updateEmployee);


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


router.get('/:id', authenticate, getEmployee);
router.put('/:id', authenticate, updateEmployee);
router.delete('/:id', authenticate, deleteEmployee);
export default router;
