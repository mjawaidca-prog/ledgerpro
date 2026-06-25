import { requireCompany, auditLog } from '@/lib/api-helpers';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const year = searchParams.get('year') ?? new Date().getFullYear().toString();

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    const [expenseAccounts, bills] = await Promise.all([
      db.chartOfAccount.findMany({
        where: { companyId, type: 'expense', active: true },
        orderBy: { balance: 'desc' },
      }),
      db.bill.findMany({
        where: {
          companyId,
          billDate: { gte: startDate, lte: endDate },
          status: { in: ['paid', 'open', 'overdue'] },
        },
        include: {
          lineItems: { select: { categoryId: true, amount: true, description: true } },
        },
        orderBy: { billDate: 'desc' },
      }),
    ]);

    // Aggregate bill line items by GL category
    const categoryMap: Record<string, { total: number; count: number; descriptions: string[] }> = {};

    for (const bill of bills) {
      for (const line of bill.lineItems) {
        const key = line.categoryId ?? 'uncategorized';
        if (!categoryMap[key]) categoryMap[key] = { total: 0, count: 0, descriptions: [] };
        categoryMap[key].total += Number(line.amount);
        categoryMap[key].count += 1;
        if (line.description && !categoryMap[key].descriptions.includes(line.description)) {
          categoryMap[key].descriptions.push(line.description);
        }
      }
    }

    // Combine with COA data
    const totalExpenses = expenseAccounts.reduce((s, a) => s + Number(a.balance), 0);

    const categories = expenseAccounts.map((acct) => {
      const billData = categoryMap[acct.id] || { total: 0, count: 0, descriptions: [] };
      const amount = Number(acct.balance);
      const pct = totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0;
      return {
        code: acct.code,
        name: acct.name,
        detailType: acct.detailType,
        balance: amount,
        billCount: billData.count,
        descriptions: billData.descriptions.slice(0, 5), // top 5 descriptions
        percentage: Math.round(pct * 10) / 10,
      };
    });

    return NextResponse.json({
      data: {
        year,
        totalExpenses,
        categories,
        count: categories.length,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/expense-breakdown error:', error);
    return NextResponse.json({ error: 'Failed to generate expense breakdown' }, { status: 500 });
  }
}
