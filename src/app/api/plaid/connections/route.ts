import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// GET /api/plaid/connections — this company's feed connections and their
// provider accounts. Access tokens are never selected or returned.
export async function GET(req: NextRequest) {
  try {
    const session = await requireCompany(req);
    if (session.error) return session.error;

    const connections = await db.bankConnection.findMany({
      where: { companyId: session.companyId! },
      include: {
        accounts: { orderBy: { createdAt: 'asc' } },
        syncRuns: { orderBy: { startedAt: 'desc' }, take: 3 },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      data: connections.map((c) => ({
        id: c.id,
        institutionId: c.institutionId,
        institutionName: c.institutionName,
        status: c.status,
        consentExpiresAt: c.consentExpiresAt,
        lastSyncAt: c.lastSyncAt,
        cadence: c.cadence,
        autoCategorize: c.autoCategorize,
        notifyOnFailure: c.notifyOnFailure,
        createdAt: c.createdAt,
        accounts: c.accounts.map((a) => ({
          providerAccountId: a.providerAccountId,
          name: a.name,
          mask: a.mask,
          subtype: a.subtype,
          currency: a.currency,
          currentBalance: a.currentBalance,
          availableBalance: a.availableBalance,
          financialAccountId: a.financialAccountId,
          isFeeding: a.isFeeding,
        })),
        recentSyncs: c.syncRuns.map((r) => ({
          id: r.id,
          trigger: r.trigger,
          status: r.status,
          addedCount: r.addedCount,
          dedupedCount: r.dedupedCount,
          error: r.error,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
        })),
      })),
    });
  } catch (error) {
    console.error('GET /api/plaid/connections error:', error);
    return NextResponse.json({ error: 'Failed to load bank connections' }, { status: 500 });
  }
}
