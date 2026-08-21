import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/bank-rules/[id] — edit any field. Reorder by sending
 * `{ orderedIds: [...] }` — the server rewrites `order` sequentially.
 * DELETE — remove the rule.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin', 'bookkeeper'] });
    if (error) return error;

    const body = await req.json();

    // Reorder-all branch.
    if (Array.isArray(body.orderedIds)) {
      for (let i = 0; i < body.orderedIds.length; i++) {
        await db.bankRule.updateMany({
          where: { id: body.orderedIds[i], companyId },
          data: { order: i + 1 },
        });
      }
      await auditLog(companyId, userId, 'bank_rule.reorder', 'BankRule', undefined, { orderedIds: body.orderedIds } as any);
      return NextResponse.json({ data: { reordered: true } });
    }

    const existing = await db.bankRule.findUnique({ where: { id: params.id, companyId } });
    if (!existing) return NextResponse.json({ error: 'Rule not found.' }, { status: 404 });

    const data: any = {};
    for (const key of ['name', 'op', 'value', 'anyOf', 'scope', 'setCategoryCode', 'setTaxCode', 'setTaxInclusive', 'setContactId', 'autoPost', 'enabled', 'order']) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (body.setTaxRate !== undefined) data.setTaxRate = body.setTaxRate === null ? null : Number(body.setTaxRate);

    const rule = await db.bankRule.update({ where: { id: params.id }, data });
    await auditLog(companyId, userId, 'bank_rule.update', 'BankRule', params.id, data as any);
    return NextResponse.json({ data: rule });
  } catch (err) {
    console.error('PATCH /api/bank-rules/[id] error:', err);
    return NextResponse.json({ error: 'Failed to update the rule' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;

    const existing = await db.bankRule.findUnique({ where: { id: params.id, companyId } });
    if (!existing) return NextResponse.json({ error: 'Rule not found.' }, { status: 404 });

    await db.bankRule.delete({ where: { id: params.id } });
    await auditLog(companyId, userId, 'bank_rule.delete', 'BankRule', params.id, { name: existing.name } as any);
    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('DELETE /api/bank-rules/[id] error:', err);
    return NextResponse.json({ error: 'Failed to delete the rule' }, { status: 500 });
  }
}
