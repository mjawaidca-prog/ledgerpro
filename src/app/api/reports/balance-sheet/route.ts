import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { getGLActivity, normalBalance, endOfDay, fiscalYearStartFor, parseLocalDate } from '@/lib/reporting';
export const dynamic = 'force-dynamic';

// ── Types ──

type Acct = { code: string; name: string; type: string; subType: string | null; detailType: string | null };

interface AccountLine { code: string; name: string; detailType: string | null; balance: number; priorBalance: number; changePct: number; direction: 'up' | 'down' | 'flat'; favorable: boolean | null; }
interface SubSection { accounts: AccountLine[]; total: number; priorTotal: number; changePct: number; direction: 'up' | 'down' | 'flat'; favorable: boolean | null; }
interface EquityGroup { accounts: AccountLine[]; total: number; priorTotal: number; changePct: number; direction: 'up' | 'down' | 'flat'; favorable: boolean | null; }

// ── Helpers ──

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
  const name = a.name.toLowerCase();
  if (name.includes('retained earnings')) return 'retained_earnings';
  if (name.includes('common share') || name.includes('share capital')) return 'common_shares';
  return 'owners_equity';
}

function compareVal(current: number, prior: number) {
  const diff = current - prior;
  const pct = prior !== 0 ? Math.round((diff / Math.abs(prior)) * 1000) / 10 : (current !== 0 ? 100 : 0);
  const direction: 'up' | 'down' | 'flat' = diff > 0.005 ? 'up' : diff < -0.005 ? 'down' : 'flat';
  let favorable: boolean | null = null;
  if (direction !== 'flat') favorable = direction === 'up'; // higher assets/equity = favorable
  return { priorAmount: prior, changePct: pct, direction, favorable };
}

function enrichAccounts(accounts: { code: string; name: string; detailType: string | null; balance: number }[], priorMap: Map<string, number>): AccountLine[] {
  return accounts.map(a => {
    const prior = priorMap.get(a.code) ?? 0;
    return { ...a, priorBalance: Math.round(prior * 100) / 100, ...compareVal(a.balance, prior) };
  });
}

function buildSubSection(accounts: AccountLine[]): SubSection {
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const priorTotal = accounts.reduce((s, a) => s + a.priorBalance, 0);
  const t = Math.round(total * 100) / 100;
  const pt = Math.round(priorTotal * 100) / 100;
  return { accounts, total: t, priorTotal: pt, ...compareVal(t, pt) };
}

// ── Build ──

async function buildBalanceSheet(companyId: string, asOfDate: Date) {
  const [company, accounts, incomeExpenseAccounts, activity] = await Promise.all([
    db.company.findUnique({ where: { id: companyId }, select: { name: true, legalName: true, fiscalYearStart: true } }),
    db.chartOfAccount.findMany({ where: { type: { in: ['asset', 'liability', 'equity'] }, active: true, companyId }, orderBy: { code: 'asc' } }),
    db.chartOfAccount.findMany({ where: { type: { in: ['income', 'expense'] }, active: true, companyId }, select: { code: true, type: true } }),
    getGLActivity(companyId, { to: endOfDay(asOfDate) }),
  ]);

  const fyStart = company ? fiscalYearStartFor(company.fiscalYearStart, asOfDate) : new Date(asOfDate.getFullYear(), 0, 1);
  const yearActivity = await getGLActivity(companyId, { from: fyStart, to: endOfDay(asOfDate) });
  const currentYearEarnings = Math.round(
    incomeExpenseAccounts.reduce((s, a) => { const bal = normalBalance(a.type, yearActivity[a.code]); return s + (a.type === 'income' ? bal : -bal); }, 0) * 100
  ) / 100;

  const withBalance = accounts.map(a => ({ code: a.code, name: a.name, detailType: a.detailType, subType: a.subType, type: a.type, balance: Math.round(normalBalance(a.type as any, activity[a.code]) * 100) / 100 }));

  const assets = withBalance.filter(a => a.type === 'asset');
  const liabilities = withBalance.filter(a => a.type === 'liability');
  const equity = withBalance.filter(a => a.type === 'equity');

  const currentAssets = assets.filter(a => isCurrent(a));
  const nonCurrentAssets = assets.filter(a => !isCurrent(a));
  const currentLiabilities = liabilities.filter(a => isCurrent(a));
  const nonCurrentLiabilities = liabilities.filter(a => !isCurrent(a));

  const equityGroups: Record<string, typeof equity> = { common_shares: [], retained_earnings: [], owners_equity: [], other_equity: [] };
  for (const a of equity) equityGroups[equityBucket(a)].push(a);
  if (currentYearEarnings !== 0) equityGroups.retained_earnings.push({ code: '', name: 'Current Year Earnings', detailType: null, subType: 'retained_earnings', type: 'equity', balance: currentYearEarnings });

  const companyName = company?.legalName || company?.name || '';
  const totalAssets = currentAssets.reduce((s,a) => s+a.balance, 0) + nonCurrentAssets.reduce((s,a) => s+a.balance, 0);
  const totalLiabilities = currentLiabilities.reduce((s,a) => s+a.balance, 0) + nonCurrentLiabilities.reduce((s,a) => s+a.balance, 0);
  const totalEquity = equity.reduce((s,a) => s+a.balance, 0) + currentYearEarnings;
  const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

  return { companyName, currentAssets, nonCurrentAssets, currentLiabilities, nonCurrentLiabilities, equityGroups, totalAssets, totalLiabilities, totalEquity, isBalanced };
}

