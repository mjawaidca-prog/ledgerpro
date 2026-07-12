import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { getGLActivity, normalBalance, endOfDay, fiscalYearRangeForLabel } from '@/lib/reporting';
export const dynamic = 'force-dynamic';

// ── Types ──

interface AccountItem {
  code: string;
  name: string;
  isCOGS?: boolean;
  amount: number;
}

interface SectionRow {
  code: string;
  name: string;
  amount: number;
  priorAmount: number;
  changePct: number;
  /** arrow direction: 'up' | 'down' | 'flat' */
  direction: 'up' | 'down' | 'flat';
  /** whether this change is good for the business */
  favorable: boolean | null;
}

interface Section {
  rows: SectionRow[];
  total: number;
  priorTotal: number;
  changePct: number;
  direction: 'up' | 'down' | 'flat';
  favorable: boolean | null;
}

interface HighlightRow {
  amount: number;
  priorAmount: number;
  changePct: number;
  direction: 'up' | 'down' | 'flat';
  favorable: boolean | null;
  marginPct: number;
}

interface PnLSections {
  income: Section;
  cogs: Section;
  grossProfit: HighlightRow;
  operatingExpenses: Section;
  netIncome: HighlightRow;
}

// ── Helpers ──

function isCOGS(acct: { code: string; detailType: string | null }): boolean {
  if (acct.detailType) return acct.detailType.trim().toLowerCase() === 'cogs';
  return acct.code === '5000';
}

/** Compute % change and favorability for a single amount vs prior */
function compareRow(
  amount: number,
  priorAmount: number,
  /** 'income' = increase is good, 'expense' = decrease is good, 'profit' = increase is good */
  favorabilityType: 'income' | 'expense' | 'profit'
): Pick<SectionRow, 'priorAmount' | 'changePct' | 'direction' | 'favorable'> {
  const diff = amount - priorAmount;
  const pct = priorAmount !== 0
    ? Math.round((diff / Math.abs(priorAmount)) * 1000) / 10
    : (amount !== 0 ? 100 : 0);

  const direction: 'up' | 'down' | 'flat' = diff > 0.005 ? 'up' : diff < -0.005 ? 'down' : 'flat';

  let favorable: boolean | null = null;
  if (direction !== 'flat') {
    if (favorabilityType === 'income' || favorabilityType === 'profit') {
      favorable = direction === 'up';
    } else {
      // expenses: decrease is good
      favorable = direction === 'down';
    }
  }

  return { priorAmount, changePct: pct, direction, favorable };
}

/** Build section rows with comparison data */
function buildSection(
  items: { code: string; name: string; amount: number }[],
  priorItems: { code: string; amount: number }[],
  favorabilityType: 'income' | 'expense'
): Section {
  const priorMap = new Map(priorItems.map(p => [p.code, p.amount]));

  const rows: SectionRow[] = items.map(item => {
    const priorAmount = priorMap.get(item.code) ?? 0;
    return {
      code: item.code,
      name: item.name,
      amount: Math.round(item.amount * 100) / 100,
      ...compareRow(item.amount, priorAmount, favorabilityType),
    };
  });

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const priorTotal = rows.reduce((s, r) => s + r.priorAmount, 0);

  return {
    rows,
    total: Math.round(total * 100) / 100,
    priorTotal: Math.round(priorTotal * 100) / 100,
    ...compareRow(total, priorTotal, favorabilityType),
  };
}

// ── Build ──

async function buildPeriodTotals(companyId: string, startDate: Date, endDate: Date) {
  const [incomeAccounts, expenseAccounts, activity] = await Promise.all([
    db.chartOfAccount.findMany({ where: { type: 'income', active: true, companyId }, orderBy: { code: 'asc' } }),
    db.chartOfAccount.findMany({ where: { type: 'expense', active: true, companyId }, orderBy: { code: 'asc' } }),
    getGLActivity(companyId, { from: startDate, to: endOfDay(endDate) }),
  ]);

  const revenueByAccount: AccountItem[] = incomeAccounts.map((acct) => ({
    code: acct.code,
    name: acct.name,
    amount: normalBalance(acct.type, activity[acct.code]),
  }));

  const expensesByAccount: AccountItem[] = expenseAccounts.map((acct) => ({
    code: acct.code,
    name: acct.name,
    isCOGS: isCOGS(acct),
    amount: normalBalance(acct.type, activity[acct.code]),
  }));

  return { revenueByAccount, expensesByAccount };
}

