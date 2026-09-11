import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireCompany, closedPeriodGuard, auditLog } from '@/lib/api-helpers';
import { emitWebhookEvent } from '@/lib/webhooks';
import { billSchema } from '@/lib/validators/bill';
import { postBillToLedger } from '@/lib/journal';
import { resolveDocumentFx, FxValidationError } from '@/lib/fx/document';
import { getTaxUiContext, previewTaxDraft } from '@/lib/tax/ui-service';
import { postTaxDocument, TaxPostingError, type TaxLineSelection } from '@/lib/tax/posting-service';
import { withReviewedDocumentRequest } from '@/lib/tax/document-request';

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

    const { lineItems, fxRate, fxRateConfirmed, importTaxAmount, taxDecision, ...billData } = parsed.data;

    if (billData.status !== 'draft' && lineItems.some((item) => !item.categoryId)) {
      return NextResponse.json(
        { error: 'Every line item needs a GL category before the bill can be posted (or save it as a draft).' },
        { status: 400 }
      );
    }

    // The bill currency comes from the vendor — never from the payload.
    const [vendor, company, taxContext] = await Promise.all([
      db.contact.findUnique({
        where: { id: billData.vendorId, companyId },
        select: { name: true, currency: true },
      }),
      db.company.findUnique({ where: { id: companyId }, select: { currency: true } }),
      getTaxUiContext(companyId, new Date(`${billData.billDate}T00:00:00.000Z`)),
    ]);

    if (!vendor) return NextResponse.json({ error: 'vendor not found in this company.' }, { status: 404 });
    const currency = vendor.currency;
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

    let taxPlan = null;
    if (taxContext.enabled) {
      if (!['open', 'draft'].includes(billData.status)) {
        return NextResponse.json({ error: 'Create this document as open; record payments separately.', code: 'invalid_initial_status' }, { status: 400 });
      }
      if (billData.status === 'draft') {
        return NextResponse.json({ error: 'Reviewed-tax bills must be completed and posted in one session; draft tax decisions are not persisted.', code: 'tax_draft_not_supported' }, { status: 409 });
      }
      if (!taxContext.ready) {
        return NextResponse.json({ error: taxContext.issues.map(issue => issue.message).join(' '), code: 'tax_configuration_not_ready' }, { status: 409 });
      }
      if (Number(importTaxAmount ?? 0) > 0) {
        return NextResponse.json({ error: 'CBSA import tax needs its dedicated reviewed posting workflow and cannot be combined with line tax.', code: 'import_tax_review_required' }, { status: 409 });
      }
      if (!taxDecision || taxDecision.lines.length !== lineItems.length) {
        return NextResponse.json({ error: 'Choose a reviewed tax code, recovery treatment, and evidence for every bill line.', code: 'tax_decision_required' }, { status: 400 });
      }
      const decisions = new Map(taxDecision.lines.map(line => [line.lineIndex, line]));
      taxPlan = await previewTaxDraft({
        companyId,
        userId,
        direction: 'purchase',
        documentDate: new Date(`${billData.billDate}T00:00:00.000Z`),
        documentCurrency: currency,
        fxRate: fx?.fxRate?.toString() ?? null,
        lines: lineItems.map((line, index) => {
          const decision = decisions.get(index);
          if (!decision) throw new TaxPostingError('line_selection_mismatch', 'Every bill line requires one tax decision.');
          return { clientLineId: `line-${index}`, categoryId: line.categoryId ?? null, amount: line.amount, ...decision };
        }),
      });
      billData.subtotal = taxPlan.netMinor / 100;
      billData.taxAmount = taxPlan.taxMinor / 100;
      billData.total = taxPlan.grossMinor / 100;
      billData.taxRate = null;
    } else if (taxDecision) {
      return NextResponse.json({ error: 'The reviewed tax workflow is not enabled for this company.', code: 'tax_feature_disabled' }, { status: 409 });
    }

    const requestedStatus = billData.status;
    const saveDocument = async (client: Prisma.TransactionClient, documentId: string) => {
    let bill = await client.bill.create({
      data: {
        id: documentId,
        ...billData,
        status: taxContext.enabled ? 'draft' : requestedStatus,
        currency,
        fxRate: fx?.fxRate ?? null,
        fxRateSource: fx?.fxRateSource ?? null,
        fxRateDate: fx?.fxRateDate ?? null,
        totalHome: taxPlan && fx ? taxPlan.grossHomeMinor / 100 : fx?.totalHome ?? null,
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
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    });

    // Post to the GL ledger unless this is a draft — mirrors invoice posting behavior.
    let taxPosting = null;
    if (requestedStatus !== 'draft' && taxContext.enabled && taxDecision) {
      const byIndex = new Map(taxDecision.lines.map(line => [line.lineIndex, line]));
      const selections: TaxLineSelection[] = bill.lineItems.map((line, index) => {
        const decision = byIndex.get(index)!;
        return { sourceLineId: line.id, taxCodeVersionId: decision.taxCodeVersionId, jurisdictionEvidence: decision.jurisdictionEvidence, jurisdictionOverrideReason: decision.jurisdictionOverrideReason, recovery: decision.recovery };
      });
      taxPosting = await postTaxDocument({ companyId, userId, sourceKey: `bill:${bill.id}:${taxDecision.requestKey}`, sourceType: 'bill', sourceId: bill.id, description: `Bill ${bill.id}`, lines: selections, expectedTotals: taxPlan ? { netMinor: taxPlan.netMinor, taxMinor: taxPlan.taxMinor, grossMinor: taxPlan.grossMinor, grossHomeMinor: taxPlan.grossHomeMinor } : undefined }, client);
      bill = await client.bill.update({
        where: { id: bill.id, companyId },
        data: { status: requestedStatus },
        include: { vendor: { select: { id: true, name: true, companyName: true } }, lineItems: true },
      });
    } else if (bill.status !== 'draft') {
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

    return { data: bill, taxPosting };
    };
    if (taxContext.enabled && taxDecision) {
      const result = await withReviewedDocumentRequest(
        { companyId, userId, kind: 'bill', key: taxDecision.requestKey, payload: parsed.data },
        saveDocument,
        async (client, id) => ({
          data: await client.bill.findUniqueOrThrow({ where: { id, companyId }, include: { vendor: { select: { id: true, name: true, companyName: true } }, lineItems: { orderBy: { sortOrder: 'asc' } } } }),
          taxPosting: await client.taxPosting.findFirst({ where: { companyId, journalEntry: { sourceType: 'bill', sourceId: id }, reversalOfId: null }, include: { journalEntry: { include: { lines: true } }, snapshots: { include: { components: true } } } }),
        }),
      );
      await emitWebhookEvent({
        companyId,
        eventType: 'bill.created',
        payload: { id: (result as any).data?.id, status: (result as any).data?.status, occurredAt: new Date().toISOString() },
      });
      return NextResponse.json(result, { status: 201 });
    }
    const { data: bill, taxPosting } = await saveDocument(db, generateBillId(billData.kind));

    await auditLog(companyId, userId, 'bill.create', 'bill', bill.id, { after: bill });

    await emitWebhookEvent({
      companyId,
      eventType: 'bill.created',
      payload: { id: bill.id, status: bill.status, occurredAt: new Date().toISOString() },
    });

    return NextResponse.json({ data: bill, taxPosting }, { status: 201 });
  } catch (error: any) {
    if (error instanceof FxValidationError) {
      return NextResponse.json({ error: error.message, code: 'fx_validation' }, { status: 400 });
    }
    if (error instanceof TaxPostingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('POST /api/bills error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create bill' }, { status: 500 });
  }
}
