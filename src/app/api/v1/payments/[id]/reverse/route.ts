import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { reverseDocumentPayment } from '@/lib/journal';
import { auditLog } from '@/lib/api-helpers';
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

  const parsed = reverseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const idem = idempotencyContextFrom(req, { apiKeyId: context!.apiKeyId, companyId: context!.companyId });
  if ('error' in idem) return idem.error;

  let outcome;
  try {
    outcome = await withIdempotency(idem.context, async () => {
      const payment = await db.journalEntry.findFirst({
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

      // The payment entry references its document by id; resolve which kind.
      const sourceId = payment.sourceId;
      const invoice = sourceId
        ? await db.invoice.findFirst({ where: { id: sourceId, companyId: context!.companyId }, select: { id: true } })
        : null;
      const bill = !invoice && sourceId
        ? await db.bill.findFirst({ where: { id: sourceId, companyId: context!.companyId }, select: { id: true } })
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
      });

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
    });
  } catch (err: any) {
    if (err?.__status) {
      return NextResponse.json({ error: { code: err.__code, message: err.message } }, { status: err.__status });
    }
    console.error('POST /api/v1/payments/[id]/reverse error:', err);
    return NextResponse.json({ error: { code: 'payment_reversal_failed', message: err?.message ?? 'Failed to reverse payment.' } }, { status: 400 });
  }

  await auditLog(context!.companyId, undefined, 'api.payment.reverse', 'payment', params.id, undefined, {
    apiKeyId: context!.apiKeyId,
    apiKeyName: context!.apiKeyName,
  });

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