// ── Route ──

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const startParam = searchParams.get('startDate');
    const endParam = searchParams.get('endDate');
    const compare = searchParams.get('compare') || 'none'; // 'prior_period' | 'prior_year' | 'none'

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { name: true, legalName: true, fiscalYearStart: true, currency: true },
    });
    const fyAnchor = company?.fiscalYearStart ?? new Date(new Date().getFullYear(), 0, 1);
    const currency = company?.currency || 'USD';

    let startDate: Date;
    let endDate: Date;
    let year: string;

    if (startParam && endParam) {
      startDate = new Date(startParam);
      endDate = new Date(endParam);
      year = `${startParam} – ${endParam}`;
    } else {
      year = searchParams.get('year') ?? new Date().getFullYear().toString();
      const range = fiscalYearRangeForLabel(fyAnchor, Number(year));
      startDate = range.start;
      endDate = range.end;
    }

    const current = await buildPeriodTotals(companyId, startDate, endDate);

    // ── Prior period / year ──
    let prior: Awaited<ReturnType<typeof buildPeriodTotals>> | null = null;
    let comparisonLabel = '';
    let comparisonMode = 'none';

    if (compare === 'prior_year' || compare === 'prior_period') {
      comparisonMode = compare;
      let priorStart: Date;
      let priorEnd: Date;

      if (compare === 'prior_year') {
        priorStart = new Date(startDate);
        priorStart.setFullYear(priorStart.getFullYear() - 1);
        priorEnd = new Date(endDate);
        priorEnd.setFullYear(priorEnd.getFullYear() - 1);
      } else {
        // prior_period: previous period of equal duration
        const durationMs = endDate.getTime() - startDate.getTime();
        priorEnd = new Date(startDate.getTime() - 86400000); // day before current start
        priorStart = new Date(priorEnd.getTime() - durationMs);
      }

      comparisonLabel = `${priorStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${priorEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      prior = await buildPeriodTotals(companyId, priorStart, priorEnd);
    }

    // ── Build structured sections ──

    const incomeItems = current.revenueByAccount.map(r => ({ code: r.code, name: r.name, amount: r.amount }));
    const priorIncomeItems = prior
      ? prior.revenueByAccount.map(r => ({ code: r.code, amount: r.amount }))
      : [];

    const cogsItems = current.expensesByAccount
      .filter(e => e.isCOGS)
      .map(e => ({ code: e.code, name: e.name, amount: e.amount }));
    const priorCogsItems = prior
      ? prior.expensesByAccount.filter(e => e.isCOGS).map(e => ({ code: e.code, amount: e.amount }))
      : [];

    const opexItems = current.expensesByAccount
      .filter(e => !e.isCOGS)
      .map(e => ({ code: e.code, name: e.name, amount: e.amount }));
    const priorOpexItems = prior
      ? prior.expensesByAccount.filter(e => !e.isCOGS).map(e => ({ code: e.code, amount: e.amount }))
      : [];

    const income = buildSection(incomeItems, priorIncomeItems, 'income');
    const cogs = buildSection(cogsItems, priorCogsItems, 'expense');
    const operatingExpenses = buildSection(opexItems, priorOpexItems, 'expense');

    // Gross profit
    const gpAmount = income.total - cogs.total;
    const gpPriorAmount = prior ? income.priorTotal - cogs.priorTotal : 0;

    const grossProfit: HighlightRow = {
      amount: Math.round(gpAmount * 100) / 100,
      priorAmount: Math.round(gpPriorAmount * 100) / 100,
      marginPct: income.total > 0 ? Math.round((gpAmount / income.total) * 1000) / 10 : 0,
      ...compareRow(gpAmount, gpPriorAmount, 'profit'),
    };

    // Net income
    const niAmount = gpAmount - operatingExpenses.total;
    const niPriorAmount = prior ? gpPriorAmount - operatingExpenses.priorTotal : 0;

    const netIncome: HighlightRow = {
      amount: Math.round(niAmount * 100) / 100,
      priorAmount: Math.round(niPriorAmount * 100) / 100,
      marginPct: income.total > 0 ? Math.round((niAmount / income.total) * 1000) / 10 : 0,
      ...compareRow(niAmount, niPriorAmount, 'profit'),
    };

    const sections: PnLSections = {
      income,
      cogs,
      grossProfit,
      operatingExpenses,
      netIncome,
    };

    // Period label for display
    const periodLabel = `${startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} – ${endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

    return NextResponse.json({
      data: {
        companyName: company?.legalName || company?.name || '',
        currency,
        period: { startDate: startDate.toISOString().slice(0, 10), endDate: endDate.toISOString().slice(0, 10), label: periodLabel },
        comparisonLabel,
        comparisonMode,
        generatedAt: new Date().toISOString(),
        sections,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/profit-loss error:', error);
    return NextResponse.json({ error: 'Failed to generate P&L' }, { status: 500 });
  }
}
