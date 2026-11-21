import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { toDollars } from '@/lib/loans/engine';
import { postCcaWritebackJournal } from '@/lib/cca/writeback-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/fixed-assets/writeback/[id]/post-journal
 *
 * The approval: post the write-back's proposed Schedule 1 journal
 * to the ledger (sourceType 'cca_writeback', dated the fiscal year
 * end). Refused — with the reason — when the record is superseded,
 * the journal is already posted, the write-back carried no Sch 1
 * lines, or the journal date falls in a closed period. Nothing
 * about a write-back ever reaches the ledger except through here.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const result = await postCcaWritebackJournal(companyId, userId, params.id);
    await auditLog(companyId, userId, 'fixed_asset.writeback.journal.post', 'cca_writeback', params.id, {
      journalEntryId: result.journalEntryId,
      fiscalYear: result.fiscalYear.label,
      totalDebits: toDollars(result.totalCents),
    });

    return NextResponse.json({
      data: {
        journalEntryId: result.journalEntryId,
        fiscalYear: result.fiscalYear,
        totalDebits: toDollars(result.totalCents),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to post the write-back journal';
    const status = /not found/i.test(message) ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
