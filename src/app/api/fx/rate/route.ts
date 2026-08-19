import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { resolveRate } from '@/lib/fx/rate';
import { CURRENCIES } from '@/lib/currencies';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/fx/rate?from=USD&to=CAD&date=2026-08-19&type=daily
 * Resolves one rate: manual beats feed; falls back to the nearest earlier
 * date and flags `stale` with a day count. 200 always (rate: null = missing).
 *
 * Bulk branch: ?from&to&dates=2026-08-01,2026-08-02 → { data: { '2026-08-01': ResolvedRate, ... } }
 */
export async function GET(req: NextRequest) {
  try {
    const { error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const from = (searchParams.get('from') ?? '').toUpperCase();
    const to = (searchParams.get('to') ?? '').toUpperCase();
    const typeParam = searchParams.get('type') ?? 'daily';
    const type = typeParam === 'closing' || typeParam === 'average' ? typeParam : 'daily';

    if (!CURRENCIES[from] || !CURRENCIES[to]) {
      return NextResponse.json({ error: 'Unsupported currency code.' }, { status: 400 });
    }
    if (from === to) {
      return NextResponse.json({ error: 'From and to currencies must differ.' }, { status: 400 });
    }

    const datesParam = searchParams.get('dates');
    if (datesParam) {
      const dates = datesParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (!dates.length || dates.some((d) => !DATE_RE.test(d))) {
        return NextResponse.json({ error: 'Invalid dates.' }, { status: 400 });
      }
      const out: Record<string, unknown> = {};
      for (const d of dates) out[d] = await resolveRate(from, to, d, type);
      return NextResponse.json({ data: out });
    }

    const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
    }

    const resolved = await resolveRate(from, to, date, type);
    return NextResponse.json({ data: resolved });
  } catch (err) {
    console.error('GET /api/fx/rate error:', err);
    return NextResponse.json({ error: 'Failed to resolve rate' }, { status: 500 });
  }
}
