import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { assembleYearEndPackage } from '@/lib/year-end/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/year-end-package?asOf=YYYY-MM-DD
 *
 * Runs the year-end pre-flight for the fiscal year containing `asOf`
 * (default: today) and returns the cover sheet as JSON for the
 * Year-End Package page.
 *
 * GET /api/reports/year-end-package?asOf=YYYY-MM-DD&format=package
 *
 * Downloads the `year-end-package/1` bundle itself (see
 * src/lib/year-end-package.ts for the contract): cover sheet, tb-gifi/1
 * trial balance with the prior-year comparative, GL detail summary,
 * the cca-register/1 payload, loan schedules with fiscal-year interest
 * totals, one gst-worksheet/1 payload per filing period, and the
 * payroll section. The bundle is generated even when checks warn or
 * block (design §7.1 — never silent); the block/warn counts ride in
 * response headers and the cover sheet inside the bundle.
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
      assembled = await assembleYearEndPackage(companyId, asOf);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to assemble year-end package';
      if (/business number|fiscal year start/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 422 });
      }
      throw e;
    }

    const { fiscalYear, companyName, coverSheet, result } = assembled;

    if (searchParams.get('format') === 'package') {
      return NextResponse.json(result.payload, {
        headers: {
          'Content-Disposition': `attachment; filename="year-end-package-${fiscalYear.end}.json"`,
          'X-Year-End-Blocks': String(coverSheet.summary.block),
          'X-Year-End-Warnings': String(coverSheet.summary.warn),
        },
      });
    }

    return NextResponse.json({
      data: {
        companyName,
        fiscalYear: { start: fiscalYear.start, end: fiscalYear.end, label: fiscalYear.label },
        coverSheet,
        packageHash: result.payload.hash,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/year-end-package error:', error);
    return NextResponse.json({ error: 'Failed to generate year-end package' }, { status: 500 });
  }
}
