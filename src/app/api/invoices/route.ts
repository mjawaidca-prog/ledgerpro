import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard } from '@/lib/api-helpers';
import { invoiceSchema } from '@/lib/validators/invoice';
import { postInvoiceToLedger } from '@/lib/journal';
import { notifyBillDue } from '@/lib/notifications';
import { resolveDocumentFx, FxValidationError } from '@/lib/fx/document';

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

    const { lineItems, fxRate, fxRateConfirmed, ...invoiceData } = parsed.data;

    if (invoiceData.status !== 'draft' && lineItems.some((item) => !item.categoryId)) {
      return NextResponse.json(
        { error: 'Every line item needs a GL revenue category before the invoice can be posted (or save it as a draft).' },
        { status: 400 }
      );
    }

    // The invoice currency comes from the contact — never from the payload.
    const [customer, company] = await Promise.all([
      db.contact.findUnique({
        where: { id: invoiceData.customerId, companyId },
        select: { name: true, currency: true },
      }),
      db.company.findUnique({ where: { id: companyId }, select: { currency: true } }),
    ]);

    const currency = customer?.currency ?? 'CAD';
    const homeCurrency = company?.currency ?? 'CAD';
    if (invoiceData.currency && invoiceData.currency !== currency) {
      return NextResponse.json(
        { error: `This customer is set to ${currency}, so the invoice is raised in ${currency}. Change it on the contact, not here.` },
        { status: 400 }
      );
    }

    // FX block — resolved and frozen only when posting (drafts carry no rate).
    let fx: { fxRate: number; fxRateSource: 'feed' | 'manual'; fxRateDate: Date; totalHome: number } | null = null;
    if (invoiceData.status !== 'draft') {
      fx = await resolveDocumentFx({
        currency,
        homeCurrency,
        documentDate: invoiceData.issueDate,
        subtotal: Number(invoiceData.subtotal),
        taxAmount: Number(invoiceData.taxAmount),
        suppliedRate: fxRate,
        confirmed: fxRateConfirmed,
      });
    }

    const invoice = await db.invoice.create({
      data: {
        id: generateInvoiceId(),
        ...invoiceData,
        currency,
        fxRate: fx?.fxRate ?? null,
        fxRateSource: fx?.fxRateSource ?? null,
        fxRateDate: fx?.fxRateDate ?? null,
        totalHome: fx?.totalHome ?? null,
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
        invoice.lineItems.map((li) => ({ categoryId: li.categoryId, amount: Number(li.amount) })),
        Number(invoice.taxAmount),
        Number(invoice.total),
        companyId,
        undefined,
        fx ? { currency, fxRate: fx.fxRate } : undefined,
      );
    }

    // Notify if sent (overdue check will happen later via scheduled task)
    if (invoiceData.status === 'sent') {
      notifyBillDue(companyId, invoice.id, customer?.name || 'Customer').catch(() => {});
    }

    return NextResponse.json({ data: invoice }, { status: 201 });
  } catch (error: any) {
    if (error instanceof FxValidationError) {
      return NextResponse.json({ error: error.message, code: 'fx_validation' }, { status: 400 });
    }
    console.error('POST /api/invoices error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create invoice' }, { status: 500 });
  }
}
