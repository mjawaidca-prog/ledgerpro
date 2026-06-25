import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const year = searchParams.get('year') ?? new Date().getFullYear().toString();

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    // Operating activities: invoice payments (inflows) - bill payments (outflows)
    const [paidInvoices, paidBills, transactions] = await Promise.all([
      db.invoice.findMany({
        where: { paidAt: { gte: startDate, lte: endDate }, status: 'paid' },
        select: { paidAmount: true, paidAt: true },
      }),
      db.bill.findMany({
        where: { paidAt: { gte: startDate, lte: endDate }, status: 'paid' },
        select: { paidAmount: true, paidAt: true },
      }),
      db.transaction.findMany({
        where: { date: { gte: startDate, lte: endDate } },
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

    // Monthly breakdown
    const monthly: Record<string, { inflow: number; outflow: number }> = {};
    for (let m = 0; m < 12; m++) {
      const key = `${year}-${String(m + 1).padStart(2, '0')}`;
      monthly[key] = { inflow: 0, outflow: 0 };
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
        period: { year, startDate, endDate },
        summary: {
          cashFromCustomers,
          cashPaidToVendors,
          operatingInflows,
          operatingOutflows,
          netOperatingCash,
          netCashFlow,
          beginningCash: 0, // Would need prior-year data for true beginning balance
        },
        monthly: monthlyArray,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/cash-flow error:', error);
    return NextResponse.json({ error: 'Failed to generate cash flow' }, { status: 500 });
  }
}
