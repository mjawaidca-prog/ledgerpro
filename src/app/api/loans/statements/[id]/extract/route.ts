import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { runLoanStatementExtraction } from '@/lib/loans/statement-pipeline';
import { getLoanStatement } from '@/lib/loans/statement-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/loans/statements/[id]/extract — (re-)run the AI document
 * read on a stored statement: for statements uploaded before a
 * provider was configured, and to retry a failed read. The outcome
 * lands on the statement row (extracted | failed | unavailable); the
 * response is the refreshed statement either way.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const existing = await getLoanStatement(companyId!, params.id);
    if (!existing) return NextResponse.json({ error: 'Loan statement not found.' }, { status: 404 });

    const result = await runLoanStatementExtraction({ companyId: companyId!, statementId: params.id });

    await auditLog(companyId!, userId!, 'loan_statement.extract', 'loanStatement', params.id, {
      status: result.status,
      provider: result.providerId,
    } as any);

    const statement = await getLoanStatement(companyId!, params.id);
    return NextResponse.json({ data: { statement, extraction: result } });
  } catch (err: any) {
    console.error('POST /api/loans/statements/[id]/extract error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to run the AI read' }, { status: 500 });
  }
}