type RawBS = Awaited<ReturnType<typeof buildBalanceSheet>>;

// ── Route ──

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    const compare = searchParams.get('compare') || 'none';

    const asOfDate = endOfDay(parseLocalDate(asOfParam));
    const asOf = asOfDate.toISOString().slice(0, 10);

    const company = await db.company.findUnique({ where: { id: companyId }, select: { currency: true } });
    const currency = company?.currency || 'USD';

    const current = await buildBalanceSheet(companyId, asOfDate);

    let prior: RawBS | null = null;
    let comparisonLabel = '';
    let comparisonMode = 'none';

    if (compare === 'prior_year' || compare === 'prior_period') {
      comparisonMode = compare;
      let priorDate: Date;
      if (compare === 'prior_year') { priorDate = new Date(asOfDate); priorDate.setFullYear(priorDate.getFullYear() - 1); }
      else { priorDate = new Date(asOfDate.getTime() - 365 * 86400000); }
      comparisonLabel = priorDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      prior = await buildBalanceSheet(companyId, priorDate);
    }

    // Build prior balance maps
    const priorAssetMap = new Map<string, number>();
    const priorLiabMap = new Map<string, number>();
    const priorEquityMap = new Map<string, number>();
    if (prior) {
      for (const a of [...prior.currentAssets, ...prior.nonCurrentAssets]) priorAssetMap.set(a.code, a.balance);
      for (const l of [...prior.currentLiabilities, ...prior.nonCurrentLiabilities]) priorLiabMap.set(l.code, l.balance);
      for (const [, group] of Object.entries(prior.equityGroups)) for (const e of group) priorEquityMap.set(e.code || e.name, e.balance);
    }

    // Enrich
    const ca = enrichAccounts(current.currentAssets.map(({subType,type,...a}) => a), priorAssetMap);
    const nca = enrichAccounts(current.nonCurrentAssets.map(({subType,type,...a}) => a), priorAssetMap);
    const cl = enrichAccounts(current.currentLiabilities.map(({subType,type,...a}) => a), priorLiabMap);
    const ncl = enrichAccounts(current.nonCurrentLiabilities.map(({subType,type,...a}) => a), priorLiabMap);

    const currentAssetsSec = buildSubSection(ca);
    const nonCurrentAssetsSec = buildSubSection(nca);
    const assetsTotal = Math.round((currentAssetsSec.total + nonCurrentAssetsSec.total) * 100) / 100;
    const assetsPriorTotal = Math.round((currentAssetsSec.priorTotal + nonCurrentAssetsSec.priorTotal) * 100) / 100;

    const currentLiabSec = buildSubSection(cl);
    const nonCurrentLiabSec = buildSubSection(ncl);
    const liabTotal = Math.round((currentLiabSec.total + nonCurrentLiabSec.total) * 100) / 100;
    const liabPriorTotal = Math.round((currentLiabSec.priorTotal + nonCurrentLiabSec.priorTotal) * 100) / 100;

    const equitySections: Record<string, EquityGroup> = {};
    for (const [key, group] of Object.entries(current.equityGroups)) {
      const enriched = enrichAccounts(group.map(({subType,type,...a}) => ({...a, detailType: a.detailType})), priorEquityMap);
      equitySections[key] = { ...buildSubSection(enriched), accounts: enriched };
    }
    const eqTotal = Object.values(equitySections).reduce((s, g) => s + g.total, 0);
    const eqPriorTotal = Object.values(equitySections).reduce((s, g) => s + g.priorTotal, 0);

    const totalLiabEquity = Math.round((liabTotal + eqTotal) * 100) / 100;
    const priorLiabEquity = Math.round((liabPriorTotal + eqPriorTotal) * 100) / 100;

    const periodLabel = asOfDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    return NextResponse.json({
      data: {
        companyName: current.companyName,
        currency,
        period: { asOf, label: periodLabel },
        comparisonLabel,
        comparisonMode,
        generatedAt: new Date().toISOString(),
        sections: {
          assets: {
            current: currentAssetsSec,
            nonCurrent: nonCurrentAssetsSec,
            total: assetsTotal,
            priorTotal: assetsPriorTotal,
            changePct: assetsPriorTotal !== 0 ? Math.round(((assetsTotal - assetsPriorTotal) / Math.abs(assetsPriorTotal)) * 1000) / 10 : (assetsTotal !== 0 ? 100 : 0),
          },
          liabilities: {
            current: currentLiabSec,
            nonCurrent: nonCurrentLiabSec,
            total: liabTotal,
            priorTotal: liabPriorTotal,
            changePct: liabPriorTotal !== 0 ? Math.round(((liabTotal - liabPriorTotal) / Math.abs(liabPriorTotal)) * 1000) / 10 : (liabTotal !== 0 ? 100 : 0),
          },
          equity: equitySections,
          totalEquity: eqTotal,
          priorTotalEquity: eqPriorTotal,
          totalLiabilitiesAndEquity: totalLiabEquity,
          priorTotalLiabilitiesAndEquity: priorLiabEquity,
        },
        isBalanced: current.isBalanced,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/balance-sheet error:', error);
    return NextResponse.json({ error: 'Failed to generate balance sheet' }, { status: 500 });
  }
}
