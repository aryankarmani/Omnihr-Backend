import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { createNotification, notifyAdmins } from "../utils/notification";
import { createAuditLog } from "../utils/auditLog";

const prisma = new PrismaClient();

type AuthRequest = Request & {
  user?: {
    id: number;
    email?: string;
    tenantId: string;
    roleId?: number;
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
  accessControl: team.accessControl || null,
  createdAt: team.createdAt,
  updatedAt: team.updatedAt,
});

// ✅ NEW: validate user belongs to same tenant
const validateUserInTenant = async (
  tx: any,
  tenantId: string,
  userId: number
) => {
  const user = await tx.user.findFirst({
    where: {
      id: userId,
      tenantId,
      isActive: true,
      deletedAt: null,
    },
  });

  return user;
};

// // ✅ HELPER: Find/Create role
// const getOrCreateRole = async (tx: any, tenantId: string, roleName: string) => {
//   let role = await tx.role.findFirst({
//     where: {
//       tenantId,
//       name: roleName,
//     },
//   });

//   if (!role) {
//     role = await tx.role.create({
//       data: {
//         tenantId,
//         name: roleName,
//         accessibleModules:

//              "DASHBOARD,ATTENDANCE,LEAVE,MY_PROFILE",
//       },
//     });
//   }

//   return role;
// };

// // ✅ HELPER: If user is not manager of any team, change role back to EMPLOYEE
// const downgradeManagerIfNoTeam = async (
//   tx: any,
//   tenantId: string,
//   userId: number
// ) => {
//   const managedTeamCount = await tx.team.count({
//     where: {
//       tenantId,
//       managerId: userId,
//     },
//   });

//   if (managedTeamCount === 0) {
//     const employeeRole = await getOrCreateRole(tx, tenantId, "EMPLOYEE");

