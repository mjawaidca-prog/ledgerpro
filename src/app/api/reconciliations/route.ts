import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { db } from '@/lib/db';
import { reconcileVerdict } from '@/lib/banking/reconcile-math';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reconciliations?accountId= — history + the working set:
 * candidates (pre-ticked = imported rows), the opening reconciled balance
 * (prior locked reconciliation's statement balance, else 0), and the current
 * open reconciliation if any.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');

    const history = await db.reconciliation.findMany({
      where: { companyId, ...(accountId ? { financialAccountId: accountId } : {}) },
      orderBy: { periodEnd: 'desc' },
      take: 25,
      include: { account: { select: { name: true, currency: true } } },
    });

    let workingSet = null;
    let openingBalance = 0;
    let open = null;

    if (accountId) {
      const account = await db.financialAccount.findUnique({ where: { id: accountId, companyId } });
      if (!account) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });

      const priorLocked = await db.reconciliation.findFirst({
        where: { financialAccountId: accountId, state: { in: ['locked', 'closed_with_variance'] } },
        orderBy: { periodEnd: 'desc' },
      });
      openingBalance = priorLocked ? Number(priorLocked.statementClosingBalance) : 0;

      open = await db.reconciliation.findFirst({
        where: { financialAccountId: accountId, state: 'open' },
        include: { transactions: { select: { id: true } } },
      });

      const candidates = await db.transaction.findMany({
        where: {
          financialAccountId: accountId,
          status: { notIn: ['excluded', 'transfer', 'voided'] },
        },
        orderBy: { date: 'asc' },
        take: 500,
      });

      const tickedIds = new Set(open?.transactions.map((t) => t.id) ?? []);

      workingSet = {
        openingBalance,
        candidates: candidates.map((t) => ({
          id: t.id,
          date: t.date.toISOString().slice(0, 10),
          description: t.description,
          amount: Number(t.amount),
          source: t.statementImportId ? 'Imported' : 'Entered by hand',
          ticked: tickedIds.has(t.id),
        })),
        account: { name: account.name, currency: account.currency, lockedThrough: account.lockedThrough },
        open: open
          ? {
              id: open.id,
              periodStart: open.periodStart.toISOString().slice(0, 10),
              periodEnd: open.periodEnd.toISOString().slice(0, 10),
              statementClosingBalance: Number(open.statementClosingBalance),
              unrecordedItems: open.unrecordedItems,
              tickedIds: [...tickedIds],
            }
          : null,
      };
    }

    return NextResponse.json({
      data: {
        history: history.map((h) => ({
          id: h.id,
          periodStart: h.periodStart.toISOString().slice(0, 10),
          periodEnd: h.periodEnd.toISOString().slice(0, 10),
          statement: Number(h.statementClosingBalance),
          ledger: h.ledgerBalance !== null ? Number(h.ledgerBalance) : null,
          difference: h.difference !== null ? Number(h.difference) : null,
          closedBy: h.closedBy,
          closedAt: h.closedAt,
          state: h.state,
          accountName: h.account.name,
        })),
        workingSet,
      },
    });
  } catch (err) {
    console.error('GET /api/reconciliations error:', err);
    return NextResponse.json({ error: 'Failed to load reconciliations' }, { status: 500 });
  }
}

/** POST /api/reconciliations — open a reconciliation for an account+period. */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const accountId = String(body.accountId ?? '');
    const periodStart = String(body.periodStart ?? '');
    const periodEnd = String(body.periodEnd ?? '');
    const statementClosingBalance = Number(body.statementClosingBalance);

    if (!accountId || !periodStart || !periodEnd || !Number.isFinite(statementClosingBalance)) {
      return NextResponse.json({ error: 'accountId, periodStart, periodEnd and statementClosingBalance are required.' }, { status: 400 });
    }

    const existing = await db.reconciliation.findFirst({ where: { financialAccountId: accountId, state: 'open' } });
    if (existing) {
      return NextResponse.json(
        { error: 'An open reconciliation already exists for this account. Close or reopen it first.' },
        { status: 409 }
      );
    }

    const account = await db.financialAccount.findUnique({ where: { id: accountId, companyId } });
    if (!account) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });

    const rec = await db.reconciliation.create({
      data: {
        companyId,
        financialAccountId: accountId,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        statementClosingBalance,
        state: 'open',
      },
    });

    await auditLog(companyId, userId, 'reconciliation.open', 'Reconciliation', rec.id, { accountId, periodStart, periodEnd } as any);
    return NextResponse.json({ data: rec }, { status: 201 });
  } catch (err) {
    console.error('POST /api/reconciliations error:', err);
    return NextResponse.json({ error: 'Failed to open the reconciliation' }, { status: 500 });
  }
}
