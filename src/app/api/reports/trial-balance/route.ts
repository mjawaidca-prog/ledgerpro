import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { getGLActivity, endOfDay } from '@/lib/reporting';
export const dynamic = 'force-dynamic';

async function buildTrialBalance(companyId: string, asOfDate: Date) {
  const [accounts, activity, jeCount] = await Promise.all([
    db.chartOfAccount.findMany({ where: { active: true, companyId }, orderBy: { code: 'asc' } }),
    getGLActivity(companyId, { to: asOfDate }),
    db.journalEntry.count({ where: { entryDate: { lte: asOfDate }, companyId } }),
  ]);

  const rows = accounts.map((acct) => {
    const act = activity[acct.code] || { debits: 0, credits: 0 };
    let debitBalance = 0;
    let creditBalance = 0;

    if (acct.type === 'asset' || acct.type === 'expense') {
      const net = act.debits - act.credits;
      if (net >= 0) debitBalance = net;
      else creditBalance = Math.abs(net);
    } else {
      const net = act.credits - act.debits;
      if (net >= 0) creditBalance = net;
      else debitBalance = Math.abs(net);
    }

    return {
      code: acct.code,
      name: acct.name,
      type: acct.type,
      detailType: acct.detailType,
      gifiCode: acct.gifiCode,
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

  return { rows, grouped, totalDebits, totalCredits, isBalanced, accountCount: rows.length, journalEntryCount: jeCount };
}

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    const compare = searchParams.get('compare') === 'true';
    const asOfDate = endOfDay(new Date(asOf));

    const current = await buildTrialBalance(companyId, asOfDate);

    let prior = null;
    if (compare) {
      const priorAsOfDate = new Date(asOfDate);
      priorAsOfDate.setFullYear(priorAsOfDate.getFullYear() - 1);
      const priorTB = await buildTrialBalance(companyId, priorAsOfDate);
      prior = { asOf: priorAsOfDate.toISOString().slice(0, 10), ...priorTB };
    }

    return NextResponse.json({ data: { asOf, ...current, prior } });
  } catch (error) {
    console.error('GET /api/reports/trial-balance error:', error);
    return NextResponse.json({ error: 'Failed to generate trial balance' }, { status: 500 });
  }
}
