import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog, closedPeriodGuard } from '@/lib/api-helpers';
import { z } from 'zod';
import { postLoanPayment, ymdToDate } from '@/lib/loans/server';
import { toCents } from '@/lib/loans/engine';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  // What actually moved, when it differs from the schedule. Approving
  // with no body posts the scheduled amount on the scheduled date.
  actualAmount: z.number().positive().optional(),
  actualDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * THE approval step. A schedule row is only a proposal; this route is
 * the user approving it, and it is the only path from the loan register
 * to the ledger. Posts Dr principal / Dr interest / Cr bank through the
 * journal engine (sourceType 'loan') and re-amortizes the tail when the
 * actual amount differed.
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

    const payment = await db.loanPayment.findFirst({
      where: { id: params.paymentId, loanId: params.id, loan: { companyId } },
      select: { id: true, dueDate: true },
    });
    if (!payment) return NextResponse.json({ error: 'Loan payment not found' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const actualDate = parsed.data.actualDate ?? payment.dueDate.toISOString().slice(0, 10);
    const guardError = await closedPeriodGuard(companyId, ymdToDate(actualDate));
    if (guardError) return guardError;

    const result = await postLoanPayment(companyId, params.paymentId, userId, {
      actualAmountCents: parsed.data.actualAmount != null ? toCents(parsed.data.actualAmount) : undefined,
      actualDate,
    });

    await auditLog(companyId, userId, 'loan.payment.post', 'loan_payment', params.paymentId, {
      journalEntryId: result.journalEntryId,
      principal: result.principalCents / 100,
      interest: result.interestCents / 100,
    });

    return NextResponse.json({
      data: {
        journalEntryId: result.journalEntryId,
        principal: result.principalCents / 100,
        interest: result.interestCents / 100,
        closingBalance: result.closingBalanceCents / 100,
        paidOff: result.paidOff,
      },
    });
  } catch (error) {
    console.error('POST /api/loans/[id]/payments/[paymentId]/post error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to post loan payment' },
      { status: 400 }
    );
  }
}
