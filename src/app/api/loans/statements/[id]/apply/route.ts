import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { z } from 'zod';
import { applyStatementToLoan } from '@/lib/loans/statement-service';

export const dynamic = 'force-dynamic';

const applySchema = z.object({
  loanId: z.string().min(1),
  acceptCorrection: z.boolean().default(false),
});

/**
 * POST /api/loans/statements/[id]/apply — the reviewer-confirmed
 * write: link the statement to a loan, set the loan's statement-
 * balance leg from it, record the check, and — only when
 * acceptCorrection is true — re-amortize the unposted tail from the
 * statement balance. This route is the approval; nothing before it
 * changes a loan.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const body = await req.json().catch(() => null);
    const parsed = applySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const result = await applyStatementToLoan({
      companyId: companyId!,
      statementId: params.id,
      loanId: parsed.data.loanId,
      acceptCorrection: parsed.data.acceptCorrection,
    });

    await auditLog(companyId!, userId!, 'loan_statement.apply', 'loanStatement', params.id, {
      loanId: parsed.data.loanId,
      difference: result.check.difference,
      correctionApplied: result.correctionApplied,
    } as any);

    return NextResponse.json({ data: result });
  } catch (err: any) {
    console.error('POST /api/loans/statements/[id]/apply error:', err);
    const status = /not found/i.test(err?.message ?? '') ? 404 : 400;
    return NextResponse.json({ error: err.message || 'Failed to apply the statement' }, { status });
  }
}
