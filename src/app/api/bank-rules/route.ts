import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/bank-rules — ordered rule list. */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const rules = await db.bankRule.findMany({
      where: { companyId },
      orderBy: { order: 'asc' },
      include: { contact: { select: { id: true, name: true, companyName: true } } },
    });

    return NextResponse.json({ data: rules });
  } catch (err) {
    console.error('GET /api/bank-rules error:', err);
    return NextResponse.json({ error: 'Failed to load rules' }, { status: 500 });
  }
}

/** POST /api/bank-rules — create a rule. */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const body = await req.json();
    if (!body.name || !body.value) {
      return NextResponse.json({ error: 'A name and match value are required.' }, { status: 400 });
    }

    const last = await db.bankRule.findFirst({ where: { companyId }, orderBy: { order: 'desc' } });

    const rule = await db.bankRule.create({
      data: {
        companyId,
        name: String(body.name),
        order: (last?.order ?? 0) + 1,
        op: (body.op as any) ?? 'contains',
        value: String(body.value),
        anyOf: Array.isArray(body.anyOf) ? body.anyOf : [],
        scope: body.scope ?? { accountIds: 'all', direction: 'both' },
        setCategoryCode: body.setCategoryCode ?? null,
        setTaxCode: body.setTaxCode ?? null,
        setTaxRate: body.setTaxRate != null ? Number(body.setTaxRate) : null,
        setTaxInclusive: body.setTaxInclusive !== false,
        setContactId: body.setContactId ?? null,
        autoPost: Boolean(body.autoPost),
        enabled: body.enabled !== false,
      },
    });

    await auditLog(companyId, userId, 'bank_rule.create', 'BankRule', rule.id, { name: rule.name } as any);
    return NextResponse.json({ data: rule }, { status: 201 });
  } catch (err) {
    console.error('POST /api/bank-rules error:', err);
    return NextResponse.json({ error: 'Failed to create the rule' }, { status: 500 });
  }
}
