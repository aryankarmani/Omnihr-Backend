import express from "express";
import {
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  addMembers,
  removeMember,
} from "../controllers/team.controller";

import { authenticate } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticate, getTeams);
router.post("/", authenticate, createTeam);
router.patch("/:teamId", authenticate, updateTeam);
router.delete("/:teamId", authenticate, deleteTeam);

router.post("/:teamId/members", authenticate, addMembers);
router.delete("/:teamId/members/:memberId", authenticate, removeMember);

export default router;