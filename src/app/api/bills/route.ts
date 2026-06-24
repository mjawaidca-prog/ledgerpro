import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { billSchema } from '@/lib/validators/bill';

function generateBillId(kind: 'bill' | 'expense'): string {
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return kind === 'bill' ? `BILL-${seq}` : `EXP-${seq}`;
}

export async function GET(req: NextRequest) {
  try {
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

    const where: any = {};
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
    const body = await req.json();
    const parsed = billSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { lineItems, ...billData } = parsed.data;

    const bill = await db.bill.create({
      data: {
        id: generateBillId(billData.kind),
        ...billData,
        companyId: 'default',
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

    return NextResponse.json({ data: bill }, { status: 201 });
  } catch (error) {
    console.error('POST /api/bills error:', error);
    return NextResponse.json({ error: 'Failed to create bill' }, { status: 500 });
  }
}
