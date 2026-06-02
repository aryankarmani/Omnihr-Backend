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
  return ["HR_ADMIN", "ADMIN", "SYSTEM_ADMIN"].includes(role || "");
};

// ✅ NEW: Admin OR manager allowed
export const isAdminOrManager = (role?: string) => {
  return ["HR_ADMIN", "ADMIN", "SYSTEM_ADMIN", "MANAGER"].includes(role || "");
};