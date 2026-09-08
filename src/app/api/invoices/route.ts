import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard } from '@/lib/api-helpers';
import { invoiceSchema } from '@/lib/validators/invoice';
import { postInvoiceToLedger } from '@/lib/journal';
import { notifyBillDue } from '@/lib/notifications';
import { resolveDocumentFx, FxValidationError } from '@/lib/fx/document';
import { getTaxUiContext, previewTaxDraft } from '@/lib/tax/ui-service';
import { postTaxDocument, TaxPostingError, type TaxLineSelection } from '@/lib/tax/posting-service';

import { withReviewedDocumentRequest } from '@/lib/tax/document-request';

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
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
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

    const { lineItems, fxRate, fxRateConfirmed, taxDecision, ...invoiceData } = parsed.data;

    if (invoiceData.status !== 'draft' && lineItems.some((item) => !item.categoryId)) {
      return NextResponse.json(
        { error: 'Every line item needs a GL revenue category before the invoice can be posted (or save it as a draft).' },
        { status: 400 }
      );
    }

    // The invoice currency comes from the contact — never from the payload.
    const [customer, company, taxContext] = await Promise.all([
      db.contact.findUnique({
        where: { id: invoiceData.customerId, companyId },
        select: { name: true, currency: true },
      }),
      db.company.findUnique({ where: { id: companyId }, select: { currency: true } }),
      getTaxUiContext(companyId, new Date(`${invoiceData.issueDate}T00:00:00.000Z`)),
    ]);

    if (!customer) return NextResponse.json({ error: 'customer not found in this company.' }, { status: 404 });
    const currency = customer.currency;
    const homeCurrency = company?.currency ?? 'CAD';
    const serverLineItems = taxContext.enabled
      ? lineItems.map(line => ({ ...line, amount: new Prisma.Decimal(line.quantity).toDecimalPlaces(2).mul(new Prisma.Decimal(line.unitPrice).toDecimalPlaces(2)).toDecimalPlaces(2).toNumber() }))
      : lineItems;
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

    let taxPlan = null;
    if (taxContext.enabled) {
      if (!['sent', 'draft'].includes(invoiceData.status)) {
        return NextResponse.json({ error: 'Create this document as sent; record payments separately.', code: 'invalid_initial_status' }, { status: 400 });
      }
      if (invoiceData.status === 'draft') {
        return NextResponse.json({ error: 'Reviewed-tax invoices must be completed and posted in one session; draft tax decisions are not persisted.', code: 'tax_draft_not_supported' }, { status: 409 });
      }
      if (!taxContext.ready) {
        return NextResponse.json({ error: taxContext.issues.map(issue => issue.message).join(' '), code: 'tax_configuration_not_ready' }, { status: 409 });
      }
      if (!taxDecision || taxDecision.lines.length !== serverLineItems.length) {
        return NextResponse.json({ error: 'Choose a reviewed tax code and provide jurisdiction evidence for every invoice line.', code: 'tax_decision_required' }, { status: 400 });
      }
      const decisions = new Map(taxDecision.lines.map(line => [line.lineIndex, line]));
      taxPlan = await previewTaxDraft({
        companyId,
        userId,
        direction: 'sale',
        documentDate: new Date(`${invoiceData.issueDate}T00:00:00.000Z`),
        documentCurrency: currency,
        fxRate: fx?.fxRate?.toString() ?? null,
        lines: serverLineItems.map((line, index) => {
          const decision = decisions.get(index);
          if (!decision) throw new TaxPostingError('line_selection_mismatch', 'Every invoice line requires one tax decision.');
          return { clientLineId: `line-${index}`, categoryId: line.categoryId ?? null, amount: line.amount, ...decision };
        }),
      });
      invoiceData.subtotal = taxPlan.netMinor / 100;
      invoiceData.taxAmount = taxPlan.taxMinor / 100;
      invoiceData.total = taxPlan.grossMinor / 100;
      invoiceData.taxRate = null;
    } else if (taxDecision) {
      return NextResponse.json({ error: 'The reviewed tax workflow is not enabled for this company.', code: 'tax_feature_disabled' }, { status: 409 });
    }

    const requestedStatus = invoiceData.status;
    const saveDocument = async (client: Prisma.TransactionClient, documentId: string) => {
    let invoice = await client.invoice.create({
      data: {
        id: documentId,
        ...invoiceData,
        status: taxContext.enabled ? 'draft' : requestedStatus,
        currency,
        fxRate: fx?.fxRate ?? null,
        fxRateSource: fx?.fxRateSource ?? null,
        fxRateDate: fx?.fxRateDate ?? null,
        totalHome: taxPlan && fx ? taxPlan.grossHomeMinor / 100 : fx?.totalHome ?? null,
        companyId,
        issueDate: new Date(invoiceData.issueDate),
        dueDate: new Date(invoiceData.dueDate),
        lineItems: {
          create: serverLineItems.map((item, idx) => ({
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
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    });

    // Post to journal if not a draft
    let taxPosting = null;
    if (invoiceData.status !== 'draft' && taxContext.enabled && taxDecision) {
      const byIndex = new Map(taxDecision.lines.map(line => [line.lineIndex, line]));
      const selections: TaxLineSelection[] = invoice.lineItems.map((line, index) => {
        const decision = byIndex.get(index)!;
        return { sourceLineId: line.id, taxCodeVersionId: decision.taxCodeVersionId, jurisdictionEvidence: decision.jurisdictionEvidence, jurisdictionOverrideReason: decision.jurisdictionOverrideReason, recovery: decision.recovery };
      });
      taxPosting = await postTaxDocument({ companyId, userId, sourceKey: `invoice:${invoice.id}:${taxDecision.requestKey}`, sourceType: 'invoice', sourceId: invoice.id, description: `Invoice ${invoice.id}`, lines: selections, expectedTotals: taxPlan ? { netMinor: taxPlan.netMinor, taxMinor: taxPlan.taxMinor, grossMinor: taxPlan.grossMinor, grossHomeMinor: taxPlan.grossHomeMinor } : undefined }, client);
      invoice = await client.invoice.update({
        where: { id: invoice.id, companyId },
        data: { status: requestedStatus, sentAt: requestedStatus === 'sent' ? new Date() : undefined },
        include: { customer: { select: { id: true, name: true, companyName: true } }, lineItems: true },
      });
    } else if (invoiceData.status !== 'draft') {
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

    return { data: invoice, taxPosting };
    };
    if (taxContext.enabled && taxDecision) {
      const result = await withReviewedDocumentRequest(
        { companyId, userId, kind: 'invoice', key: taxDecision.requestKey, payload: parsed.data },
        saveDocument,
        async (client, id) => ({
          data: await client.invoice.findUniqueOrThrow({ where: { id, companyId }, include: { customer: { select: { id: true, name: true, companyName: true } }, lineItems: { orderBy: { sortOrder: 'asc' } } } }),
          taxPosting: await client.taxPosting.findFirst({ where: { companyId, journalEntry: { sourceType: 'invoice', sourceId: id }, reversalOfId: null }, include: { journalEntry: { include: { lines: true } }, snapshots: { include: { components: true } } } }),
        }),
      );
      return NextResponse.json(result, { status: 201 });
    }
    const { data: invoice, taxPosting } = await saveDocument(db, generateInvoiceId());

    // Notify if sent (overdue check will happen later via scheduled task)
    if (requestedStatus === 'sent') {
      notifyBillDue(companyId, invoice.id, customer?.name || 'Customer').catch(() => {});
    }

    return NextResponse.json({ data: invoice, taxPosting }, { status: 201 });
  } catch (error: any) {
    if (error instanceof FxValidationError) {
      return NextResponse.json({ error: error.message, code: 'fx_validation' }, { status: 400 });
    }
    if (error instanceof TaxPostingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('POST /api/invoices error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create invoice' }, { status: 500 });
  }
}
