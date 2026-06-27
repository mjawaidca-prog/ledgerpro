import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { z } from 'zod';

const budgetSchema = z.object({
  name: z.string().min(1).max(200),
  fiscalYear: z.number().int().min(2000).max(2100),
  period: z.enum(['monthly', 'quarterly', 'annual']),
  lines: z.array(z.object({
    glAccountCode: z.string().min(1),
    amount: z.number(),
    period: z.string().optional(),
  })).min(1),
});

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const fiscalYear = parseInt(searchParams.get('fiscalYear') ?? String(new Date().getFullYear()));

    const budgets = await db.budget.findMany({
      where: { companyId, fiscalYear },
      include: { lines: { select: { glAccountCode: true, amount: true, period: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ data: budgets });
  } catch (error) {
    console.error('GET /api/budgets error:', error);
    return NextResponse.json({ error: 'Failed to fetch budgets' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const body = await req.json();
    const parsed = budgetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { name, fiscalYear, period, lines } = parsed.data;

    const budget = await db.budget.create({
      data: {
        companyId,
        name,
        fiscalYear,
        period,
        lines: {
          create: lines.map((l) => ({
            glAccountCode: l.glAccountCode,
            amount: l.amount,
            period: l.period || null,
          })),
        },
      },
      include: { lines: true },
    });

    await auditLog(companyId, userId, 'budget.create', 'budget', budget.id, { name, fiscalYear });

    return NextResponse.json({ data: budget }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/budgets error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create budget' }, { status: 500 });
  }
}
