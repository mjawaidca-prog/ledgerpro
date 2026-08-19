import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fx/feed-status — feed health for the current company:
 * last success/attempt, consecutive failures, last error, next scheduled
 * sync (lastSuccessAt + 24h), and `stalePairs` (enabled pairs whose latest
 * daily feed row is older than 3 days — drives the stale banners).
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;
    if (!companyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [status, company] = await Promise.all([
      db.fxFeedStatus.findUnique({ where: { companyId } }),
      db.company.findUnique({
        where: { id: companyId },
        select: { enabledCurrencies: true, rateSource: true, currency: true },
      }),
    ]);

    const home = company?.currency ?? 'CAD';
    const pairs = (company?.enabledCurrencies ?? ['CAD']).filter((c) => c !== home);

    // Latest daily feed row per pair; a pair is stale when its newest row is
    // older than 3 days (or no row exists at all).
    const stalePairs: { from: string; to: string; lastDate: string | null }[] = [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 3);

    for (const ccy of pairs) {
      const latest = await db.exchangeRate.findFirst({
        where: { from: ccy, to: home, type: 'daily', source: 'feed' },
        orderBy: { date: 'desc' },
        select: { date: true },
      });
      if (!latest || latest.date < cutoff) {
        stalePairs.push({
          from: ccy,
          to: home,
          lastDate: latest ? latest.date.toISOString().slice(0, 10) : null,
        });
      }
    }

    const nextScheduledAt = status?.lastSuccessAt
      ? new Date(status.lastSuccessAt.getTime() + 24 * 3600 * 1000).toISOString()
      : null;

    return NextResponse.json({
      data: {
        rateSource: company?.rateSource ?? 'bank_of_canada',
        pairs: pairs.length,
        lastSuccessAt: status?.lastSuccessAt ?? null,
        lastAttemptAt: status?.lastAttemptAt ?? null,
        consecutiveFailures: status?.consecutiveFailures ?? 0,
        lastError: status?.lastError ?? null,
        lastResults: status?.lastResults ?? null,
        nextScheduledAt,
        stalePairs,
      },
    });
  } catch (err) {
    console.error('GET /api/fx/feed-status error:', err);
    return NextResponse.json({ error: 'Failed to load feed status' }, { status: 500 });
  }
}
