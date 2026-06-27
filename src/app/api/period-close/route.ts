import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { z } from 'zod';

const createSchema = z.object({
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  notes: z.string().optional(),
});

// GET /api/period-close — list closed periods
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;

    const where: any = { companyId };
    if (status) where.status = status;

    const periods = await db.periodClose.findMany({
      where,
      orderBy: { periodStart: 'desc' },
      take: 24,
    });

    return NextResponse.json({ data: periods });
  } catch (error) {
    console.error('GET /api/period-close error:', error);
    return NextResponse.json({ error: 'Failed to fetch periods' }, { status: 500 });
  }
}

// POST /api/period-close — close a period
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin'] });
    if (error) return error;

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const periodStart = new Date(parsed.data.periodStart);
    const periodEnd = new Date(parsed.data.periodEnd);

    if (periodEnd <= periodStart) {
      return NextResponse.json({ error: 'Period end must be after period start' }, { status: 400 });
    }

    // Check for overlap with existing closed periods
    const overlapping = await db.periodClose.findFirst({
      where: {
        companyId,
        status: 'closed',
        OR: [
          { periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } },
        ],
      },
    });

    if (overlapping) {
      return NextResponse.json(
        { error: 'This period overlaps with an already-closed period.' },
        { status: 409 }
      );
    }

    const period = await db.periodClose.create({
      data: {
        companyId,
        periodStart,
        periodEnd,
        closedBy: userId,
        closedAt: new Date(),
        status: 'closed',
        notes: parsed.data.notes || null,
      },
    });

    await auditLog(companyId, userId, 'period.close', 'period_close', period.id, null, {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    });

    return NextResponse.json({ data: period }, { status: 201 });
  } catch (error) {
    console.error('POST /api/period-close error:', error);
    return NextResponse.json({ error: 'Failed to close period' }, { status: 500 });
  }
}
