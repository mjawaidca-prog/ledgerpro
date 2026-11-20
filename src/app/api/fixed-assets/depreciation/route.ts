import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { toDollars } from '@/lib/loans/engine';
import { postBookDepreciation, previewBookDepreciation } from '@/lib/cca/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fixed-assets/depreciation?fyEnd=YYYY-MM-DD
 *
 * The PROPOSED book-depreciation journal for the fiscal year ending
 * on fyEnd (default: today, i.e. the current fiscal year): per-asset
 * amounts and the GL accounts they will post through. Nothing is
 * written — posting is the POST below, and the POST is the approval.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const fyEnd = searchParams.get('fyEnd') ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fyEnd)) {
      return NextResponse.json({ error: 'fyEnd must be a YYYY-MM-DD date' }, { status: 400 });
    }

    const preview = await previewBookDepreciation(companyId, fyEnd);
    return NextResponse.json({
      data: {
        fiscalYear: preview.fiscalYear,
        total: toDollars(preview.totalCents),
        alreadyPostedJournalId: preview.alreadyPostedJournalId,
        lines: preview.lines.map((l) => ({
          assetId: l.assetId,
          description: l.description,
          ccaClass: l.ccaClass,
          amount: toDollars(l.amountCents),
          expenseCode: l.expenseCode,
          accumCode: l.accumCode,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/fixed-assets/depreciation error:', error);
    return NextResponse.json({ error: 'Failed to preview book depreciation' }, { status: 500 });
  }
}

/**
 * POST /api/fixed-assets/depreciation { fyEnd }
 *
 * Approve and post the fiscal year's book depreciation as one
 * balanced journal (sourceType 'fixed_asset'). A year can be posted
 * once; a repeat attempt is refused with the existing entry's id.
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const body = await req.json().catch(() => ({}));
    const fyEnd = typeof body?.fyEnd === 'string' ? body.fyEnd : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fyEnd)) {
      return NextResponse.json({ error: 'fyEnd must be a YYYY-MM-DD date' }, { status: 400 });
    }

    const result = await postBookDepreciation(companyId, fyEnd, userId);
    await auditLog(companyId, userId, 'fixed_asset.depreciation.post', 'fixed_asset', result.journalEntryId, {
      fiscalYear: result.fiscalYear.label,
      total: toDollars(result.totalCents),
      assetCount: result.assetCount,
    });

    return NextResponse.json({
      data: {
        journalEntryId: result.journalEntryId,
        fiscalYear: result.fiscalYear,
        total: toDollars(result.totalCents),
        assetCount: result.assetCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to post book depreciation';
    const status = /already posted|no book depreciation/i.test(message) ? 409 : 500;
    if (status === 500) console.error('POST /api/fixed-assets/depreciation error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
