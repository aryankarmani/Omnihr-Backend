import { Router } from 'express';
import { getEmployee, updateEmployee, addDocument, deleteDocument, getAllEmployees, createEmployee, getCurrentEmployee, deleteEmployee } from '../controllers/employee.controller';
import { authenticate } from '../middleware/auth'; // Assuming auth middleware exists

const router = Router();

router.get('/', authenticate, getAllEmployees);
router.post('/', authenticate, createEmployee);
router.get('/me', authenticate, getCurrentEmployee);
router.get('/:id', authenticate, getEmployee);
router.put('/:id', authenticate, updateEmployee);
router.delete('/:id', authenticate, deleteEmployee);
router.post('/:id/documents', authenticate, addDocument);
router.delete('/:id/documents/:docId', authenticate, deleteDocument);

export default router;
