import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1),
  pattern: z.string().min(1),
  patternType: z.enum(['merchant_match', 'description_contains', 'amount_range', 'regex']),
  categoryId: z.string().min(1),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
  priority: z.number().default(0),
  active: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const rules = await db.categorizationRule.findMany({
      where: { companyId },
      include: { category: { select: { code: true, name: true } } },
      orderBy: [{ priority: 'desc' }, { matchCount: 'desc' }],
    });

    return NextResponse.json({ data: rules });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });

    const rule = await db.categorizationRule.create({
      data: { ...parsed.data, companyId },
      include: { category: { select: { code: true, name: true } } },
    });

    await auditLog(companyId, userId, 'rule.create', 'categorization_rule', rule.id);

    return NextResponse.json({ data: rule }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
  }
}
