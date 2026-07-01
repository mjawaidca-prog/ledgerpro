import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// POST — set opening balance on a financial account
export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const { accountId, amount, date } = body as { accountId: string; amount: number; date: string };

    if (!accountId || amount === undefined || !date) {
      return NextResponse.json({ error: 'accountId, amount, and date are required' }, { status: 400 });
    }

    const account = await db.financialAccount.findUnique({ where: { id: accountId, companyId } });
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    // Get or create Opening Balance Equity account (3900)
    let equityAcct = await db.chartOfAccount.findFirst({
      where: { code: '3900', companyId },
    });
    if (!equityAcct) {
      equityAcct = await db.chartOfAccount.create({
        data: {
          companyId,
          code: '3900',
          name: 'Opening Balance Equity',
          type: 'equity',
          detailType: 'Opening balance offset',
          balance: 0,
          active: true,
        },
      });
    }

    const glCode = account.glAccountCode || '1000';
    const bankAcct = await db.chartOfAccount.findFirst({
      where: { code: glCode, companyId },
    });
    if (!bankAcct) {
      return NextResponse.json({ error: `GL account ${glCode} not found` }, { status: 400 });
    }

    const absAmount = Math.abs(amount);
    const isPositive = amount > 0;

    // Debit bank (asset increase), Credit opening balance equity
    const lines = [
      {
        glAccountCode: bankAcct.code,
        description: `Opening balance — ${account.name}`,
        debit: isPositive ? absAmount : 0,
        credit: isPositive ? 0 : absAmount,
      },
      {
        glAccountCode: equityAcct.code,
        description: `Opening balance offset — ${account.name}`,
        debit: isPositive ? 0 : absAmount,
        credit: isPositive ? absAmount : 0,
      },
    ];

    const entry = await db.journalEntry.create({
      data: {
        companyId,
        entryDate: new Date(date),
        description: `Opening balance — ${account.name}`,
        sourceType: 'manual',
        lines: { create: lines },
      },
    });

    // Update COA balances
    for (const line of lines) {
      const acct = await db.chartOfAccount.findFirst({ where: { code: line.glAccountCode, companyId } });
      if (!acct) continue;
      const net = line.debit - line.credit;
      const balanceChange = (acct.type === 'asset' || acct.type === 'expense') ? net : -net;
      await db.chartOfAccount.update({
        where: { id: acct.id },
        data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
      });
      if (acct.parentCode) {
        await db.chartOfAccount.updateMany({
          where: { code: acct.parentCode, companyId },
          data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
        });
      }
    }

    // Update financial account balance
    await db.financialAccount.update({
      where: { id: accountId },
      data: { currentBalance: { increment: amount } },
    });

    return NextResponse.json({ data: { entry, newBalance: Number(account.currentBalance) + amount } });
  } catch (err: any) {
    console.error('POST /api/accounts/opening-balance error:', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
