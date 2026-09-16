import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { reverseDocumentPayment } from '@/lib/journal';
import { closedPeriodGuard } from '@/lib/api-helpers';
import { z } from 'zod';
import { validationErrorResponse } from '@/lib/api/validation';
export const dynamic = 'force-dynamic';

const reverseSchema = z.object({
  reversalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'reversalDate must be YYYY-MM-DD.').optional(),
});

// POST /api/v1/payments/[id]/reverse — reverse one recorded payment with an
// equal-and-opposite journal while keeping the document subledger and the
// bank balance synchronized. write_posting. Idempotency-Key required.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'write_posting' });
  if (error) return error;

  const requestBody = await req.json().catch(() => null);
  const parsed = reverseSchema.safeParse(requestBody);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const idem = idempotencyContextFrom(req, { apiKeyId: context!.apiKeyId, companyId: context!.companyId }, requestBody);
  if ('error' in idem) return idem.error;

  let outcome;
  try {
    outcome = await withIdempotency(idem.context, async (tx) => {
      const payment = await tx.journalEntry.findFirst({
        where: { id: params.id, companyId: context!.companyId, sourceType: 'payment', voidedAt: null },
        select: { id: true, sourceId: true, sourceType: true },
      });
      if (!payment) {
        const err: any = new Error('Payment not found or already reversed.');
        err.__status = 404;
        err.__code = 'not_found';
        throw err;
      }

      const reversalDate = parsed.data.reversalDate
        ? (() => { const [y, m, d] = parsed.data.reversalDate!.split('-').map(Number); return new Date(y, m - 1, d); })()
        : new Date();
      const guard = await closedPeriodGuard(context!.companyId, reversalDate, tx);
      if (guard) return { resourceType: 'payment_reversal', resourceId: params.id, statusCode: guard.status, body: await guard.json() };

      // The payment entry references its document by id; resolve which kind.
      const sourceId = payment.sourceId;
      const invoice = sourceId
        ? await tx.invoice.findFirst({ where: { id: sourceId, companyId: context!.companyId }, select: { id: true } })
        : null;
      const bill = !invoice && sourceId
        ? await tx.bill.findFirst({ where: { id: sourceId, companyId: context!.companyId }, select: { id: true } })
        : null;
      if (!invoice && !bill) {
        const err: any = new Error('The document for this payment was not found.');
        err.__status = 404;
        err.__code = 'document_not_found';
        throw err;
      }
      const documentType: 'invoice' | 'bill' = invoice ? 'invoice' : 'bill';

      const result = await reverseDocumentPayment({
        paymentEntryId: params.id,
        documentId: sourceId ?? '',
        documentType,
        companyId: context!.companyId,
        reversalDate,
        userId: undefined,
      }, tx);

      return {
        resourceType: 'payment_reversal',
        resourceId: (result as any).reversal?.id ?? params.id,
        statusCode: 200,
        body: {
          data: {
            id: params.id,
            reversed: true,
            reversalEntryId: (result as any).reversal?.id ?? null,
            reversalDate: reversalDate.toISOString(),
          },
        },
      };
    }, { audit: { action: 'api.payment.reverse', entityType: 'payment', apiKeyName: context!.apiKeyName } });
  } catch (err: any) {
    if (err?.__status) {
      return NextResponse.json({ error: { code: err.__code, message: err.message } }, { status: err.__status });
    }
    console.error('POST /api/v1/payments/[id]/reverse error:', err);
    return NextResponse.json({ error: { code: 'payment_reversal_failed', message: err?.message ?? 'Failed to reverse payment.' } }, { status: 400 });
  }

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
