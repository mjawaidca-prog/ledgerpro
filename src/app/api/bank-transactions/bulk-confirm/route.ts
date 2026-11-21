import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { bulkConfirmSuggestions } from '@/lib/ai/categorization';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank-transactions/bulk-confirm — one-click confirmation of
 * every bulk-eligible AI suggestion on an account's review queue
 * (Phase 2 item 1). Eligibility is conservative and enforced server-side
 * (see isBulkEligible): high-confidence rules/memory suggestions, plus
 * LLM patterns the company has accepted before. Confirmed rows are
 * categorized, NOT posted — posting stays the existing separate step.
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json().catch(() => ({}));
    const accountId = typeof body.accountId === 'string' ? body.accountId : '';
    if (!accountId) return NextResponse.json({ error: 'An account is required.' }, { status: 400 });

    const result = await bulkConfirmSuggestions(db, {
      companyId,
      financialAccountId: accountId,
      userId: userId ?? undefined,
    });

    if (result.confirmed > 0) {
      await auditLog(companyId, userId, 'bank_transaction.ai_bulk_confirm', 'financial_account', accountId, {
        confirmed: result.confirmed,
        leftForReview: result.leftForReview,
      } as any);
    }

    return NextResponse.json({ data: result });
  } catch (err: any) {
    console.error('POST /api/bank-transactions/bulk-confirm error:', err);
    return NextResponse.json({ error: err.message || 'Failed to bulk-confirm suggestions' }, { status: 500 });
  }
}
