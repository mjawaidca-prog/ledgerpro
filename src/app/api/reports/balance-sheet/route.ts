import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { getGLActivity, normalBalance, endOfDay } from '@/lib/reporting';
export const dynamic = 'force-dynamic';

type Acct = { code: string; name: string; type: string; subType: string | null; detailType: string | null };

// Falls back to the old code-range heuristic only when an account has no
// subType set — lets existing pre-migration accounts keep classifying
// sensibly without requiring every company to backfill immediately.
function isCurrent(a: Acct): boolean {
  if (a.subType) return a.subType === 'current_asset' || a.subType === 'current_liability';
  const n = parseInt(a.code, 10);
  return a.type === 'asset' ? n < 2000 : n >= 2000 && n < 3000;
}

function equityBucket(a: Acct): 'common_shares' | 'retained_earnings' | 'owners_equity' | 'other_equity' {
  if (a.subType === 'common_shares') return 'common_shares';
  if (a.subType === 'retained_earnings') return 'retained_earnings';
  if (a.subType === 'owners_equity') return 'owners_equity';
  if (a.subType === 'other_equity') return 'other_equity';
  // heuristic fallback for unclassified accounts
  const name = a.name.toLowerCase();
  if (name.includes('retained earnings')) return 'retained_earnings';
  if (name.includes('common share') || name.includes('share capital')) return 'common_shares';
  return 'owners_equity';
}

async function buildBalanceSheet(companyId: string, asOfDate: Date) {
  const [company, accounts, activity] = await Promise.all([
    db.company.findUnique({ where: { id: companyId }, select: { name: true, legalName: true } }),
    db.chartOfAccount.findMany({
      where: { type: { in: ['asset', 'liability', 'equity'] }, active: true, companyId },
      orderBy: { code: 'asc' },
    }),
    getGLActivity(companyId, { to: endOfDay(asOfDate) }),
  ]);

  const withBalance = accounts.map((a) => ({
    code: a.code,
    name: a.name,
    detailType: a.detailType,
    subType: a.subType,
    type: a.type,
    balance: Math.round(normalBalance(a.type as any, activity[a.code]) * 100) / 100,
  }));

  const assets = withBalance.filter((a) => a.type === 'asset');
  const liabilities = withBalance.filter((a) => a.type === 'liability');
  const equity = withBalance.filter((a) => a.type === 'equity');

  const currentAssets = assets.filter((a) => isCurrent(a));
  const nonCurrentAssets = assets.filter((a) => !isCurrent(a));
  const currentLiabilities = liabilities.filter((a) => isCurrent(a));
  const nonCurrentLiabilities = liabilities.filter((a) => !isCurrent(a));

  const totalCurrentAssets = currentAssets.reduce((s, a) => s + a.balance, 0);
  const totalNonCurrentAssets = nonCurrentAssets.reduce((s, a) => s + a.balance, 0);
  const totalAssets = totalCurrentAssets + totalNonCurrentAssets;

  const totalCurrentLiabilities = currentLiabilities.reduce((s, a) => s + a.balance, 0);
  const totalNonCurrentLiabilities = nonCurrentLiabilities.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = totalCurrentLiabilities + totalNonCurrentLiabilities;

  const equityGroups: Record<string, typeof equity> = { common_shares: [], retained_earnings: [], owners_equity: [], other_equity: [] };
  for (const a of equity) equityGroups[equityBucket(a)].push(a);
  const equityTotals = Object.fromEntries(
    Object.entries(equityGroups).map(([k, v]) => [k, v.reduce((s, a) => s + a.balance, 0)])
  );
  const totalEquity = equity.reduce((s, a) => s + a.balance, 0);

  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;

  return {
    companyName: company?.legalName || company?.name || '',
    isBalanced,
    assets: {
      current: { accounts: currentAssets, total: totalCurrentAssets },
      nonCurrent: { accounts: nonCurrentAssets, total: totalNonCurrentAssets },
      total: totalAssets,
    },
    liabilities: {
      current: { accounts: currentLiabilities, total: totalCurrentLiabilities },
      nonCurrent: { accounts: nonCurrentLiabilities, total: totalNonCurrentLiabilities },
      total: totalLiabilities,
    },
    equity: {
      commonShares: { accounts: equityGroups.common_shares, total: equityTotals.common_shares },
      retainedEarnings: { accounts: equityGroups.retained_earnings, total: equityTotals.retained_earnings },
      ownersEquity: { accounts: equityGroups.owners_equity, total: equityTotals.owners_equity },
      otherEquity: { accounts: equityGroups.other_equity, total: equityTotals.other_equity },
      total: totalEquity,
    },
    totalLiabilitiesAndEquity,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    const compare = searchParams.get('compare') === 'true';

    const current = await buildBalanceSheet(companyId, new Date(asOf));

    let prior = null;
    if (compare) {
      const priorAsOf = new Date(asOf);
      priorAsOf.setFullYear(priorAsOf.getFullYear() - 1);
      prior = { asOf: priorAsOf.toISOString().slice(0, 10), ...(await buildBalanceSheet(companyId, priorAsOf)) };
    }

    return NextResponse.json({ data: { asOf, ...current, prior } });
  } catch (error) {
    console.error('GET /api/reports/balance-sheet error:', error);
    return NextResponse.json({ error: 'Failed to generate balance sheet' }, { status: 500 });
  }
}
