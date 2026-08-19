/**
 * FX rate resolution — the single source of truth for "which rate applies".
 *
 * Precedence: same-date MANUAL row → same-date FEED row → nearest earlier
 * date (manual preferred at that date) with a stale flag and day count →
 * null. `from === to` is rate 1. Rates are company-global (per pair, not per
 * tenant) — a manual override affects every company; accepted for v1.
 */

import { db } from '@/lib/db';

export type RateSourceKind = 'feed' | 'manual' | 'none';

export interface ResolvedRate {
  rate: number | null;
  source: RateSourceKind;
  rateDate: string | null; // YYYY-MM-DD of the row used
  stale: boolean;
  staleDays: number; // days between rateDate and the requested date
  feedRate: number | null; // same-date feed rate (for override display)
  feedDate: string | null;
  manualRowId: string | null; // for "Reset to feed rate"
}

interface RateRow {
  date: Date;
  rate: number;
  id: string;
  source: 'feed' | 'manual';
}

/** Pure tie-break: pick the latest date; on a tie prefer manual. */
export function chooseRateRow(rows: RateRow[]): RateRow | null {
  if (!rows.length) return null;
  let best = rows[0];
  for (const r of rows.slice(1)) {
    if (r.date > best.date || (r.date.getTime() === best.date.getTime() && r.source === 'manual')) {
      best = r;
    }
  }
  return best;
}

export function daysBetween(fromStr: string, toStr: string): number {
  const a = new Date(fromStr).getTime();
  const b = new Date(toStr).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

export function deviationPct(manualRate: number, feedRate: number): number {
  if (!feedRate) return 0;
  return Math.abs(manualRate - feedRate) / feedRate * 100;
}

const toRow = (r: { id: string; date: Date; rate: unknown; source: 'feed' | 'manual' }): RateRow => ({
  id: r.id,
  date: r.date,
  rate: Number(r.rate),
  source: r.source,
});

export async function resolveRate(
  from: string,
  to: string,
  date: Date | string,
  type: 'daily' | 'closing' | 'average' = 'daily'
): Promise<ResolvedRate> {
  if (from === to) {
    return { rate: 1, source: 'none', rateDate: null, stale: false, staleDays: 0, feedRate: null, feedDate: null, manualRowId: null };
  }

  const dateStr = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  const d = new Date(dateStr);

  const [sameManual, sameFeed, priorManual, priorFeed] = await Promise.all([
    db.exchangeRate.findFirst({ where: { from, to, type, source: 'manual', date: d } }),
    db.exchangeRate.findFirst({ where: { from, to, type, source: 'feed', date: d } }),
    db.exchangeRate.findFirst({ where: { from, to, type, source: 'manual', date: { lt: d } }, orderBy: { date: 'desc' } }),
    db.exchangeRate.findFirst({ where: { from, to, type, source: 'feed', date: { lt: d } }, orderBy: { date: 'desc' } }),
  ]);

  if (sameManual) {
    return {
      rate: Number(sameManual.rate),
      source: 'manual',
      rateDate: dateStr,
      stale: false,
      staleDays: 0,
      feedRate: sameFeed ? Number(sameFeed.rate) : null,
      feedDate: sameFeed ? dateStr : null,
      manualRowId: sameManual.id,
    };
  }
  if (sameFeed) {
    return {
      rate: Number(sameFeed.rate),
      source: 'feed',
      rateDate: dateStr,
      stale: false,
      staleDays: 0,
      feedRate: Number(sameFeed.rate),
      feedDate: dateStr,
      manualRowId: null,
    };
  }

  const prior = chooseRateRow([
    ...(priorManual ? [toRow(priorManual)] : []),
    ...(priorFeed ? [toRow(priorFeed)] : []),
  ]);

  if (prior) {
    const priorDateStr = prior.date.toISOString().slice(0, 10);
    return {
      rate: prior.rate,
      source: prior.source,
      rateDate: priorDateStr,
      stale: true,
      staleDays: daysBetween(priorDateStr, dateStr),
      feedRate: priorFeed ? Number(priorFeed.rate) : null,
      feedDate: priorFeed ? priorFeed.date.toISOString().slice(0, 10) : null,
      manualRowId: prior.source === 'manual' ? prior.id : null,
    };
  }

  return { rate: null, source: 'none', rateDate: null, stale: false, staleDays: 0, feedRate: null, feedDate: null, manualRowId: null };
}
