import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { dismissIndustrySuggestion, getIndustrySuggestion } from '@/lib/industry-suggestion';
import { isKnownIndustryValue } from '@/lib/industry-coa';
export const dynamic = 'force-dynamic';

// GET — the active company's industry re-detection suggestion, or null.
//
// Phase 2 item 5: scores the company's real activity against the
// industry packs (src/lib/industry-detect.ts) and returns at most ONE
// suggestion. Computed on read from live data, so the first dashboard
// load after a bank import already reflects the new transactions.
// Nothing is ever applied by this route — applying goes through
// PUT /api/companies (the existing industry-set flow).
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const suggestion = await getIndustrySuggestion(companyId, db as any);
    return NextResponse.json({ data: suggestion });
  } catch (error) {
    console.error('GET /api/companies/industry-suggestion error:', error);
    return NextResponse.json({ error: 'Failed to evaluate industry suggestion' }, { status: 500 });
  }
}

// POST — dismiss the suggestion for an industry: { industry: '<key>' }.
// Remembered on the company row, so the same suggestion never nags
// twice; a different detected industry still surfaces later.
export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json().catch(() => ({}));
    if (!isKnownIndustryValue(body?.industry) || !body?.industry) {
      return NextResponse.json({ error: 'Unknown industry.' }, { status: 400 });
    }

    await dismissIndustrySuggestion(companyId, body.industry, db as any);
    return NextResponse.json({ data: { dismissed: body.industry } });
  } catch (error) {
    console.error('POST /api/companies/industry-suggestion error:', error);
    return NextResponse.json({ error: 'Failed to dismiss industry suggestion' }, { status: 500 });
  }
}
