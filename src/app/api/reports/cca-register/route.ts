import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { assembleCcaRegisterExport } from '@/lib/cca/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/cca-register?asOf=YYYY-MM-DD
 *
 * Builds the `cca-register/1` JSON export that feeds Nexvar Tax's
 * Schedule 8 (see src/lib/cca-register.ts for the contract): per-class
 * additions/disposals with the tax facts captured at purchase, the
 * full register dump, the book side cross-checked against the trial
 * balance, and the machine-supplied Schedule 1 add-back. The response
 * body is exactly the payload, so it can be saved and handed to
 * Nexvar Tax as-is; the register-vs-ledger difference rides in the
 * X-Cca-Register-Difference header for the export menu's notice.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return NextResponse.json({ error: 'asOf must be a YYYY-MM-DD date' }, { status: 400 });
    }

    let assembled;
    try {
      assembled = await assembleCcaRegisterExport(companyId, asOf);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to assemble export';
      if (/business number|fiscal year start/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 422 });
      }
      throw e;
    }

    const { result, fiscalYear } = assembled;
    return NextResponse.json(result.payload, {
      headers: {
        'Content-Disposition': `attachment; filename="cca-register-${fiscalYear.end}.json"`,
        'X-Cca-Register-Assets': String(result.assetCount),
        'X-Cca-Register-Difference':
          result.bookVsLedgerDifferenceCents != null
            ? String(result.bookVsLedgerDifferenceCents / 100)
            : 'n/a',
      },
    });
  } catch (error) {
    console.error('GET /api/reports/cca-register error:', error);
    return NextResponse.json({ error: 'Failed to generate cca-register/1 export' }, { status: 500 });
  }
}
