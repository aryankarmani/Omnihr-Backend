import { PrismaClient } from '@prisma/client';
import { getIO } from '../socket/socketHandler';

const prisma = new PrismaClient();

export type NotificationType = 'leave' | 'attendance' | 'system' | 'team' | 'employee' | 'chat' | 'call';

export const createNotification = async ({
  tenantId,
  userId,
  title,
  message,
  type = 'system',
  link,
}: {
  tenantId: string;
  userId: number;
  title: string;
  message: string;
  type?: NotificationType;
  link?: string;
}) => {
  const notif = await prisma.notification.create({
    data: {
      tenantId,
      userId,
      title,
      message,
      type,
      unread: true,
      ...(link ? { link } : {}),
    } as any,
  });

  try {
    const io = getIO();
    io.to(`user_${userId}`).emit('new_notification', {
      id: notif.id,
      title: notif.title,
      message: notif.message,
      type: notif.type,
      unread: notif.unread,
      link: notif.link,
      createdAt: notif.createdAt,
      date: notif.createdAt.toISOString().split('T')[0],
      time: 'Just now',
    });
  } catch (err) {
    // Socket might not be initialized yet
  }

  return notif;
};

export const notifyAdmins = async ({
  tenantId,
  title,
  message,
  type = 'system',
  link,
}: {
  tenantId: string;
  title: string;
  message: string;
  type?: NotificationType;
  link?: string;
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
      ...(link ? { link } : {}),
    })) as any,
  });

  try {
    const io = getIO();
    admins.forEach((admin) => {
      io.to(`user_${admin.id}`).emit('new_notification', {
        title,
        message,
        type,
        unread: true,
        link,
        createdAt: new Date(),
        date: new Date().toISOString().split('T')[0],
        time: 'Just now',
      });
    });
  } catch (err) {
    // Socket might not be initialized
  }
};