import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST — post categorized bank transactions to the General Ledger
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transactionIds } = body as { transactionIds: string[] };

    if (!transactionIds?.length) {
      return NextResponse.json({ error: 'No transaction IDs provided' }, { status: 400 });
    }

    const transactions = await db.transaction.findMany({
      where: { id: { in: transactionIds }, status: 'categorized' },
      include: { account: { select: { glAccountCode: true } }, category: { select: { code: true, name: true } } },
    });

    if (transactions.length === 0) {
      return NextResponse.json({ error: 'No categorized transactions found' }, { status: 400 });
    }

    const posted: string[] = [];
    const skipped: string[] = [];

    for (const tx of transactions) {
      if (tx.status !== 'categorized' || !tx.category) {
        skipped.push(tx.id);
        continue;
      }

      const glCode = tx.account?.glAccountCode;
      const catCode = tx.category.code;
      const amount = Math.abs(Number(tx.amount));
      const isInflow = Number(tx.amount) > 0;

      // Determine GL accounts based on transaction type
      let entryLines: { code: string; description: string; debit: number; credit: number }[];

      if (isInflow) {
        // Money coming in: Debit Bank, Credit Income category
        entryLines = [
          { code: glCode || '1010', description: tx.description, debit: amount, credit: 0 },
          { code: catCode, description: `Revenue — ${tx.description}`, debit: 0, credit: amount },
        ];
      } else {
        // Money going out: Debit Expense category, Credit Bank
        entryLines = [
          { code: catCode, description: tx.description, debit: amount, credit: 0 },
          { code: glCode || '1010', description: `Payment — ${tx.description}`, debit: 0, credit: amount },
        ];
      }

      // Create journal entry
      const entry = await db.journalEntry.create({
        data: {
          companyId: tx.companyId,
          entryDate: new Date(tx.date),
          description: tx.description,
          sourceType: 'payment',
          sourceId: tx.id,
          lines: {
            create: entryLines.map((l) => ({
              glAccountCode: l.code,
              description: l.description,
              debit: l.debit,
              credit: l.credit,
            })),
          },
        },
      });

      // Update GL balances
      for (const l of entryLines) {
        const acct = await db.chartOfAccount.findFirst({ where: { code: l.code } });
        if (!acct) continue;
        const net = l.debit - l.credit;
        const balanceChange = (acct.type === 'asset' || acct.type === 'expense') ? net : -net;
        await db.chartOfAccount.update({
          where: { id: acct.id },
          data: { balance: { increment: balanceChange } },
        });
        // Update parent
        if (acct.parentCode) {
          await db.chartOfAccount.updateMany({
            where: { code: acct.parentCode, companyId: tx.companyId },
            data: { balance: { increment: balanceChange } },
          });
        }
      }

      // Mark transaction as reconciled
      await db.transaction.update({
        where: { id: tx.id },
        data: { status: 'reconciled', matchRef: entry.id },
      });

      // Update financial account balance
      if (glCode) {
        const finAcct = await db.financialAccount.findFirst({ where: { glAccountCode: glCode } });
        if (finAcct) {
          await db.financialAccount.update({
            where: { id: finAcct.id },
            data: { currentBalance: { increment: Number(tx.amount) } },
          });
        }
      }

      posted.push(tx.id);
    }

    return NextResponse.json({
      data: { posted: posted.length, skipped: skipped.length, postedIds: posted, skippedIds: skipped },
    });
  } catch (error) {
    console.error('POST /api/transactions/post-gl error:', error);
    return NextResponse.json({ error: 'Failed to post to GL' }, { status: 500 });
  }
}
