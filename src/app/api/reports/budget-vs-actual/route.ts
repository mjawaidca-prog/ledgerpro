import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// ── Types ──

interface BVRow {
  glAccountCode: string;
  accountName: string;
  accountType: string;
  budgetAmount: number;
  actualAmount: number;
  variance: number;
  variancePct: number;
  isOverBudget: boolean;
  direction: 'up' | 'down' | 'flat';
  favorable: boolean | null;
}

interface BVSection {
  rows: BVRow[];
  totalBudget: number;
  totalActual: number;
  totalVariance: number;
  variancePct: number;
  direction: 'up' | 'down' | 'flat';
  favorable: boolean | null;
}

// ── Helpers ──

function compareRow(actual: number, budget: number) {
  const variance = actual - budget;
  const pct = budget > 0 ? Math.round((variance / budget) * 1000) / 10 : (actual !== 0 ? 100 : 0);
  const direction: 'up' | 'down' | 'flat' = variance > 0.005 ? 'up' : variance < -0.005 ? 'down' : 'flat';
  return { variance, variancePct: pct, direction, isOverBudget: variance > 0 };
}

// ── Route ──

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { name: true, legalName: true, currency: true },
    });

    const { searchParams } = new URL(req.url);
    const budgetId = searchParams.get('budgetId');

    if (!budgetId) {
      // Return list of budgets for the picker
      const budgets = await db.budget.findMany({
        where: { companyId },
        orderBy: { fiscalYear: 'desc' },
        select: { id: true, name: true, fiscalYear: true, period: true },
      });
      return NextResponse.json({ data: { budgets } });
    }

    const budget = await db.budget.findUnique({
      where: { id: budgetId },
      include: { lines: true },
    });
    if (!budget || budget.companyId !== companyId) {
      return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
    }

    const accountCodes = budget.lines.map(l => l.glAccountCode);
    const actuals = await db.chartOfAccount.findMany({
      where: { companyId, code: { in: accountCodes } },
      select: { code: true, name: true, balance: true, type: true },
    });
    const actualMap = new Map(actuals.map(a => [a.code, a]));

    const rows: BVRow[] = budget.lines.map(line => {
      const actual = actualMap.get(line.glAccountCode);
      const actualBalance = actual ? Math.abs(Number(actual.balance)) : 0;
      const budgetAmount = Number(line.amount);
      const cmp = compareRow(actualBalance, budgetAmount);
      // For expenses: under budget = favorable (spent less than planned)
      // For income: over budget = favorable (earned more than planned)
      const isIncome = actual?.type === 'income';
      const favorable = cmp.direction === 'flat' ? null : (
        isIncome ? cmp.isOverBudget : !cmp.isOverBudget
      );

      return {
        glAccountCode: line.glAccountCode,
        accountName: actual?.name || line.glAccountCode,
        accountType: actual?.type || 'expense',
        budgetAmount,
        actualAmount: actualBalance,
        favorable,
        ...cmp,
      };
    });

    // Group by income vs expense
    const incomeRows = rows.filter(r => r.accountType === 'income');
    const expenseRows = rows.filter(r => r.accountType !== 'income');

    function buildSection(sectionRows: BVRow[]): BVSection {
      const totalBudget = sectionRows.reduce((s, r) => s + r.budgetAmount, 0);
      const totalActual = sectionRows.reduce((s, r) => s + r.actualAmount, 0);
      const cmp = compareRow(totalActual, totalBudget);
      const isIncome = sectionRows[0]?.accountType === 'income';
      return {
        rows: sectionRows,
        totalBudget,
        totalActual,
        ...cmp,
        favorable: cmp.direction === 'flat' ? null : (isIncome ? cmp.isOverBudget : !cmp.isOverBudget),
      };
    }

    const income = buildSection(incomeRows);
    const expenses = buildSection(expenseRows);
    const totalBudget = income.totalBudget + expenses.totalBudget;
    const totalActual = income.totalActual + expenses.totalActual;

    return NextResponse.json({
      data: {
        companyName: company?.legalName || company?.name || '',
        currency: company?.currency || 'USD',
        budget: { id: budget.id, name: budget.name, fiscalYear: budget.fiscalYear, period: budget.period },
        generatedAt: new Date().toISOString(),
        sections: { income, expenses },
        totals: {
          budget: totalBudget,
          actual: totalActual,
          variance: totalActual - totalBudget,
          variancePct: totalBudget > 0 ? Math.round(((totalActual - totalBudget) / totalBudget) * 1000) / 10 : 0,
        },
      },
    });
  } catch (error) {
    console.error('GET /api/reports/budget-vs-actual error:', error);
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
