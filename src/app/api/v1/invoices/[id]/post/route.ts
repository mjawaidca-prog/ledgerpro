import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api/auth';
import { taxDecisionSchema, validationErrorResponse } from '@/lib/api/validation';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { postReviewedDocument } from '@/lib/api/posting';
import { auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// POST /api/v1/invoices/[id]/post — post a draft invoice through the
// reviewed-tax engine (write_posting). The tax decision travels in the body,
// the engine recomputes every amount server-side, and the posting is
// idempotent on (key, Idempotency-Key, sourceKey).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'write_posting' });
  if (error) return error;

  const parsed = taxDecisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const idem = idempotencyContextFrom(req, { apiKeyId: context!.apiKeyId, companyId: context!.companyId });
  if ('error' in idem) return idem.error;

  let outcome;
  try {
    outcome = await withIdempotency(idem.context, async () => {
      const result = await postReviewedDocument({
        kind: 'invoice',
        id: params.id,
        companyId: context!.companyId,
        apiKeyId: context!.apiKeyId,
        requestKey: parsed.data.requestKey,
        taxDecisions: parsed.data.lines,
      });
      if (!result.ok) {
        // Business failures are NOT recorded as idempotent outcomes — a
        // corrected retry with the same key must be able to succeed.
        const err: any = new Error(result.message);
        err.__status = result.status;
        err.__code = result.code;
        throw err;
      }
      return {
        resourceType: 'invoice_posting',
        resourceId: result.document.id,
        statusCode: 200,
        body: { data: result.document },
      };
    });
  } catch (err: any) {
    if (err?.__status) {
      return NextResponse.json({ error: { code: err.__code, message: err.message } }, { status: err.__status });
    }
    console.error('POST /api/v1/invoices/[id]/post error:', err);
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to post invoice.' } }, { status: 500 });
  }

  await auditLog(context!.companyId, undefined, 'api.invoice.post', 'invoice', params.id, undefined, {
    apiKeyId: context!.apiKeyId,
    apiKeyName: context!.apiKeyName,
  });

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
