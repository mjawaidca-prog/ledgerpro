import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    const asOfDate = new Date(asOf);
    asOfDate.setHours(23, 59, 59, 999);

    // Get all active GL accounts
    const accounts = await db.chartOfAccount.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
    });

    // Get ALL journal lines up to asOf date
    const journalLines = await db.journalLine.findMany({
      where: {
        journalEntry: { entryDate: { lte: asOfDate } },
      },
      select: { glAccountCode: true, debit: true, credit: true },
    });

    // Aggregate debits/credits per GL account
    const activity: Record<string, { debits: number; credits: number }> = {};
    for (const line of journalLines) {
      if (!activity[line.glAccountCode]) {
        activity[line.glAccountCode] = { debits: 0, credits: 0 };
      }
      activity[line.glAccountCode].debits += Number(line.debit);
      activity[line.glAccountCode].credits += Number(line.credit);
    }

    // Build trial balance rows — balances come ONLY from journal entries
    const rows = accounts.map((acct) => {
      const act = activity[acct.code] || { debits: 0, credits: 0 };
      let debitBalance = 0;
      let creditBalance = 0;

      if (acct.type === 'asset' || acct.type === 'expense') {
        // Normal debit balance
        const net = act.debits - act.credits;
        if (net >= 0) debitBalance = net;
        else creditBalance = Math.abs(net);
      } else {
        // Normal credit balance (liability, equity, income)
        const net = act.credits - act.debits;
        if (net >= 0) creditBalance = net;
        else debitBalance = Math.abs(net);
      }

      return {
        code: acct.code,
        name: acct.name,
        type: acct.type,
        detailType: acct.detailType,
        debit: Math.round(debitBalance * 100) / 100,
        credit: Math.round(creditBalance * 100) / 100,
        hasActivity: act.debits > 0 || act.credits > 0,
        link: `/reports/general-ledger?code=${acct.code}&name=${encodeURIComponent(acct.name)}`,
      };
    });

    const totalDebits = Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100;
    const totalCredits = Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;
    const isBalanced = Math.abs(totalDebits - totalCredits) < 0.02;

    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) {
      if (!grouped[row.type]) grouped[row.type] = [];
      grouped[row.type].push(row);
    }

    const jeCount = await db.journalEntry.count({
      where: { entryDate: { lte: asOfDate } },
    });

    return NextResponse.json({
      data: {
        asOf,
        rows,
        grouped,
        totalDebits,
        totalCredits,
        isBalanced,
        accountCount: rows.length,
        journalEntryCount: jeCount,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/trial-balance error:', error);
    return NextResponse.json({ error: 'Failed to generate trial balance' }, { status: 500 });
  }
}
