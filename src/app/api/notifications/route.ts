import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';

// GET /api/notifications — list notifications for the current user
export async function GET(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get('unread') === 'true';
    const type = searchParams.get('type');
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '25');
    const skip = (page - 1) * limit;

    const where: any = { userId: userId!, companyId };
    if (unreadOnly) where.read = false;
    if (type) where.type = type;

    const [notifications, total, unreadCount] = await Promise.all([
      db.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.notification.count({ where }),
      db.notification.count({ where: { userId: userId!, companyId, read: false } }),
    ]);

    return NextResponse.json({
      data: notifications,
      unreadCount,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('GET /api/notifications error:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}
