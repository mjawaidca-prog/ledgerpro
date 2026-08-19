import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard, auditLog } from '@/lib/api-helpers';
import { billSchema } from '@/lib/validators/bill';
import { postBillToLedger } from '@/lib/journal';
import { resolveDocumentFx, FxValidationError } from '@/lib/fx/document';
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

    const { lineItems, fxRate, fxRateConfirmed, importTaxAmount, ...billData } = parsed.data;

    if (billData.status !== 'draft' && lineItems.some((item) => !item.categoryId)) {
      return NextResponse.json(
        { error: 'Every line item needs a GL category before the bill can be posted (or save it as a draft).' },
        { status: 400 }
      );
    }

    // The bill currency comes from the vendor — never from the payload.
    const [vendor, company] = await Promise.all([
      db.contact.findUnique({
        where: { id: billData.vendorId, companyId },
        select: { name: true, currency: true },
      }),
      db.company.findUnique({ where: { id: companyId }, select: { currency: true } }),
    ]);

    const currency = vendor?.currency ?? 'CAD';
    const homeCurrency = company?.currency ?? 'CAD';
    if (billData.currency && billData.currency !== currency) {
      return NextResponse.json(
        { error: `This vendor is set to ${currency}, so the bill is raised in ${currency}. Change it on the contact, not here.` },
        { status: 400 }
      );
    }

    // FX block — resolved and frozen only when posting (drafts carry no rate).
    let fx: { fxRate: number; fxRateSource: 'feed' | 'manual'; fxRateDate: Date; totalHome: number } | null = null;
    if (billData.status !== 'draft') {
      fx = await resolveDocumentFx({
        currency,
        homeCurrency,
        documentDate: billData.billDate,
        subtotal: Number(billData.subtotal),
        taxAmount: Number(billData.taxAmount),
        suppliedRate: fxRate,
        confirmed: fxRateConfirmed,
      });
    }

    const bill = await db.bill.create({
      data: {
        id: generateBillId(billData.kind),
        ...billData,
        currency,
        fxRate: fx?.fxRate ?? null,
        fxRateSource: fx?.fxRateSource ?? null,
        fxRateDate: fx?.fxRateDate ?? null,
        totalHome: fx?.totalHome ?? null,
        importTaxAmount: importTaxAmount ?? null,
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
        companyId,
        undefined,
        fx ? { currency, fxRate: fx.fxRate } : undefined,
        Number(importTaxAmount ?? 0) > 0 ? Number(importTaxAmount) : undefined
      );
    }

    await auditLog(companyId, userId, 'bill.create', 'bill', bill.id, { after: bill });

    return NextResponse.json({ data: bill }, { status: 201 });
  } catch (error: any) {
    if (error instanceof FxValidationError) {
      return NextResponse.json({ error: error.message, code: 'fx_validation' }, { status: 400 });
    }
    console.error('POST /api/bills error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create bill' }, { status: 500 });
  }
}
