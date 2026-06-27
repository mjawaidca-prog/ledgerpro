import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog, closedPeriodGuard } from '@/lib/api-helpers';
import { postJournalEntry } from '@/lib/journal';
import { z } from 'zod';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annual']),
  nextPostDate: z.string(),
  endDate: z.string().optional(),
  lines: z.array(z.object({
    glAccountCode: z.string(),
    description: z.string().optional(),
    debit: z.number().default(0),
    credit: z.number().default(0),
  })).min(2),
});

// GET /api/recurring
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const templates = await db.recurringTemplate.findMany({
      where: { companyId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { nextPostDate: 'asc' },
    });

    return NextResponse.json({ data: templates });
  } catch (error) {
    console.error('GET /api/recurring error:', error);
    return NextResponse.json({ error: 'Failed to fetch recurring templates' }, { status: 500 });
  }
}

// POST /api/recurring
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });

    const { lines, ...data } = parsed.data;

    const template = await db.recurringTemplate.create({
      data: {
        ...data,
        nextPostDate: new Date(data.nextPostDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        companyId,
        lines: {
          create: lines.map((l, i) => ({ ...l, sortOrder: i })),
        },
      },
    });

    await auditLog(companyId, userId, 'recurring.create', 'recurring_template', template.id);

    return NextResponse.json({ data: template }, { status: 201 });
  } catch (error) {
    console.error('POST /api/recurring error:', error);
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }
}
