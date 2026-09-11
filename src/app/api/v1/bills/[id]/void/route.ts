import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api/auth';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { voidReviewedDocument } from '@/lib/api/posting';
import { auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// POST /api/v1/bills/[id]/void — void a draft (deleted) or a posted bill
// (tax-posting reversal, only when no payments remain). write_posting.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'write_posting' });
  if (error) return error;

  const idem = idempotencyContextFrom(req, { apiKeyId: context!.apiKeyId, companyId: context!.companyId });
  if ('error' in idem) return idem.error;

  let outcome;
  try {
    outcome = await withIdempotency(idem.context, async () => {
      const result = await voidReviewedDocument({
        kind: 'bill',
        id: params.id,
        companyId: context!.companyId,
        apiKeyId: context!.apiKeyId,
      });
      if (!result.ok) {
        const err: any = new Error(result.message);
        err.__status = result.status;
        err.__code = result.code;
        throw err;
      }
      return {
        resourceType: 'bill_void',
        resourceId: result.id,
        statusCode: 200,
        body: { data: { id: result.id, status: result.status, mode: result.mode } },
      };
    });
  } catch (err: any) {
    if (err?.__status) {
      return NextResponse.json({ error: { code: err.__code, message: err.message } }, { status: err.__status });
    }
    console.error('POST /api/v1/bills/[id]/void error:', err);
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to void bill.' } }, { status: 500 });
  }

  await auditLog(context!.companyId, undefined, 'api.bill.void', 'bill', params.id, undefined, {
    apiKeyId: context!.apiKeyId,
    apiKeyName: context!.apiKeyName,
  });

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
