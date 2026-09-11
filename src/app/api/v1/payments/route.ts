import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
import { paymentCreateSchema, validationErrorResponse, parseDateField } from '@/lib/api/validation';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { postInvoicePayment, postBillPayment } from '@/lib/journal';
import { closedPeriodGuard, auditLog } from '@/lib/api-helpers';
import type { Prisma } from '@prisma/client';
export const dynamic = 'force-dynamic';

// GET /api/v1/payments — payments recorded against invoices or bills. A
// payment is the posted journal entry (sourceType 'payment'); it records a
// payment already made externally and never implies a bank transfer.
//
// Journal entries are append-only posted facts with no updatedAt, so change
// sync uses createdAfter instead of updatedAfter.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const { limit, cursor } = pageParamsFrom(searchParams);
  const createdAfterRaw = searchParams.get('createdAfter');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const where: Prisma.JournalEntryWhereInput = {
    companyId: context!.companyId,
    sourceType: 'payment',
  };
  if (createdAfterRaw && !Number.isNaN(new Date(createdAfterRaw).getTime())) {
    where.createdAt = { gte: new Date(createdAfterRaw) };
  }
  if (from || to) {
    where.entryDate = {};
    if (from && !Number.isNaN(new Date(from).getTime())) where.entryDate.gte = new Date(from);
    if (to && !Number.isNaN(new Date(to).getTime())) where.entryDate.lte = new Date(to);
  }

  const result = await cursorPage({
    limit,
    cursor,
    fetch: (take) =>
      db.journalEntry.findMany({
        where,
        orderBy: [{ entryDate: 'desc' }, { id: 'asc' }],
        take,
        cursor: prismaCursor(cursor),
        include: { lines: true },
      }),
  });

  return NextResponse.json({
    data: result.data.map((p) => ({
      id: p.id,
      entryDate: isoDate(p.entryDate),
      description: p.description,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      voidedAt: isoDate(p.voidedAt),
      createdAt: isoDate(p.createdAt),
      lines: p.lines.map((l) => ({
        id: l.id,
        glAccountCode: l.glAccountCode,
        description: l.description,
        debit: moneyString(l.debit),
        credit: moneyString(l.credit),
        currency: l.currency,
        fxRate: l.fxRate === null ? null : moneyString(l.fxRate, 8),
        debitForeign: l.debitForeign === null ? null : moneyString(l.debitForeign),
        creditForeign: l.creditForeign === null ? null : moneyString(l.creditForeign),
      })),
    })),
    pagination: result.pagination,
  });
}

// POST /api/v1/payments — record a payment already made externally
// (write_posting). The service posts the FX-aware entry, updates the
// document subledger and the financial-account balance in one transaction.
// Idempotency-Key required.
export async function POST(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'write_posting' });
  if (error) return error;

  const parsed = paymentCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const { documentType, documentId } = parsed.data;

  const document =
    documentType === 'invoice'
      ? await db.invoice.findFirst({
          where: { id: documentId, companyId: context!.companyId },
          include: { customer: { select: { name: true } } },
        })
      : await db.bill.findFirst({
          where: { id: documentId, companyId: context!.companyId },
          include: { vendor: { select: { name: true } } },
        });

  if (!document) {
    return NextResponse.json({ error: { code: 'not_found', message: `${documentType} not found.` } }, { status: 404 });
  }
  if (document.status === 'draft' || document.status === 'void') {
    return NextResponse.json(
      { error: { code: 'document_not_posted', message: `Payments can only be recorded against posted documents (current status: ${document.status}).` } },
      { status: 409 }
    );
  }

  const account = await db.financialAccount.findFirst({
    where: { id: parsed.data.paymentAccountId, companyId: context!.companyId },
    select: { id: true, glAccountCode: true, currency: true },
  });
  if (!account || !account.glAccountCode) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'One or more fields failed validation.', fields: { paymentAccountId: 'paymentAccountId must be an existing company account with a GL code.' } } },
      { status: 400 }
    );
  }

  const company = await db.company.findUniqueOrThrow({
    where: { id: context!.companyId },
    select: { realizedFxAccountCode: true, fxRoundingAccountCode: true },
  });

  const paymentDate = parseDateField(parsed.data.paymentDate);
  const guard = await closedPeriodGuard(context!.companyId, paymentDate);
  if (guard) return guard;

  const idem = idempotencyContextFrom(req, { apiKeyId: context!.apiKeyId, companyId: context!.companyId });
  if ('error' in idem) return idem.error;

  const counterpartyName = documentType === 'invoice' ? (document as any).customer.name : (document as any).vendor.name;
  const docRate = Number((document as any).fxRate ?? 1);
  const settlementRate = parsed.data.settlementRate ?? docRate;

  let outcome;
  try {
    outcome = await withIdempotency(idem.context, async () => {
      const baseOpts = {
        documentId,
        counterpartyName,
        companyId: context!.companyId,
        amountForeign: parsed.data.amount,
        currency: document.currency,
        invoiceRate: docRate,
        settlementRate,
        paymentDate,
        paymentAccountCode: account.glAccountCode!,
        paymentAccountCurrency: account.currency,
        fxAccountCode: company.realizedFxAccountCode ?? '4310',
        roundingAccountCode: company.fxRoundingAccountCode ?? '4390',
        userId: undefined,
        paymentAccountId: parsed.data.paymentAccountId,
      };
      // The posting services are internally atomic (subledger + balance + FX
      // sync in one db.$transaction) and return the posted journal entry.
      const entry =
        documentType === 'invoice' ? await postInvoicePayment(baseOpts) : await postBillPayment(baseOpts);

      return {
        resourceType: 'payment',
        resourceId: entry.id,
        statusCode: 201,
        body: {
          data: {
            id: entry.id,
            documentType,
            documentId,
            amount: moneyString(parsed.data.amount),
            currency: document.currency,
            paymentDate: paymentDate.toISOString(),
          },
        },
      };
    });
  } catch (err: any) {
    console.error('POST /api/v1/payments error:', err);
    return NextResponse.json({ error: { code: 'payment_failed', message: err?.message ?? 'Failed to record payment.' } }, { status: 400 });
  }

  await auditLog(context!.companyId, undefined, 'api.payment.record', 'payment', (outcome.body as any)?.data?.id ?? null, undefined, {
    apiKeyId: context!.apiKeyId,
    apiKeyName: context!.apiKeyName,
    documentType,
    documentId,
  });

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
