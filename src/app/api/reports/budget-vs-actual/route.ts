import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const budgetId = searchParams.get('budgetId');

    if (!budgetId) {
      return NextResponse.json({ error: 'budgetId is required' }, { status: 400 });
    }

    // Fetch budget with lines
    const budget = await db.budget.findUnique({
      where: { id: budgetId },
      include: { lines: true },
    });
    if (!budget || budget.companyId !== companyId) {
      return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
    }

    // Fetch actual COA balances for each budget line's GL account
    const accountCodes = budget.lines.map((l) => l.glAccountCode);
    const actuals = await db.chartOfAccount.findMany({
      where: { companyId, code: { in: accountCodes } },
      select: { code: true, name: true, balance: true, type: true },
    });

    const actualMap = new Map(actuals.map((a) => [a.code, a]));

    // Build comparison rows
    const rows = budget.lines.map((line) => {
      const actual = actualMap.get(line.glAccountCode);
      const actualBalance = actual ? Math.abs(Number(actual.balance)) : 0;
      const budgetAmount = Number(line.amount);
      const variance = actualBalance - budgetAmount;
      const variancePct = budgetAmount > 0 ? Math.round((variance / budgetAmount) * 100) : 0;

      return {
        glAccountCode: line.glAccountCode,
        accountName: actual?.name || line.glAccountCode,
        accountType: actual?.type || 'expense',
        budgetAmount,
        actualAmount: actualBalance,
        variance,
        variancePct,
        isOverBudget: variance > 0,
      };
    });

    const totalBudget = rows.reduce((s, r) => s + r.budgetAmount, 0);
    const totalActual = rows.reduce((s, r) => s + r.actualAmount, 0);
    const totalVariance = totalActual - totalBudget;

    return NextResponse.json({
      data: {
        budget: { id: budget.id, name: budget.name, fiscalYear: budget.fiscalYear, period: budget.period },
        rows,
        totals: {
          budget: totalBudget,
          actual: totalActual,
          variance: totalVariance,
          variancePct: totalBudget > 0 ? Math.round((totalVariance / totalBudget) * 100) : 0,
        },
      },
    });
  } catch (error) {
    console.error('GET /api/reports/budget-vs-actual error:', error);
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
