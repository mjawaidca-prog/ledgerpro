import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api/auth';
import { taxDecisionSchema, validationErrorResponse } from '@/lib/api/validation';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { postReviewedDocument } from '@/lib/api/posting';
export const dynamic = 'force-dynamic';

// POST /api/v1/bills/[id]/post — post a draft bill through the reviewed-tax
// engine (write_posting). Mirrors the invoice posting route.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'write_posting' });
  if (error) return error;

  const requestBody = await req.json().catch(() => null);
  const parsed = taxDecisionSchema.safeParse(requestBody);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const idem = idempotencyContextFrom(req, { apiKeyId: context!.apiKeyId, companyId: context!.companyId }, requestBody);
  if ('error' in idem) return idem.error;

  let outcome;
  try {
    outcome = await withIdempotency(idem.context, async (tx) => {
      const result = await postReviewedDocument({
        kind: 'bill',
        id: params.id,
        companyId: context!.companyId,
        apiKeyId: context!.apiKeyId,
        requestKey: parsed.data.requestKey,
        taxDecisions: parsed.data.lines,
      }, tx);
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
    }, { audit: { action: 'api.bill.post', entityType: 'bill', apiKeyName: context!.apiKeyName }, eventType: 'bill.updated' });
  } catch (err: any) {
    if (err?.__status) {
      return NextResponse.json({ error: { code: err.__code, message: err.message } }, { status: err.__status });
    }
    console.error('POST /api/v1/bills/[id]/post error:', err);
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to post bill.' } }, { status: 500 });
  }

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
