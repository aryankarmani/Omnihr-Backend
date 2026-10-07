import express from "express";
import {
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  addMembers,
  removeMember,
  getMyManagerAccess,
  getTeamAccessControl,
  saveTeamAccessControl,
} from "../controllers/team.controller";

import { authenticate, requirePermission } from "../middleware/auth";

const router = express.Router();

router.use(authenticate);

// ✅ NEW: logged-in manager access API
router.get("/me/manager-access", authenticate, getMyManagerAccess);

router.get("/", authenticate, requirePermission('TEAM_VIEW'), getTeams);
router.post("/", authenticate, requirePermission('TEAM_CREATE'), createTeam);
router.patch("/:teamId", authenticate, requirePermission('TEAM_UPDATE'), updateTeam);
router.delete("/:teamId", authenticate, requirePermission('TEAM_UPDATE'), deleteTeam);

// ✅ NEW: Team Access Control APIs
router.get("/:teamId/access-control", authenticate, getTeamAccessControl);
router.post("/:teamId/access-control", authenticate, requirePermission('TEAM_ACCESS_CONTROL'), saveTeamAccessControl);

router.post("/:teamId/members", authenticate, requirePermission('TEAM_UPDATE'), addMembers);
router.delete("/:teamId/members/:memberId", authenticate, requirePermission('TEAM_UPDATE'), removeMember);

export default router;