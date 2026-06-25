import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    const asOfDate = new Date(asOf);

    const bills = await db.bill.findMany({
      where: {
        status: { in: ['open', 'overdue'] },
      },
      include: {
        vendor: { select: { id: true, name: true, companyName: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    const aging: Record<string, { total: number; count: number; bills: any[] }> = {
      current: { total: 0, count: 0, bills: [] },
      '1-30': { total: 0, count: 0, bills: [] },
      '31-60': { total: 0, count: 0, bills: [] },
      '61-90': { total: 0, count: 0, bills: [] },
      '90+': { total: 0, count: 0, bills: [] },
    };

    let totalPayable = 0;

    for (const bill of bills) {
      const dueDate = new Date(bill.dueDate ?? bill.billDate);
      const daysOverdue = Math.floor((asOfDate.getTime() - dueDate.getTime()) / 86400000);
      const remainingAmount = Number(bill.total) - Number(bill.paidAmount);

      let bucket: string;
      if (daysOverdue <= 0) bucket = 'current';
      else if (daysOverdue <= 30) bucket = '1-30';
      else if (daysOverdue <= 60) bucket = '31-60';
      else if (daysOverdue <= 90) bucket = '61-90';
      else bucket = '90+';

      aging[bucket].total += remainingAmount;
      aging[bucket].count += 1;
      aging[bucket].bills.push({
        id: bill.id,
        vendorName: bill.vendor?.companyName || bill.vendor?.name || 'Unknown',
        billId: bill.id,
        billDate: bill.billDate,
        dueDate: bill.dueDate,
        total: Number(bill.total),
        paidAmount: Number(bill.paidAmount),
        remaining: remainingAmount,
        daysOverdue: Math.max(0, daysOverdue),
        status: bill.status,
        referenceNo: bill.referenceNo,
      });
      totalPayable += remainingAmount;
    }

    return NextResponse.json({
      data: {
        asOf,
        aging,
        totalPayable,
        totalBills: bills.length,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/ap-aging error:', error);
    return NextResponse.json({ error: 'Failed to generate AP aging' }, { status: 500 });
  }
}
