import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as MastersController from '../controllers/masters.controller';

const router = Router();

router.use(authenticate);

// Company
router.get('/company', MastersController.getCompany);
router.post('/company', MastersController.updateCompany);

// Locations
router.get('/locations', MastersController.getAll('location'));
router.post('/locations', MastersController.createLocation);
router.put('/locations/:id', MastersController.update('location'));
router.delete('/locations/:id', MastersController.remove('location'));

// Departments
router.get('/departments', MastersController.getAll('department'));
router.post('/departments', MastersController.createDepartment);
router.put('/departments/:id', MastersController.update('department'));
router.delete('/departments/:id', MastersController.remove('department'));

// Designations
router.get('/designations', MastersController.getAll('designation'));
router.post('/designations', MastersController.create('designation'));
router.put('/designations/:id', MastersController.update('designation'));
router.delete('/designations/:id', MastersController.remove('designation'));

// Statutory

// ✅ Salary Components
router.get('/salary-components', MastersController.getSalaryComponents);
router.post('/salary-components', MastersController.createSalaryComponent);
router.put('/salary-components/:id', MastersController.updateSalaryComponent);
router.delete('/salary-components/:id', MastersController.deleteSalaryComponent);

// ✅ Compliance / Statutory Settings
router.get('/statutory-settings', MastersController.getStatutorySettings);
router.post('/statutory-settings', MastersController.updateStatutorySettings);
router.get('/statutory-options', MastersController.getStatutoryOptions);

// ✅ Professional Tax Slabs
router.get('/professional-tax-slabs', MastersController.getProfessionalTaxSlabs);
router.post('/professional-tax-slabs', MastersController.createProfessionalTaxSlab);
router.delete('/professional-tax-slabs/:id', MastersController.deleteProfessionalTaxSlab);



router.get('/bank-masters', MastersController.getAll('bankMaster'));
router.post('/bank-masters', MastersController.create('bankMaster'));

// Attendance
router.get('/shifts', MastersController.getAll('shift'));
router.post('/shifts', MastersController.create('shift'));
router.put('/shifts/:id', MastersController.update('shift'));
router.delete('/shifts/:id', MastersController.remove('shift'));

router.get('/holidays', MastersController.getAll('holiday'));
router.post('/holidays', MastersController.createHoliday);
router.put('/holidays/:id', MastersController.update('holiday'));
router.delete('/holidays/:id', MastersController.remove('holiday'));


// Leave Types (includes policy)
router.get('/leave-types', MastersController.getAll('leaveType'));
router.post('/leave-types', MastersController.create('leaveType'));

// Attendance Policy
router.get('/attendance-policy', MastersController.getAttendancePolicy);
router.post('/attendance-policy', MastersController.updateAttendancePolicy);

// Access Control
router.get('/permissions', MastersController.getPermissions);
router.get('/roles', MastersController.getRoles);
router.post('/roles', MastersController.createRole);
router.put('/roles/:id', MastersController.updateRole);
router.delete('/roles/:id', MastersController.deleteRole); 
// Geo
router.get('/states', MastersController.getStates);
router.get('/cities', MastersController.getCities);

export default router;
