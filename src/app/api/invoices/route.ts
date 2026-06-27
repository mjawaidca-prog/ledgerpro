import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard } from '@/lib/api-helpers';
import { invoiceSchema } from '@/lib/validators/invoice';
import { postInvoiceToLedger } from '@/lib/journal';
import { notifyBillDue } from '@/lib/notifications';
export const dynamic = 'force-dynamic';

function generateInvoiceId(): string {
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return `INV-${seq}`;
}

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const customerId = searchParams.get('customerId');
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') ?? 'issueDate';
    const dir = searchParams.get('dir') ?? 'desc';
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '25');
    const skip = (page - 1) * limit;

    const where: any = { companyId };

    if (status && ['draft', 'sent', 'paid', 'overdue', 'void'].includes(status)) {
      where.status = status;
    }
    if (customerId) where.customerId = customerId;
    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { companyName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const orderBy: any = {};
    const allowedSorts = ['issueDate', 'dueDate', 'total', 'status', 'id'];
    orderBy[allowedSorts.includes(sort) ? sort : 'issueDate'] = dir === 'asc' ? 'asc' : 'desc';

    const [invoices, total] = await Promise.all([
      db.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          customer: { select: { id: true, name: true, companyName: true } },
          lineItems: { select: { id: true, description: true, amount: true } },
        },
      }),
      db.invoice.count({ where }),
    ]);

    // Calculate aging overdue amounts
    const now = new Date();
    const enriched = invoices.map((inv) => {
      let agingDays = 0;
      if (inv.status === 'overdue' || (inv.status === 'sent' && inv.dueDate < now)) {
        agingDays = Math.max(0, Math.floor((now.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24)));
      }
      return { ...inv, agingDays };
    });

    return NextResponse.json({
      data: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('GET /api/invoices error:', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();

    // Guard: prevent changes in closed periods
    if (body.issueDate) {
      const guardError = await closedPeriodGuard(companyId, new Date(body.issueDate));
      if (guardError) return guardError;
    }
    const parsed = invoiceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { lineItems, ...invoiceData } = parsed.data;

    // Look up customer name for journal description
    const customer = await db.contact.findUnique({
      where: { id: invoiceData.customerId, companyId },
      select: { name: true },
    });

    const invoice = await db.invoice.create({
      data: {
        id: generateInvoiceId(),
        ...invoiceData,
        companyId,
        issueDate: new Date(invoiceData.issueDate),
        dueDate: new Date(invoiceData.dueDate),
        lineItems: {
          create: lineItems.map((item, idx) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            categoryId: item.categoryId,
            sortOrder: idx,
          })),
        },
      },
      include: {
        customer: { select: { id: true, name: true, companyName: true } },
        lineItems: true,
      },
    });

    // Post to journal if not a draft
    if (invoiceData.status !== 'draft') {
      await postInvoiceToLedger(
        invoice.id,
        customer?.name ?? 'Unknown',
        Number(invoice.total),
        companyId,
      );
    }

    // Notify if sent (overdue check will happen later via scheduled task)
    if (invoiceData.status === 'sent') {
      notifyBillDue(companyId, invoice.id, customer?.name || 'Customer').catch(() => {});
    }

    return NextResponse.json({ data: invoice }, { status: 201 });
  } catch (error) {
    console.error('POST /api/invoices error:', error);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
