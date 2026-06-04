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

import { authenticate } from "../middleware/auth";

const router = express.Router();

router.use(authenticate);

// ✅ NEW: logged-in manager access API
router.get("/me/manager-access", authenticate, getMyManagerAccess);

router.get("/", authenticate, getTeams);
router.post("/", authenticate, createTeam);
router.patch("/:teamId", authenticate, updateTeam);
router.delete("/:teamId", authenticate, deleteTeam);



// ✅ NEW: Team Access Control APIs
router.get("/:teamId/access-control", authenticate, getTeamAccessControl);
router.post("/:teamId/access-control", authenticate, saveTeamAccessControl);

router.post("/:teamId/members", authenticate, addMembers);
router.delete("/:teamId/members/:memberId", authenticate, removeMember);

export default router;