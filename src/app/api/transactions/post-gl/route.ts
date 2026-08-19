import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard, auditLog } from '@/lib/api-helpers';
import { postTransactionToLedger } from '@/lib/journal';
import { resolveRate } from '@/lib/fx/rate';
export const dynamic = 'force-dynamic';

// POST — post categorized bank transactions to the General Ledger
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const { transactionIds } = body as { transactionIds: string[] };

    if (!transactionIds?.length) {
      return NextResponse.json({ error: 'No transaction IDs provided' }, { status: 400 });
    }

    const transactions = await db.transaction.findMany({
      where: { id: { in: transactionIds }, companyId, status: 'categorized' },
      include: {
        account: { select: { glAccountCode: true, currency: true } },
        category: { select: { code: true, name: true } },
      },
    });

    const company = await db.company.findUnique({ where: { id: companyId }, select: { currency: true } });
    const homeCurrency = company?.currency ?? 'CAD';

    if (transactions.length === 0) {
      return NextResponse.json({ error: 'No categorized transactions found' }, { status: 400 });
    }

    const posted: string[] = [];
    const skipped: string[] = [];
    const closedPeriod: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const tx of transactions) {
      if (tx.status !== 'categorized' || !tx.category) {
        skipped.push(tx.id);
        continue;
      }

      // A transaction dated in a closed period can't be posted — the user needs
      // to either reopen the period or leave it uncategorized for a correcting entry.
      if (await closedPeriodGuard(companyId, tx.date)) {
        closedPeriod.push(tx.id);
        continue;
      }

      const glCode = tx.account?.glAccountCode;

      // FX: rows in a foreign-currency account need the rate for THEIR OWN
      // date (never the import date), frozen per row at posting.
      const rowCurrency = tx.currency || tx.account?.currency || 'CAD';
      let fxRate: number | null = null;
      let amountHome: number | undefined;
      if (rowCurrency !== homeCurrency) {
        const resolved = await resolveRate(rowCurrency, homeCurrency, tx.date, 'daily');
        fxRate = resolved.rate;
        if (!fxRate) {
          failed.push({ id: tx.id, error: `No ${rowCurrency} → ${homeCurrency} rate for ${tx.date.toISOString().slice(0, 10)}. Add one in Settings › FX Rates, then post again.` });
          continue;
        }
        amountHome = Math.round(Math.abs(Number(tx.amount)) * fxRate * 100) / 100;
      }

      try {
        const entry = await postTransactionToLedger(
          {
            id: tx.id,
            date: tx.date,
            description: tx.description,
            amount: Number(tx.amount),
            currency: rowCurrency,
            fxRate: fxRate ?? undefined,
            amountHome,
          },
          glCode ?? undefined,
          tx.category.code,
          companyId
        );

        // Mark transaction as reconciled — freezing the per-row rate.
        await db.transaction.update({
          where: { id: tx.id },
          data: {
            status: 'reconciled',
            matchRef: entry.id,
            currency: rowCurrency,
            fxRate: fxRate,
            amountHome: amountHome,
          },
        });

        // Update financial account balance
        if (glCode) {
          const finAcct = await db.financialAccount.findFirst({ where: { glAccountCode: glCode, companyId: tx.companyId } });
          if (finAcct) {
            await db.financialAccount.update({
              where: { id: finAcct.id },
              data: { currentBalance: { increment: Number(tx.amount) } },
            });
          }
        }

        posted.push(tx.id);
      } catch (txError: any) {
        // A single transaction's linked account being unresolved shouldn't
        // block the rest of the batch from posting.
        failed.push({ id: tx.id, error: txError.message || 'Failed to post' });
      }
    }

    await auditLog(companyId, userId, 'transaction.post_gl', 'transaction', undefined, { postedIds: posted, skippedIds: skipped, closedPeriodIds: closedPeriod, failedIds: failed.map((f) => f.id) });

    return NextResponse.json({
      data: {
        posted: posted.length, skipped: skipped.length, closedPeriod: closedPeriod.length, failed: failed.length,
        postedIds: posted, skippedIds: skipped, closedPeriodIds: closedPeriod, failedTransactions: failed,
      },
    });
  } catch (error: any) {
    console.error('POST /api/transactions/post-gl error:', error);
    return NextResponse.json({ error: error.message || 'Failed to post to GL' }, { status: 500 });
  }
}
