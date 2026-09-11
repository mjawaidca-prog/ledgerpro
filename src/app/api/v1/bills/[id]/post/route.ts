import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api/auth';
import { taxDecisionSchema, validationErrorResponse } from '@/lib/api/validation';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { postReviewedDocument } from '@/lib/api/posting';
import { auditLog } from '@/lib/api-helpers';
import { emitWebhookEvent } from '@/lib/webhooks';
export const dynamic = 'force-dynamic';

// POST /api/v1/bills/[id]/post — post a draft bill through the reviewed-tax
// engine (write_posting). Mirrors the invoice posting route.
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
        kind: 'bill',
        id: params.id,
        companyId: context!.companyId,
        apiKeyId: context!.apiKeyId,
        requestKey: parsed.data.requestKey,
        taxDecisions: parsed.data.lines,
      });
      if (!result.ok) {
        const err: any = new Error(result.message);
        err.__status = result.status;
        err.__code = result.code;
        throw err;
      }
      return {
        resourceType: 'bill_posting',
        resourceId: result.document.id,
        statusCode: 200,
        body: { data: result.document },
      };
    });
  } catch (err: any) {
    if (err?.__status) {
      return NextResponse.json({ error: { code: err.__code, message: err.message } }, { status: err.__status });
    }
    console.error('POST /api/v1/bills/[id]/post error:', err);
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to post bill.' } }, { status: 500 });
  }

  await auditLog(context!.companyId, undefined, 'api.bill.post', 'bill', params.id, undefined, {
    apiKeyId: context!.apiKeyId,
    apiKeyName: context!.apiKeyName,
  });

  await emitWebhookEvent({
    companyId: context!.companyId,
    eventType: 'bill.updated',
    payload: {
      id: params.id,
      status: (outcome.body as any)?.data?.status,
      occurredAt: new Date().toISOString(),
    },
  });

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
