import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ✅ NEW: Get all user IDs managed by a MANAGER
export const getManagerTeamMemberIds = async (
  tenantId: string,
  managerId: number
): Promise<number[]> => {
  const teams = await prisma.team.findMany({
    where: {
      tenantId,
      managerId,
    },
    include: {
      members: true,
    },
  });

  return teams.flatMap((team) => team.members.map((member) => member.userId));
};

// ✅ NEW: Check if logged-in user is admin
export const isAdminRole = (role?: string) => {
  return ["HR_ADMIN", "ADMIN", "SYSTEM_ADMIN", "MANAGER"].includes(role || "");
};
// ✅ CHANGED: do not check MANAGER role anymore
export const isUserTeamManager = async (tenantId: string, userId: number) => {
  const count = await prisma.team.count({
    where: {
      tenantId,
      managerId: userId,
    },
  });

  return count > 0;
};

// ✅ ADDED BACK: used by attendance.controller.ts
export const isAdminOrManager = (role?: string) => {
  return ["HR_ADMIN", "ADMIN", "SYSTEM_ADMIN", "MANAGER"].includes(role || "");
};