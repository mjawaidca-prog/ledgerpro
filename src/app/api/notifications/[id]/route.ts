import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// PUT /api/notifications/[id] — mark a notification as read
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, error } = await requireCompany(req);
    if (error) return error;

    const notificationId = params.id;

    const notification = await db.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    const updated = await db.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('PUT /api/notifications/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 });
  }
}

// PUT /api/notifications/[id]/read — mark as read (convenience alias)
// Handled by the [id] route above when called via /api/notifications/[id] with PUT
// For /api/notifications/[id]/read specifically, we use a query param approach
