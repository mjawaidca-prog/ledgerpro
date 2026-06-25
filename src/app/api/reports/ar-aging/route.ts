import { requireCompany, auditLog } from '@/lib/api-helpers';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    const asOfDate = new Date(asOf);

    const invoices = await db.invoice.findMany({
      where: {
        companyId,
        status: { in: ['sent', 'overdue'] },
      },
      include: {
        customer: { select: { id: true, name: true, companyName: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    const aging: Record<string, { total: number; count: number; invoices: any[] }> = {
      current: { total: 0, count: 0, invoices: [] },
      '1-30': { total: 0, count: 0, invoices: [] },
      '31-60': { total: 0, count: 0, invoices: [] },
      '61-90': { total: 0, count: 0, invoices: [] },
      '90+': { total: 0, count: 0, invoices: [] },
    };

    let totalOutstanding = 0;

    for (const inv of invoices) {
      const dueDate = new Date(inv.dueDate);
      const daysOverdue = Math.floor((asOfDate.getTime() - dueDate.getTime()) / 86400000);
      const remainingAmount = Number(inv.total) - Number(inv.paidAmount);

      let bucket: string;
      if (daysOverdue <= 0) bucket = 'current';
      else if (daysOverdue <= 30) bucket = '1-30';
      else if (daysOverdue <= 60) bucket = '31-60';
      else if (daysOverdue <= 90) bucket = '61-90';
      else bucket = '90+';

      aging[bucket].total += remainingAmount;
      aging[bucket].count += 1;
      aging[bucket].invoices.push({
        id: inv.id,
        customerName: inv.customer?.companyName || inv.customer?.name || 'Unknown',
        invoiceId: inv.id,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        total: Number(inv.total),
        paidAmount: Number(inv.paidAmount),
        remaining: remainingAmount,
        daysOverdue: Math.max(0, daysOverdue),
        status: inv.status,
      });
      totalOutstanding += remainingAmount;
    }

    return NextResponse.json({
      data: {
        asOf,
        aging,
        totalOutstanding,
        totalInvoices: invoices.length,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/ar-aging error:', error);
    return NextResponse.json({ error: 'Failed to generate AR aging' }, { status: 500 });
  }
}
