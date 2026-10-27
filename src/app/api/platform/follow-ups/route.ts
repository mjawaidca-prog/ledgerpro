import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePlatformAdmin } from '@/lib/platform/auth';
import { isFollowUpDue } from '@/lib/platform/rollup';
import { serializeFollowUp } from '@/lib/platform/subscribers';
export const dynamic = 'force-dynamic';
// GET /api/platform/follow-ups?due=1 — CC-3 follow-up list / due view.
export async function GET(req: Request) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const dueOnly = new URL(req.url).searchParams.get('due') === '1';
  const rows = await (db as any).subscriberFollowUp.findMany({
    orderBy: [{ nextFollowUpAt: 'asc' }, { updatedAt: 'desc' }],
    include: { company: { select: { id: true, name: true } } },
  }).catch(() => []);
  const now = new Date();
  const data = (rows as any[])
    .map((f) => ({ ...serializeFollowUp(f), companyName: f.company?.name ?? null, due: isFollowUpDue(f, now) }))
    .filter((f) => !dueOnly || f.due);
  return NextResponse.json({ data, asOf: now.toISOString() });
}
