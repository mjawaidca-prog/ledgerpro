import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

const VALID_SUBTYPES = [
  'current_asset', 'fixed_asset', 'other_asset',
  'current_liability', 'long_term_liability',
  'common_shares', 'retained_earnings', 'owners_equity', 'other_equity',
];

// PUT — edit an existing chart of account's presentation/classification fields.
// Code, type, and balance are not editable here — changing an account's
// fundamental type after it has activity would misclassify everything
// already posted to it.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const existing = await db.chartOfAccount.findUnique({ where: { id: params.id, companyId } });
    if (!existing) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const body = await req.json();
    const { name, detailType, subType, gifiCode, description, active } = body;

    if (subType !== undefined && subType !== null && !VALID_SUBTYPES.includes(subType)) {
      return NextResponse.json({ error: 'Invalid subType' }, { status: 400 });
    }

    const updated = await db.chartOfAccount.update({
      where: { id: params.id },
      data: {
        name: name !== undefined ? name : undefined,
        detailType: detailType !== undefined ? detailType : undefined,
        subType: subType !== undefined ? subType : undefined,
        gifiCode: gifiCode !== undefined ? gifiCode : undefined,
        description: description !== undefined ? description : undefined,
        active: active !== undefined ? active : undefined,
      },
    });

    await auditLog(companyId, userId, 'coa.update', 'chart_of_account', params.id, { before: existing, after: updated });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error('PUT /api/coa/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
  }
}
