import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const timeAgo = (date: Date) => {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);

  if (seconds < 60) return `${seconds} secs ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} mins ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
};

export const getNotifications = async (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    const notifications = await prisma.notification.findMany({
      where: {
        tenantId: user.tenantId,
        userId: user.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    res.json(
      notifications.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        type: n.type,
        unread: n.unread,
        date: n.createdAt.toISOString().split('T')[0],
        time: timeAgo(n.createdAt),
      }))
    );
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

export const markNotificationRead = async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const { id } = req.params;

    await prisma.notification.updateMany({
      where: {
        id,
        tenantId: user.tenantId,
        userId: user.id,
      },
      data: {
        unread: false,
      },
    });

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

export const markAllNotificationsRead = async (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    await prisma.notification.updateMany({
      where: {
        tenantId: user.tenantId,
        userId: user.id,
        unread: true,
      },
      data: {
        unread: false,
      },
    });

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
};

export const deleteBulkNotifications = async (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const { ids } = req.body;

    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    await prisma.notification.deleteMany({
      where: {
        id: {
          in: ids,
        },
        tenantId: user.tenantId,
        userId: user.id,
      },
    });

    res.json({ message: 'Notifications deleted successfully' });
  } catch (error) {
    console.error('Delete notifications error:', error);
    res.status(500).json({ error: 'Failed to delete notifications' });
  }
};