/**
 * Dated FX rate lookups for consolidation.
 *
 * Prefers rows from the ExchangeRate table; falls back to the static
 * indicative table in src/lib/currencies.ts (and reports that fallback via
 * `source` so the caller can emit a warning naming the entity and rate).
 */

import { db } from '@/lib/db';
import { convertCurrency } from '@/lib/currencies';

export interface RateResult {
  rate: number;
  source: 'dated' | 'fallback' | 'none';
}

/** Latest dated rate of `type` on or before `asOf` for from→to. */
export async function getDatedRate(
  from: string,
  to: string,
  asOf: Date,
  type: 'closing' | 'average'
): Promise<RateResult> {
  if (from === to) return { rate: 1, source: 'none' };

  // ExchangeRate.date is @db.Date (UTC midnight) — compare on the YYYY-MM-DD
  // string slice, never on full Date objects.
  const asOfStr = asOf.toISOString().slice(0, 10);

  const row = await db.exchangeRate.findFirst({
    where: { from, to, type, date: { lte: new Date(asOfStr) } },
    orderBy: { date: 'desc' },
  });

  if (row) return { rate: Number(row.rate), source: 'dated' };

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

  const row = await db.exchangeRate.findFirst({
    where: { from, to, type: 'closing', date: { gte: new Date(refStr) } },
    orderBy: { date: 'asc' },
  });

  if (row) return { rate: Number(row.rate), source: 'dated' };

  return { rate: closingFallback.rate, source: 'fallback' };
}
