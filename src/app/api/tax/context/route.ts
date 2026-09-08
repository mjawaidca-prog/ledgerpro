import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { getTaxUiContext } from '@/lib/tax/ui-service';
import { isTaxDate } from '@/lib/tax/date';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;
    const rawDate = new URL(req.url).searchParams.get('date');
    if (rawDate && !isTaxDate(rawDate)) return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
    const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00.000Z`) : new Date();
    if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
    const context = await getTaxUiContext(companyId, date);
    // A user may attest only their own review; selecting another person's name is not approval.
    return NextResponse.json({ data: { ...context, reviewers: context.reviewers.filter(reviewer => reviewer.id === userId) } });
  } catch (error) {
    console.error('GET /api/tax/context error:', error);
    return NextResponse.json({ error: 'Failed to load tax options.' }, { status: 500 });
  }
}