//     await tx.user.update({
//       where: { id: userId },
//       data: {
//         roleId: employeeRole.id,
//       },
//     });
//   }
// };

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
        accessControl: true,
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

    // const team = await prisma.team.create({
    //   data: {
    //     name: name.trim(),
    //     description: description?.trim() || null,
    //     tenantId,
    //     managerId: managerId ? Number(managerId) : null,
    //   },
    //   include: {
    //     manager: {
    //       include: { role: true },
    //     },
    //     members: {
    //       include: {
    //         user: {
    //           include: { role: true },
    //         },
    //       },
    //     },
    //   },
    // });
    const team = await prisma.$transaction(async (tx) => {
      const finalManagerId =
        managerId !== undefined && managerId !== null && managerId !== ""
          ? Number(managerId)
          : null;
      if (finalManagerId && Number.isNaN(finalManagerId)) {
        throw new Error("Invalid manager id");
      }

      if (finalManagerId) {
        const manager = await validateUserInTenant(tx, tenantId, finalManagerId);


        if (!manager) {
          throw new Error("Manager not found in this tenant");
        }
      }

      //   await tx.user.update({
      //     where: { id: finalManagerId },
      //     data: { roleId: managerRole.id },
      //   });
      // }

      const createdTeam = await tx.team.create({
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          tenantId,
          managerId: finalManagerId,

          accessControl: {
            create: {
              list: true,
              attendance: true,
              leaveApproval: true,
              regularization: true,
            },
          },
        },
      });

      // ✅ UPDATED: Manager is also added as team member automatically
      if (finalManagerId) {
        await tx.teamMember.upsert({
          where: {
            teamId_userId: {
              teamId: createdTeam.id,
              userId: finalManagerId,
            },
          },
          update: {},
          create: {
            teamId: createdTeam.id,
            userId: finalManagerId,
          },
        });
      }

      return createdTeam;
    });

    const fullTeam = await prisma.team.findUnique({
      where: { id: team.id },
      include: {
        manager: { include: { role: true } },
        members: { include: { user: { include: { role: true } } } },
        accessControl: true,
      },
    });

    try {
      await notifyAdmins({
        tenantId,
        title: 'New Team Created',
        message: `Team ${team.name} has been created.`,
        type: 'team',
      });
    }
    catch (notifyError) {
      console.log("Notification failed but team created:", notifyError);
    }
    await createAuditLog({
      tenantId,
      module: "Team",
      action: "Created",
      description: `Team ${team.name} was created.`,
      performedById: req.user?.id,
      performedBy: req.user?.email || "Admin",
      performedByRole: req.user?.role,
      targetUserId: fullTeam?.managerId || undefined,
      targetUser: fullTeam?.manager?.name || team.name,
      targetUserRole: fullTeam?.manager?.role?.name || "Team",
    });

    return res.status(201).json(formatTeam(fullTeam));
  } catch (error: any) {
    console.error("Create team error:", error);
    return res.status(500).json({
      message: "Failed to create team",
      details: error.message,
    });
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

    await prisma.$transaction(async (tx) => {
      // const oldManagerId = existingTeam.managerId;
      const newManagerId =
        managerId !== undefined && managerId !== null && managerId !== ""
          ? Number(managerId)
          : null;

      // ✅ UPDATED: If manager changed, old manager becomes EMPLOYEE if not managing any other team
      if (managerId !== undefined && newManagerId && Number.isNaN(newManagerId)) {
        throw new Error("Invalid manager id");
      }



      // ✅ UPDATED: New manager becomes MANAGER
      if (managerId !== undefined && newManagerId) {
        const manager = await validateUserInTenant(tx, tenantId, newManagerId);

        if (!manager) {
          throw new Error("Manager not found in this tenant");
        }

        // await tx.user.update({
        //   where: { id: newManagerId },
        //   data: { roleId: managerRole.id },
        // });

        await tx.teamMember.upsert({
          where: {
            teamId_userId: {
              teamId,
              userId: newManagerId,
            },
          },
          update: {},
          create: {
            teamId,
            userId: newManagerId,
          },
        });
      }

      await tx.team.update({
        where: { id: teamId },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && {
            description: description?.trim() || null,
          }),
          ...(managerId !== undefined && { managerId: newManagerId }),
        },
      });
    });

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        manager: { include: { role: true } },
        members: { include: { user: { include: { role: true } } } },
        accessControl: true,
      },
    });
    await createAuditLog({
      tenantId,
      module: "Team",
      action: "Updated",
      description: `Team ${team?.name || existingTeam.name} was updated.`,
      performedById: req.user?.id,
      performedBy: req.user?.email || "Admin",
      performedByRole: req.user?.role,
      targetUserId: team?.managerId || undefined,
      targetUser: team?.name || existingTeam.name,
      targetUserRole: "Team",
    });

    return res.json(formatTeam(team));
  } catch (error: any) {
    console.error("Update team error:", error);
    return res.status(500).json({
      message: "Failed to update team",
      details: error.message,
    });

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
      include: { members: true },

    });

    if (!existingTeam) {
      return res.status(404).json({ message: "Team not found" });
    }



    // const oldManagerId = existingTeam.managerId;
    const memberIds = existingTeam.members.map((m) => m.userId);

    await prisma.$transaction(async (tx) => {
      // ✅ Delete access control first
      await tx.teamAccessControl.deleteMany({
        where: { teamId },
      });

      await tx.teamMember.deleteMany({
        where: { teamId },
      });

      await tx.team.delete({
        where: { id: teamId },
      });
    });

    // const teamWithMembers = await prisma.team.findFirst({
    //   where: { id: teamId, tenantId },
    //   include: {
    //     members: true,
    //   },
    // });

    // ✅ UPDATED: If deleted team manager manages no other team, change back to EMPLOYEE
    //   if (oldManagerId) {
    //     await downgradeManagerIfNoTeam(tx, tenantId, oldManagerId);
    //   }
    // });

    try {
      for (const userId of memberIds) {
        await createNotification({
          tenantId,
          userId,
          title: "Team Deleted",
          message: `Team ${existingTeam.name} has been deleted.`,
          type: "team",
        });
      }
    } catch (notifyError) {
      console.log("Notification failed but team deleted:", notifyError);
    }

    await createAuditLog({
      tenantId,
      module: "Team",
      action: "Deleted",
      description: `Team ${existingTeam.name} was deleted.`,
      performedById: req.user?.id,
      performedBy: req.user?.email || "Admin",
      performedByRole: req.user?.role,
      targetUser: existingTeam.name,
      targetUserRole: "Team",
    });


    return res.json({ message: "Team deleted successfully" });
  } catch (error: any) {
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
      // const oldManagerId = team.managerId;
      const newManagerId =
        managerId !== undefined && managerId !== null && managerId !== ""
          ? Number(managerId)
          : null;

      // ✅ UPDATED: If previous manager changed/removed, make old manager EMPLOYEE if not managing other team
      if (managerId !== undefined && newManagerId && Number.isNaN(newManagerId)) {
        throw new Error("Invalid manager id");
      }

      // ✅ UPDATED: Assign new manager and change role to MANAGER
      if (managerId !== undefined) {
        if (newManagerId) {
          const manager = await validateUserInTenant(tx, tenantId, newManagerId);

          if (!manager) {
            throw new Error("Manager not found in this tenant");
          }

          await tx.team.update({
            where: { id: teamId },
            data: { managerId: newManagerId },
          });

          // await tx.user.update({
          //   where: { id: newManagerId },
          //   data: { roleId: managerRole.id },
          // });

          // ✅ Manager should also be a team member
          await tx.teamMember.upsert({
            where: {
              teamId_userId: {
                teamId,
                userId: newManagerId,
              },
            },
            update: {},
            create: {
              teamId,
              userId: newManagerId,
            },
          });
        } else {
          await tx.team.update({
            where: { id: teamId },
            data: { managerId: newManagerId },
          });
        }
      }

      // ✅ UPDATED: Add selected members
      for (const userId of memberIds) {
        const user = await validateUserInTenant(tx, tenantId, userId);

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
        accessControl: true,
      },
    });
    try {
      for (const userId of memberIds) {
        await createNotification({
          tenantId,
          userId,
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
    }
    catch (notifyError) {
      console.log("Notification failed but members updated:", notifyError);
    }

    await createAuditLog({
      tenantId,
      module: "Team",
      action: "Updated",
      description: `${memberIds.length} member(s) were added to team ${updatedTeam?.name}.`,
      performedById: req.user?.id,
      performedBy: req.user?.email || "Admin",
      performedByRole: req.user?.role,
      targetUser: updatedTeam?.name || "Team",
      targetUserRole: "Team",
    });

    return res.json(formatTeam(updatedTeam));
  } catch (error: any) {
    console.error("Add members error:", error);
    return res.status(500).json({
      message: "Failed to add members",
      details: error.message,
    });
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

    await prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({
        where: {
          teamId,
          userId,
        },
      });

      // ✅ UPDATED: If removed user was manager, remove managerId and downgrade role
      if (team.managerId === userId) {
        await tx.team.update({
          where: { id: teamId },
          data: { managerId: null },
        });

        // await downgradeManagerIfNoTeam(tx, tenantId, userId);
      }
    });

    try {
      await createNotification({
        tenantId,
        userId,
        title: "Removed from Team",
        message: `You have been removed from team ${team.name}.`,
        type: "team",
      });
    } catch (notifyError) {
      console.log("Notification failed but member removed:", notifyError);
    }

    await createAuditLog({
      tenantId,
      module: "Team",
      action: "Updated",
      description: `A member was removed from team ${team.name}.`,
      performedById: req.user?.id,
      performedBy: req.user?.email || "Admin",
      performedByRole: req.user?.role,
      targetUserId: userId,
      targetUser: `User ${userId}`,
      targetUserRole: "EMPLOYEE",
    });

    return res.json({ message: "Member removed successfully" });
  } catch (error) {
    console.error("Remove member error:", error);
    return res.status(500).json({ message: "Failed to remove member" });
  }
};

