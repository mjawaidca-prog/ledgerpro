import { requireCompany } from '@/lib/api-helpers';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fiscalYearRangeForLabel } from '@/lib/reporting';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const startParam = searchParams.get('startDate');
    const endParam = searchParams.get('endDate');

    const company = await db.company.findUnique({ where: { id: companyId }, select: { fiscalYearStart: true } });
    const fyAnchor = company?.fiscalYearStart ?? new Date(new Date().getFullYear(), 0, 1);

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
        descriptions: billData.descriptions.slice(0, 5),
        percentage: Math.round(pct * 10) / 10,
      };
    });

    return NextResponse.json({
      data: {
        year,
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
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
