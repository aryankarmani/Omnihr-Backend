import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import * as MastersController from '../controllers/masters.controller';

const router = Router();

router.use(authenticate);

// Company
router.get('/company', requirePermission('MASTERS_VIEW'), MastersController.getCompany);
router.post('/company', requirePermission('MASTERS_MANAGE'), MastersController.updateCompany);

// Locations
router.get('/locations', requirePermission('MASTERS_VIEW'), MastersController.getAll('location'));
router.post('/locations', requirePermission('MASTERS_MANAGE'), MastersController.createLocation);
router.put('/locations/:id', requirePermission('MASTERS_MANAGE'), MastersController.updateLocation);
router.delete('/locations/:id', requirePermission('MASTERS_MANAGE'), MastersController.remove('location'));

// Departments
router.get('/departments', requirePermission('MASTERS_VIEW'), MastersController.getAll('department'));
router.post('/departments', requirePermission('MASTERS_MANAGE'), MastersController.createDepartment);
router.put('/departments/:id', requirePermission('MASTERS_MANAGE'), MastersController.update('department'));
router.delete('/departments/:id', requirePermission('MASTERS_MANAGE'), MastersController.remove('department'));

// Designations
router.get('/designations', requirePermission('MASTERS_VIEW'), MastersController.getAll('designation'));
router.post('/designations', requirePermission('MASTERS_MANAGE'), MastersController.create('designation'));
router.put('/designations/:id', requirePermission('MASTERS_MANAGE'), MastersController.update('designation'));
router.delete('/designations/:id', requirePermission('MASTERS_MANAGE'), MastersController.remove('designation'));

// Statutory

// ✅ Salary Components
router.get('/salary-components', requirePermission('MASTERS_VIEW'), MastersController.getSalaryComponents);
router.post('/salary-components', requirePermission('MASTERS_MANAGE'), MastersController.createSalaryComponent);
router.put('/salary-components/:id', requirePermission('MASTERS_MANAGE'), MastersController.updateSalaryComponent);
router.delete('/salary-components/:id', requirePermission('MASTERS_MANAGE'), MastersController.deleteSalaryComponent);

// ✅ Compliance / Statutory Settings
router.get('/statutory-settings', requirePermission('MASTERS_VIEW'), MastersController.getStatutorySettings);
router.post('/statutory-settings', requirePermission('MASTERS_MANAGE'), MastersController.updateStatutorySettings);
router.get('/statutory-options', requirePermission('MASTERS_VIEW'), MastersController.getStatutoryOptions);

// ✅ Professional Tax Slabs
router.get('/professional-tax-slabs', requirePermission('MASTERS_VIEW'), MastersController.getProfessionalTaxSlabs);
router.post('/professional-tax-slabs', requirePermission('MASTERS_MANAGE'), MastersController.createProfessionalTaxSlab);
router.delete('/professional-tax-slabs/:id', requirePermission('MASTERS_MANAGE'), MastersController.deleteProfessionalTaxSlab);



router.get('/bank-masters', requirePermission('MASTERS_VIEW'), MastersController.getAll('bankMaster'));
router.post('/bank-masters', requirePermission('MASTERS_MANAGE'), MastersController.create('bankMaster'));

// Attendance
router.get('/shifts', requirePermission('MASTERS_VIEW'), MastersController.getAll('shift'));
router.post('/shifts', requirePermission('MASTERS_MANAGE'), MastersController.create('shift'));
router.put('/shifts/:id', requirePermission('MASTERS_MANAGE'), MastersController.update('shift'));
router.delete('/shifts/:id', requirePermission('MASTERS_MANAGE'), MastersController.remove('shift'));

router.get('/holidays', MastersController.getAll('holiday'));
router.post('/holidays', requirePermission('MASTERS_MANAGE'), MastersController.createHoliday);
router.put('/holidays/:id', requirePermission('MASTERS_MANAGE'), MastersController.update('holiday'));
router.delete('/holidays/:id', requirePermission('MASTERS_MANAGE'), MastersController.remove('holiday'));


// Leave Types (includes policy)
router.get('/leave-types', MastersController.getAll('leaveType'));
router.post('/leave-types', requirePermission('MASTERS_MANAGE'), MastersController.create('leaveType'));

// Attendance Policy
router.get('/attendance-policy', MastersController.getAttendancePolicy);
router.post('/attendance-policy', requirePermission('MASTERS_MANAGE'), MastersController.updateAttendancePolicy);

// Access Control
router.get('/permissions', MastersController.getPermissions);
router.get('/roles', MastersController.getRoles);
router.post('/roles', requirePermission('MASTERS_MANAGE'), MastersController.createRole);
router.put('/roles/:id', requirePermission('MASTERS_MANAGE'), MastersController.updateRole);
router.delete('/roles/:id', requirePermission('MASTERS_MANAGE'), MastersController.deleteRole); 
// Geo
router.get('/states', MastersController.getStates);
router.get('/cities', MastersController.getCities);

export default router;
