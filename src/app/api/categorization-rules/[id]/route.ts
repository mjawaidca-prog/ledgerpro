import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { taxFieldsSchema } from '@/lib/banking/rule-schema';
import { z } from 'zod';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  pattern: z.string().min(1).optional(),
  patternType: z.enum(['merchant_match', 'description_contains', 'amount_range', 'regex']).optional(),
  categoryId: z.string().min(1).optional(),
  minAmount: z.number().nullable().optional(),
  maxAmount: z.number().nullable().optional(),
  priority: z.number().optional(),
  active: z.boolean().optional(),
}).merge(taxFieldsSchema.partial());

// PATCH /api/categorization-rules/[id] — update a rule, including its
// Phase 1 tax fields (the UI previously offered create/delete only, which
// would have forced recreating every existing rule to add tax treatment).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const existing = await db.categorizationRule.findUnique({ where: { id: params.id } });
    if (!existing || existing.companyId !== companyId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });

    const rule = await db.categorizationRule.update({
      where: { id: params.id },
      data: parsed.data,
      include: { category: { select: { code: true, name: true } } },
    });

    await auditLog(companyId, userId, 'rule.update', 'categorization_rule', rule.id);

    return NextResponse.json({ data: rule });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin'] });
    if (error) return error;

    const rule = await db.categorizationRule.findUnique({ where: { id: params.id } });
    if (!rule || rule.companyId !== companyId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.categorizationRule.delete({ where: { id: params.id } });

    await auditLog(companyId, undefined, 'rule.delete', 'categorization_rule', params.id);

    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
