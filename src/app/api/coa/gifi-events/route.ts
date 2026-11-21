import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { getGifiLearningContext } from '@/lib/gifi-events-server';
export const dynamic = 'force-dynamic';

// GET — the GIFI v2 learning context for the current company: its own
// pattern statistics plus the anonymized cross-company aggregate
// (pattern keys + counts only). The account forms fetch this once and
// feed it to rankGifiSuggestions (src/lib/gifi-suggestions-v2.ts).
// Advisory by design: when this fails the forms fall back to the
// un-learned ranking, exactly as v1 behaved.
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;
    const context = await getGifiLearningContext(companyId);
    return NextResponse.json({ data: context });
  } catch (error) {
    console.error('GET /api/coa/gifi-events error:', error);
    return NextResponse.json({ error: 'Failed to load GIFI learning context' }, { status: 500 });
  }
}
