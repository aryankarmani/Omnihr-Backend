import { Router } from 'express';
import { getEmployee, updateEmployee, addDocument, deleteDocument, getAllEmployees, createEmployee, getCurrentEmployee, deleteEmployee } from '../controllers/employee.controller';
import { authenticate } from '../middleware/auth'; // Assuming auth middleware exists
import { upload } from '../middleware/upload';


const router = Router();

router.get('/', authenticate, getAllEmployees);
router.post('/', authenticate, upload.fields([
    { name: 'aadhaar', maxCount: 1 },
    { name: 'pan', maxCount: 1 },
    { name: 'degree', maxCount: 1 }
]), createEmployee);
router.get('/me', authenticate, getCurrentEmployee);
router.get('/:id', authenticate, getEmployee);
router.put('/:id', authenticate, updateEmployee);
router.delete('/:id', authenticate, deleteEmployee);
router.post('/:id/documents', authenticate, upload.single('file'), addDocument);
router.delete('/:id/documents/:docId', authenticate, deleteDocument);

export default router;
