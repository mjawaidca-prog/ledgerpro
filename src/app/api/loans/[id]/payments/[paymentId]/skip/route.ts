import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { skipLoanPayment } from '@/lib/loans/server';

export const dynamic = 'force-dynamic';

/**
 * Mark a scheduled payment as missed. The tail re-amortizes from the
 * same balance one period later — the obligation rolls forward instead
 * of vanishing from the schedule.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; paymentId: string } }
) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    await skipLoanPayment(companyId, params.paymentId);
    await auditLog(companyId, userId, 'loan.payment.skip', 'loan_payment', params.paymentId, {
      loanId: params.id,
    });
    return NextResponse.json({ data: { skipped: true } });
  } catch (error) {
    console.error('POST /api/loans/[id]/payments/[paymentId]/skip error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to skip loan payment' },
      { status: 400 }
    );
  }
}
