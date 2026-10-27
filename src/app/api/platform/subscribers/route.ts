import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/platform/auth';
import { listSubscribers } from '@/lib/platform/subscribers';
export const dynamic = 'force-dynamic';
// GET /api/platform/subscribers — PER-USER list with per-company roll-up.
export async function GET(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit') ?? 25) || 25));
  const result = await listSubscribers({
    search: sp.get('search') ?? undefined, plan: sp.get('plan') ?? undefined,
    status: sp.get('status') ?? undefined, expiry: sp.get('expiry') ?? undefined, page, limit,
  });
  return NextResponse.json({ data: result.data, pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages } });
}
