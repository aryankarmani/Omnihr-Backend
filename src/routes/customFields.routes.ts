import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import {
    getCustomFields,
    createCustomField,
    deleteCustomField,
    getEmployeeCustomFields,
    updateEmployeeCustomFields,
    uploadCustomFieldDocument,
    deleteCustomFieldDocument
} from '../controllers/customFields.controller';

const router = Router();

router.use(authenticate);

// Masters config endpoints
router.get('/masters', getCustomFields);
router.post('/masters', createCustomField);
router.delete('/masters/:id', deleteCustomField);

// Employee specific endpoints
router.get('/employee/:id', getEmployeeCustomFields);
router.put('/employee/:id', updateEmployeeCustomFields);
router.post('/employee/:id/field/:fieldId/upload', upload.single('file'), uploadCustomFieldDocument);
router.delete('/employee/:id/field/:fieldId/document', deleteCustomFieldDocument);

export default router;
