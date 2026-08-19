/**
 * Bank of Canada daily-rates feed (Valet API — free, no key, the rate the
 * CRA accepts). One request pulls every enabled pair; results upsert as
 * `daily` rows with source 'feed'. Manual rows are never overwritten.
 */

import { db } from '@/lib/db';

const BOC_BASE = 'https://www.bankofcanada.ca/valet/observations';

export interface FeedSyncResult {
  pairs: number;
  rows: number;
  missingPairs: string[];
}

/** Series name for a currency pair, e.g. USD→CAD is FXUSDCAD. */
export function seriesName(ccy: string, home: string): string {
  return `FX${ccy}${home}`;
}

export async function runFeedSync(companyId: string): Promise<FeedSyncResult> {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { enabledCurrencies: true, rateSource: true, currency: true },
  });

  const home = company.currency;
  const pairs = (company.enabledCurrencies ?? ['CAD']).filter((c) => c !== home);

  if (company.rateSource !== 'bank_of_canada' || pairs.length === 0) {
    return { pairs: 0, rows: 0, missingPairs: [] };
  }

  const series = pairs.map((c) => seriesName(c, home));
  const url = `${BOC_BASE}/${series.join(',')}/json`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const observations: Record<string, any>[] = json?.observations ?? [];

    const missing = new Set(series);
    let rows = 0;

    for (const obs of observations) {
      const d = obs.d;
      for (const s of series) {
        const v = obs[s]?.v;
        if (v === undefined || !Number.isFinite(Number(v))) continue;
        missing.delete(s);
        const ccy = s.slice(2, s.length - home.length);

        // Never overwrite a manual override for this date + pair.
        const manual = await db.exchangeRate.findFirst({
          where: { date: new Date(d), from: ccy, to: home, type: 'daily', source: 'manual' },
          select: { id: true },
        });
        if (manual) continue;

        await db.exchangeRate.upsert({
          where: { date_from_to_type_source: { date: new Date(d), from: ccy, to: home, type: 'daily', source: 'feed' } },
          update: { rate: Number(v), fetchedAt: new Date() },
          create: { date: new Date(d), from: ccy, to: home, rate: Number(v), type: 'daily', source: 'feed', fetchedAt: new Date() },
        });
        rows++;
      }
    }

    await updateFeedStatus(companyId, {
      success: true,
      pairsPulled: series.length - missing.size,
      missingPairs: [...missing],
      error: null,
    });

    return { pairs: series.length, rows, missingPairs: [...missing] };
  } catch (err: any) {
    await updateFeedStatus(companyId, { success: false, pairsPulled: 0, missingPairs: [], error: err?.message || 'Unknown error' });
    throw err;
  }
}

async function updateFeedStatus(
  companyId: string,
  info: { success: boolean; pairsPulled: number; missingPairs: string[]; error: string | null }
) {
  const now = new Date();
  if (info.success) {
    await db.fxFeedStatus.upsert({
      where: { companyId },
      update: {
        lastSuccessAt: now,
        lastAttemptAt: now,
        consecutiveFailures: 0,
        lastError: null,
        lastResults: { pairsPulled: info.pairsPulled, missingPairs: info.missingPairs },
      },
      create: {
        companyId,
        lastSuccessAt: now,
        lastAttemptAt: now,
        lastResults: { pairsPulled: info.pairsPulled, missingPairs: info.missingPairs },
      },
    });
  } else {
    await db.fxFeedStatus.upsert({
      where: { companyId },
      update: { lastAttemptAt: now, consecutiveFailures: { increment: 1 }, lastError: info.error },
      create: { companyId, lastAttemptAt: now, consecutiveFailures: 1, lastError: info.error },
    });
  }
}

/** Sync every company that has a Bank of Canada feed configured (cron path). */
export async function runFeedSyncAll(): Promise<{ companies: number }> {
  const companies = await db.company.findMany({
    where: { rateSource: 'bank_of_canada' },
    select: { id: true },
  });
  for (const c of companies) {
    try {
      await runFeedSync(c.id);
    } catch (err) {
      console.error(`[fx-feed] sync failed for company ${c.id}:`, err);
    }
  }
  return { companies: companies.length };
}
