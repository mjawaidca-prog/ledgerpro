import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

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