// ✅ NEW: GET /teams/:teamId/access-control
export const getTeamAccessControl = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const teamId = Number(req.params.teamId);

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

    const access = await prisma.teamAccessControl.findUnique({
      where: { teamId },
    });

    // ✅ Default permissions if not saved yet
    if (!access) {
      return res.json({
        list: true,
        attendance: true,
        leaveApproval: true,
        regularization: true,
      });
    }

    return res.json({
      list: access.list,
      attendance: access.attendance,
      leaveApproval: access.leaveApproval,
      regularization: access.regularization,
    });
  } catch (error) {
    console.error("Get team access control error:", error);
    return res.status(500).json({ message: "Failed to fetch team access control" });
  }
};

// ✅ NEW: POST /teams/:teamId/access-control
export const saveTeamAccessControl = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const role = req.user?.role;
    const teamId = Number(req.params.teamId);

    const {
      list = true,
      attendance = true,
      leaveApproval = true,
      regularization = true,
    } = req.body;

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized: tenantId missing" });
    }

    // ✅ Only HR/Admin can update access control
    if (!["HR_ADMIN", "ADMIN", "SYSTEM_ADMIN"].includes(role || "")) {
      return res.status(403).json({ message: "Only admin can update access control" });
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

    const access = await prisma.teamAccessControl.upsert({
      where: { teamId },
      update: {
        list: Boolean(list),
        attendance: Boolean(attendance),
        leaveApproval: Boolean(leaveApproval),
        regularization: Boolean(regularization),
      },
      create: {
        teamId,
        list: Boolean(list),
        attendance: Boolean(attendance),
        leaveApproval: Boolean(leaveApproval),
        regularization: Boolean(regularization),
      },
    });

    return res.json({
      message: "Team access control saved successfully",
      data: access,
    });
  } catch (error) {
    console.error("Save team access control error:", error);
    return res.status(500).json({ message: "Failed to save team access control" });
  }
};

// ✅ NEW: This tells frontend whether logged-in user is a team manager
// and what tabs are allowed from TeamAccessControl.
export const getMyManagerAccess = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;

    if (!tenantId || !userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const managedTeams = await prisma.team.findMany({
      where: {
        tenantId,
        managerId: userId,
      },
      include: {
        accessControl: true,
      },
    });

    const isTeamManager = managedTeams.length > 0;

    // ✅ Merge permissions from all teams this user manages
    const access = managedTeams.reduce(
      (acc, team) => {
        const control = team.accessControl;

        return {
          list: acc.list || control?.list || false,
          attendance: acc.attendance || control?.attendance || false,
          leaveApproval: acc.leaveApproval || control?.leaveApproval || false,
          regularization: acc.regularization || control?.regularization || false,
        };
      },
      {
        list: false,
        attendance: false,
        leaveApproval: false,
        regularization: false,
      }
    );

    return res.json({
      isTeamManager,
      managedTeamIds: managedTeams.map((team) => team.id),
      access,
    });
  } catch (error) {
    console.error("Get my manager access error:", error);
    return res.status(500).json({ message: "Failed to fetch manager access" });
  }
};