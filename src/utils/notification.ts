import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type NotificationType = 'leave' | 'attendance' | 'system' | 'team' | 'employee';

export const createNotification = async ({
  tenantId,
  userId,
  title,
  message,
  type = 'system',
}: {
  tenantId: string;
  userId: number;
  title: string;
  message: string;
  type?: NotificationType;
}) => {
  return prisma.notification.create({
    data: {
      tenantId,
      userId,
      title,
      message,
      type,
      unread: true,
    },
  });
};

export const notifyAdmins = async ({
  tenantId,
  title,
  message,
  type = 'system',
}: {
  tenantId: string;
  title: string;
  message: string;
  type?: NotificationType;
}) => {
  const admins = await prisma.user.findMany({
    where: {
      tenantId,
      role: {
        name: {
          in: ['HR_ADMIN', 'ADMIN', 'SYSTEM_ADMIN'],
        },
      },
    },
    select: { id: true },
  });
  if (admins.length === 0) return;

  await prisma.notification.createMany({
    data: admins.map((admin) => ({
      tenantId,
      userId: admin.id,
      title,
      message,
      type,
      unread: true,
    })),
  });
};