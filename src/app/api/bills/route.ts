import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard, auditLog } from '@/lib/api-helpers';
import { billSchema } from '@/lib/validators/bill';
import { postBillToLedger } from '@/lib/journal';
export const dynamic = 'force-dynamic';

function generateBillId(kind: 'bill' | 'expense'): string {
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return kind === 'bill' ? `BILL-${seq}` : `EXP-${seq}`;
}

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const kind = searchParams.get('kind');
    const status = searchParams.get('status');
    const vendorId = searchParams.get('vendorId');
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') ?? 'billDate';
    const dir = searchParams.get('dir') ?? 'desc';
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '25');
    const skip = (page - 1) * limit;

    const where: any = { companyId };
    if (kind && ['bill', 'expense'].includes(kind)) where.kind = kind;
    if (status && ['draft', 'open', 'paid', 'overdue', 'void'].includes(status)) where.status = status;
    if (vendorId) where.vendorId = vendorId;
    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { referenceNo: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
        { vendor: { companyName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const allowedSorts = ['billDate', 'dueDate', 'total', 'status', 'id'];
    const orderBy: any = {};
    orderBy[allowedSorts.includes(sort) ? sort : 'billDate'] = dir === 'asc' ? 'asc' : 'desc';

    const [bills, total] = await Promise.all([
      db.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          vendor: { select: { id: true, name: true, companyName: true } },
          lineItems: { select: { id: true, description: true, amount: true, categoryId: true } },
          paymentAccount: { select: { id: true, name: true, mask: true } },
        },
      }),
      db.bill.count({ where }),
    ]);

    return NextResponse.json({
      data: bills,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('GET /api/bills error:', error);
    return NextResponse.json({ error: 'Failed to fetch bills' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();

    // Guard: prevent changes in closed periods
    if (body.billDate) {
      const guardError = await closedPeriodGuard(companyId, new Date(body.billDate));
      if (guardError) return guardError;
    }
    const parsed = billSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { lineItems, ...billData } = parsed.data;

    if (billData.status !== 'draft' && lineItems.some((item) => !item.categoryId)) {
      return NextResponse.json(
        { error: 'Every line item needs a GL category before the bill can be posted (or save it as a draft).' },
        { status: 400 }
      );
    }

    const bill = await db.bill.create({
      data: {
        id: generateBillId(billData.kind),
        ...billData,
        companyId,
        billDate: new Date(billData.billDate),
        dueDate: billData.dueDate ? new Date(billData.dueDate) : null,
        lineItems: {
          create: lineItems.map((item, idx) => ({
            description: item.description,
            amount: item.amount,
            categoryId: item.categoryId,
            sortOrder: idx,
          })),
        },
      },
      include: {
        vendor: { select: { id: true, name: true, companyName: true } },
        lineItems: true,
      },
    });

    // Post to the GL ledger unless this is a draft — mirrors invoice posting behavior.
    if (bill.status !== 'draft') {
      await postBillToLedger(
        bill.id,
        bill.vendor?.name ?? 'Unknown',
        bill.lineItems.map((li) => ({ categoryId: li.categoryId, amount: Number(li.amount) })),
        Number(bill.taxAmount),
        Number(bill.total),
        companyId
      );
    }

    await auditLog(companyId, userId, 'bill.create', 'bill', bill.id, { after: bill });

    return NextResponse.json({ data: bill }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/bills error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create bill' }, { status: 500 });
  }
}
