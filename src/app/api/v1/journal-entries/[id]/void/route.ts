import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api/auth';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { voidJournalEntry } from '@/lib/journal';
import { auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// POST /api/v1/journal-entries/[id]/void — void a posted journal entry with
// an equal-and-opposite reversal (nothing is deleted). write_posting.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'write_posting' });
  if (error) return error;

  const idem = idempotencyContextFrom(req, { apiKeyId: context!.apiKeyId, companyId: context!.companyId });
  if ('error' in idem) return idem.error;

  let outcome;
  try {
    outcome = await withIdempotency(idem.context, async () => {
      const result = await voidJournalEntry(params.id, context!.companyId, undefined);
      return {
        resourceType: 'journal_void',
        resourceId: params.id,
        statusCode: 200,
        body: { data: { id: params.id, voided: true } },
      };
    });
  } catch (err: any) {
    const message = err?.message ?? '';
    if (/not found/i.test(message)) {
      return NextResponse.json({ error: { code: 'not_found', message } }, { status: 404 });
    }
    if (/already been voided/i.test(message)) {
      return NextResponse.json({ error: { code: 'already_voided', message } }, { status: 409 });
    }
    console.error('POST /api/v1/journal-entries/[id]/void error:', err);
    return NextResponse.json({ error: { code: 'journal_void_failed', message: message || 'Failed to void journal entry.' } }, { status: 400 });
  }

  await auditLog(context!.companyId, undefined, 'api.journal.void', 'journal_entry', params.id, undefined, {
    apiKeyId: context!.apiKeyId,
    apiKeyName: context!.apiKeyName,
  });

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
