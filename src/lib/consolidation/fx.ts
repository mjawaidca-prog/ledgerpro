/**
 * Dated FX rate lookups for consolidation.
 *
 * Prefers rows from the ExchangeRate table; falls back to the static
 * indicative table in src/lib/currencies.ts (and reports that fallback via
 * `source` so the caller can emit a warning naming the entity and rate).
 */

import { db } from '@/lib/db';
import { convertCurrency } from '@/lib/currencies';
import { chooseRateRow } from '@/lib/fx/rate';

export interface RateResult {
  rate: number;
  source: 'dated' | 'fallback' | 'none';
}

/** Latest dated rate of `type` on or before `asOf` for from→to (manual preferred over feed). */
export async function getDatedRate(
  from: string,
  to: string,
  asOf: Date,
  type: 'closing' | 'average' | 'daily'
): Promise<RateResult> {
  if (from === to) return { rate: 1, source: 'none' };

  // ExchangeRate.date is @db.Date (UTC midnight) — compare on the YYYY-MM-DD
  // string slice, never on full Date objects.
  const asOfStr = asOf.toISOString().slice(0, 10);

  const [manual, feed] = await Promise.all([
    db.exchangeRate.findFirst({
      where: { from, to, type, source: 'manual', date: { lte: new Date(asOfStr) } },
      orderBy: { date: 'desc' },
    }),
    db.exchangeRate.findFirst({
      where: { from, to, type, source: 'feed', date: { lte: new Date(asOfStr) } },
      orderBy: { date: 'desc' },
    }),
  ]);

  const row = chooseRateRow([
    ...(manual ? [{ id: manual.id, date: manual.date, rate: Number(manual.rate), source: 'manual' as const }] : []),
    ...(feed ? [{ id: feed.id, date: feed.date, rate: Number(feed.rate), source: 'feed' as const }] : []),
  ]);

  if (row) return { rate: row.rate, source: 'dated' };

  return { rate: convertCurrency(1, from, to), source: 'fallback' };
}

/**
 * Historical rate for equity translation. v1 approximation: the earliest
 * dated closing rate on/after the reference date (the date the related-party
 * link was created, or the fiscal-year start), else the closing rate. The
 * fallback is flagged so the working paper can disclose it.
 */
export async function getHistoricalRate(
  from: string,
  to: string,
  referenceDate: Date,
  closingFallback: RateResult
): Promise<RateResult> {
  if (from === to) return { rate: 1, source: 'none' };

  const refStr = referenceDate.toISOString().slice(0, 10);

  const [manual, feed] = await Promise.all([
    db.exchangeRate.findFirst({
      where: { from, to, type: 'closing', source: 'manual', date: { gte: new Date(refStr) } },
      orderBy: { date: 'asc' },
    }),
    db.exchangeRate.findFirst({
      where: { from, to, type: 'closing', source: 'feed', date: { gte: new Date(refStr) } },
      orderBy: { date: 'asc' },
    }),
  ]);

  const earliest = [manual, feed]
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => {
      const d = a.date.getTime() - b.date.getTime();
      if (d !== 0) return d;
      return a.source === 'manual' ? -1 : 1; // manual preferred on ties
    })[0];

  if (earliest) return { rate: Number(earliest.rate), source: 'dated' };

  return { rate: closingFallback.rate, source: 'fallback' };
}
