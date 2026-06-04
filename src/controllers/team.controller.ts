import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { createNotification, notifyAdmins } from "../utils/notification";

const prisma = new PrismaClient();

type AuthRequest = Request & {
  user?: {
    id: number;
    tenantId: string;
    role?: string;
  };
};

const formatTeam = (team: any) => ({
  id: team.id,
  name: team.name,
  description: team.description,
  managerId: team.managerId,
  manager: team.manager
    ? {
        id: team.manager.id,
        name: team.manager.name,
        email: team.manager.email,
        role: team.manager.role?.name || "Employee",
      }
    : null,
  members: team.members.map((m: any) => ({
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.user.role?.name || "Employee",
  })),
  createdAt: team.createdAt,
  updatedAt: team.updatedAt,
});

export const getTeams = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized: tenantId missing" });
    }

    const teams = await prisma.team.findMany({
      where: { tenantId },
      include: {
        manager: {
          include: { role: true },
        },
        members: {
          include: {
            user: {
              include: { role: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(teams.map(formatTeam));
  } catch (error) {
    console.error("Get teams error:", error);
    return res.status(500).json({ message: "Failed to fetch teams" });
  }
};

export const createTeam = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const { name, description, managerId } = req.body;

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized: tenantId missing" });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Team name is required" });
    }

    const team = await prisma.team.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        tenantId,
        managerId: managerId ? Number(managerId) : null,
      },
      include: {
        manager: {
          include: { role: true },
        },
        members: {
          include: {
            user: {
              include: { role: true },
            },
          },
        },
      },
    });

    
    await notifyAdmins({
      tenantId,
      title: 'New Team Created',
      message: `Team ${team.name} has been created.`,
      type: 'team',
    });

    return res.status(201).json(formatTeam(team));
  } catch (error) {
    console.error("Create team error:", error);
    return res.status(500).json({ message: "Failed to create team" });
  }
};

export const updateTeam = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const teamId = Number(req.params.teamId);
    const { name, description, managerId } = req.body;

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized: tenantId missing" });
    }

    if (Number.isNaN(teamId)) {
      return res.status(400).json({ message: "Invalid team id" });
    }

    const existingTeam = await prisma.team.findFirst({
      where: { id: teamId, tenantId },
    });

    if (!existingTeam) {
      return res.status(404).json({ message: "Team not found" });
    }

    const team = await prisma.team.update({
      where: { id: teamId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && {
          description: description?.trim() || null,
        }),
        ...(managerId !== undefined && {
          managerId: managerId ? Number(managerId) : null,
        }),
      },
      include: {
        manager: {
          include: { role: true },
        },
        members: {
          include: {
            user: {
              include: { role: true },
            },
          },
        },
      },
    });

    return res.json(formatTeam(team));
  } catch (error) {
    console.error("Update team error:", error);
    return res.status(500).json({ message: "Failed to update team" });
  }
};

export const deleteTeam = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const teamId = Number(req.params.teamId);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized: tenantId missing" });
    }

    if (Number.isNaN(teamId)) {
      return res.status(400).json({ message: "Invalid team id" });
    }

    const existingTeam = await prisma.team.findFirst({
      where: { id: teamId, tenantId },
    });

    if (!existingTeam) {
      return res.status(404).json({ message: "Team not found" });
    }

    await prisma.teamMember.deleteMany({
      where: { teamId },
    });

    await prisma.team.delete({
      where: { id: teamId },
    });
    const teamWithMembers = await prisma.team.findFirst({
      where: { id: teamId, tenantId },
      include: {
        members: true,
      },
    });

    if (teamWithMembers) {
      for (const member of teamWithMembers.members) {
        await createNotification({
          tenantId,
          userId: member.userId,
          title: "Team Deleted",
          message: `Team ${existingTeam.name} has been deleted.`,
          type: "team",
        });
      }
    }

    return res.json({ message: "Team deleted successfully" });
  } catch (error) {
    console.error("Delete team error:", error);
    return res.status(500).json({ message: "Failed to delete team" });
  }
};

export const addMembers = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const teamId = Number(req.params.teamId);
    const { members = [], managerId } = req.body;

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized: tenantId missing" });
    }

    if (Number.isNaN(teamId)) {
      return res.status(400).json({ message: "Invalid team id" });
    }

    const team = await prisma.team.findFirst({
      where: { id: teamId, tenantId },
    });

    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    const memberIds = Array.isArray(members)
      ? members.map((id) => Number(id)).filter((id) => !Number.isNaN(id))
      : [];

    await prisma.$transaction(async (tx) => {
      if (managerId) {
        await tx.team.update({
          where: { id: teamId },
          data: { managerId: Number(managerId) },
        });
      }

      for (const userId of memberIds) {
        
        const user = await tx.user.findFirst({
          where: { id: userId, tenantId },
        });

        if (user) {
          await tx.teamMember.upsert({
            where: {
              teamId_userId: {
                teamId,
                userId,
              },
            },
            update: {},
            create: {
              teamId,
              userId,
            },
          });
        }
      }
    });

    const updatedTeam = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        manager: {
          include: { role: true },
        },
        members: {
          include: {
            user: {
              include: { role: true },
            },
          },
        },
      },
    });
    for (const userId of memberIds) {
      await notifyAdmins({
        tenantId,
        
        title: 'Added to Team',
        message: `You have been added to team ${updatedTeam?.name}.`,
        type: 'team',
      });
    }

    if (managerId) {
      await createNotification({
        tenantId,
        userId: Number(managerId),
        title: 'Team Manager Assigned',
        message: `You have been assigned as manager of team ${updatedTeam?.name}.`,
        type: 'team',
      });
    }

    return res.json(formatTeam(updatedTeam));
  } catch (error) {
    console.error("Add members error:", error);
    return res.status(500).json({ message: "Failed to add members" });
  }
};

export const removeMember = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const teamId = Number(req.params.teamId);
    const userId = Number(req.params.memberId);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized: tenantId missing" });
    }

    if (Number.isNaN(teamId) || Number.isNaN(userId)) {
      return res.status(400).json({ message: "Invalid team id or member id" });
    }

    const team = await prisma.team.findFirst({
      where: { id: teamId, tenantId },
    });

    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    await prisma.teamMember.deleteMany({
      where: {
        teamId,
        userId,
      },
    });
    await createNotification({
      tenantId,
      userId,
      title: "Removed from Team",
      message: `You have been removed from team ${team.name}.`,
      type: "team",
    });

    return res.json({ message: "Member removed successfully" });
  } catch (error) {
    console.error("Remove member error:", error);
    return res.status(500).json({ message: "Failed to remove member" });
  }
};