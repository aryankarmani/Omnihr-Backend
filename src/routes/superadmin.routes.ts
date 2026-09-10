import { Router } from "express";
import { authenticateSuperAdmin } from "../middleware/superadmin.auth";
import {
  superAdminLogin,
  getSuperAdminProfile,
  changeSuperAdminPassword,
} from "../controllers/superadmin.auth.controller";
import { getSuperAdminDashboard } from "../controllers/superadmin.dashboard.controller";
import {
  getAllCompanies,
  getCompanyById,
  updateCompanyStatus,
} from "../controllers/superadmin.company.controller";
import {
  getAllPlans,
  createPlan,
  updatePlan,
} from "../controllers/superadmin.plan.controller";
import {
  getAllSubscriptions,
  assignSubscription,
  updateSubscription,
} from "../controllers/superadmin.subscription.controller";
import {
  getAllPayments,
  recordManualPayment,
} from "../controllers/superadmin.payment.controller";
import {
  getNotificationOverview,
  sendManualNotification,
  triggerExpiryCheck,
} from "../controllers/superadmin.notification.controller";

const router = Router();

// ==========================================
// SUPER ADMIN AUTH
// ==========================================
router.post("/auth/login", superAdminLogin);
router.get("/auth/profile", authenticateSuperAdmin, getSuperAdminProfile);
router.post("/auth/change-password", authenticateSuperAdmin, changeSuperAdminPassword);

// ==========================================
// DASHBOARD
// ==========================================
router.get("/dashboard", authenticateSuperAdmin, getSuperAdminDashboard);

// ==========================================
// COMPANIES
// ==========================================
router.get("/companies", authenticateSuperAdmin, getAllCompanies);
router.get("/companies/:id", authenticateSuperAdmin, getCompanyById);
router.put("/companies/:id/status", authenticateSuperAdmin, updateCompanyStatus);

// ==========================================
// PLANS
// ==========================================
router.get("/plans", authenticateSuperAdmin, getAllPlans);
router.post("/plans", authenticateSuperAdmin, createPlan);
router.put("/plans/:id", authenticateSuperAdmin, updatePlan);

// ==========================================
// SUBSCRIPTIONS
// ==========================================
router.get("/subscriptions", authenticateSuperAdmin, getAllSubscriptions);
router.post("/subscriptions", authenticateSuperAdmin, assignSubscription);
router.put("/subscriptions/:id", authenticateSuperAdmin, updateSubscription);

// ==========================================
// PAYMENTS
// ==========================================
router.get("/payments", authenticateSuperAdmin, getAllPayments);
router.post("/payments", authenticateSuperAdmin, recordManualPayment);

// ==========================================
// NOTIFICATIONS
// ==========================================
router.get("/notifications", authenticateSuperAdmin, getNotificationOverview);
router.post("/notifications/send", authenticateSuperAdmin, sendManualNotification);
router.post("/notifications/check", authenticateSuperAdmin, triggerExpiryCheck);

export default router;
