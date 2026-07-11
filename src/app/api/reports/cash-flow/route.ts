import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { fiscalYearRangeForLabel } from '@/lib/reporting';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const startParam = searchParams.get('startDate');
    const endParam = searchParams.get('endDate');

    const company = await db.company.findUnique({ where: { id: companyId }, select: { name: true, legalName: true, fiscalYearStart: true } });
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

    // Operating activities: invoice payments (inflows) - bill payments (outflows)
    const [paidInvoices, paidBills, transactions] = await Promise.all([
      db.invoice.findMany({
        where: { companyId, paidAt: { gte: startDate, lte: endDate }, status: 'paid' },
        select: { paidAmount: true, paidAt: true },
      }),
      db.bill.findMany({
        where: { companyId, paidAt: { gte: startDate, lte: endDate }, status: 'paid' },
        select: { paidAmount: true, paidAt: true },
      }),
      db.transaction.findMany({
        where: { companyId, date: { gte: startDate, lte: endDate } },
        select: { amount: true, date: true, categoryId: true, status: true },
      }),
    ]);

    const cashFromCustomers = paidInvoices.reduce((s, inv) => s + Number(inv.paidAmount ?? 0), 0);
    const cashPaidToVendors = paidBills.reduce((s, bill) => s + Number(bill.paidAmount ?? 0), 0);

    // Operating cash flow from bank transactions
    const operatingInflows = transactions
      .filter((t) => Number(t.amount) > 0 && t.status !== 'excluded')
      .reduce((s, t) => s + Number(t.amount), 0);
    const operatingOutflows = transactions
      .filter((t) => Number(t.amount) < 0 && t.status !== 'excluded')
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

    const netOperatingCash = operatingInflows - operatingOutflows;
    const netCashFlow = cashFromCustomers - cashPaidToVendors + netOperatingCash;

    // Monthly breakdown — dynamically generate months from the date range
    const monthly: Record<string, { inflow: number; outflow: number }> = {};
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const endCursor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    while (cursor <= endCursor) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      monthly[key] = { inflow: 0, outflow: 0 };
      cursor.setMonth(cursor.getMonth() + 1);
    }

    for (const t of transactions) {
      const key = new Date(t.date).toISOString().slice(0, 7);
      if (!monthly[key]) monthly[key] = { inflow: 0, outflow: 0 };
      const amt = Number(t.amount);
      if (amt > 0) monthly[key].inflow += amt;
      else monthly[key].outflow += Math.abs(amt);
    }

    const monthlyArray = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        inflow: data.inflow,
        outflow: data.outflow,
        net: data.inflow - data.outflow,
      }));

    return NextResponse.json({
      data: {
        companyName: company?.legalName || company?.name || '',
        period: { year, startDate, endDate },
        summary: {
          cashFromCustomers,
          cashPaidToVendors,
          operatingInflows,
          operatingOutflows,
          netOperatingCash,
          netCashFlow,
          beginningCash: 0,
        },
        monthly: monthlyArray,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/cash-flow error:', error);
    return NextResponse.json({ error: 'Failed to generate cash flow' }, { status: 500 });
  }
}
