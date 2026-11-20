import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; advanceId: string } }
) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin'],
    });
    if (error) return error;

    const advance = await db.loanAdvance.findFirst({
      where: { id: params.advanceId, loanId: params.id, loan: { companyId } },
    });
    if (!advance) return NextResponse.json({ error: 'Advance not found' }, { status: 404 });

    await db.loanAdvance.delete({ where: { id: advance.id } });
    await auditLog(companyId, userId, 'loan.advance.delete', 'loan_advance', advance.id, {
      loanId: params.id,
      kind: advance.kind,
      amount: Number(advance.amount),
    });
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    console.error('DELETE /api/loans/[id]/advances/[advanceId] error:', error);
    return NextResponse.json({ error: 'Failed to delete advance' }, { status: 500 });
  }
}
