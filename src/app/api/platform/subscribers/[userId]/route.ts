import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin, platformAudit } from '@/lib/platform/auth';
import { subscriberDetail } from '@/lib/platform/subscribers';
export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, { params }: { params: { userId: string } }) {
  const { ctx, error } = await requirePlatformAdmin();
  if (error) return error;
  const detail = await subscriberDetail(params.userId);
  if (!detail) return NextResponse.json({ error: 'Subscriber not found' }, { status: 404 });
  await platformAudit({ adminUserId: ctx!.userId, action: 'control_center.subscriber_view', targetType: 'user', targetId: params.userId });
  return NextResponse.json({ data: detail });
}
