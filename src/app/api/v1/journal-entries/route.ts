import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api/auth';
import { pageParamsFrom, cursorPage, prismaCursor } from '@/lib/api/pagination';
import { moneyString, isoDate } from '@/lib/api/serialize';
import { journalCreateSchema, validationErrorResponse, parseDateField } from '@/lib/api/validation';
import { idempotencyContextFrom, withIdempotency } from '@/lib/api/idempotency';
import { postJournalEntry } from '@/lib/journal';
import { closedPeriodGuard, auditLog } from '@/lib/api-helpers';
import { emitWebhookEvent } from '@/lib/webhooks';
import type { Prisma } from '@prisma/client';
export const dynamic = 'force-dynamic';

// GET /api/v1/journal-entries — the general journal with GL lines. Filters:
// sourceType, from, to, createdAfter (entries are append-only posted facts
// with no updatedAt). Bounded cursor pagination.
export async function GET(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'read' });
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const { limit, cursor } = pageParamsFrom(searchParams);
  const sourceType = searchParams.get('sourceType')?.trim() || null;
  const createdAfterRaw = searchParams.get('createdAfter');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const where: Prisma.JournalEntryWhereInput = { companyId: context!.companyId };
  if (sourceType) where.sourceType = sourceType as Prisma.JournalEntryWhereInput['sourceType'];
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
    data: result.data.map((e) => ({
      id: e.id,
      entryDate: isoDate(e.entryDate),
      description: e.description,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      voidedAt: isoDate(e.voidedAt),
      reversalOfId: e.reversalOfId,
      createdAt: isoDate(e.createdAt),
      lines: e.lines.map((l) => ({
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

// POST /api/v1/journal-entries — create and post a balanced journal
// (write_posting). Balance, active accounts and closed periods are enforced
// server-side. Idempotency-Key required.
export async function POST(req: NextRequest) {
  const { context, error } = await authenticateApiRequest(req, { permission: 'write_posting' });
  if (error) return error;

  const parsed = journalCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const entryDate = parseDateField(parsed.data.entryDate);
  const guard = await closedPeriodGuard(context!.companyId, entryDate);
  if (guard) return guard;

  const idem = idempotencyContextFrom(req, { apiKeyId: context!.apiKeyId, companyId: context!.companyId });
  if ('error' in idem) return idem.error;

  let outcome;
  try {
    outcome = await withIdempotency(idem.context, async (tx) => {
      const entry = await postJournalEntry(
        {
          entryDate,
          description: parsed.data.description,
          sourceType: 'manual',
          lines: parsed.data.lines.map((line) => ({
            glAccountCode: line.glAccountCode,
            description: line.description ?? undefined,
            debit: line.debit,
            credit: line.credit,
          })),
        },
        context!.companyId,
        tx
      );

      return {
        resourceType: 'journal_entry',
        resourceId: entry.id,
        statusCode: 201,
        body: { data: { id: entry.id, entryDate: entryDate.toISOString(), description: parsed.data.description, sourceType: 'manual' } },
      };
    });
  } catch (err: any) {
    const message = err?.message ?? '';
    const code = /balanced/i.test(message) ? 'journal_unbalanced' : /account/i.test(message) ? 'invalid_account' : 'journal_failed';
    const status = code === 'journal_failed' ? 400 : 400;
    return NextResponse.json({ error: { code, message: message || 'Failed to create journal entry.' } }, { status });
  }

  await auditLog(context!.companyId, undefined, 'api.journal.create', 'journal_entry', (outcome.body as any)?.data?.id ?? null, undefined, {
    apiKeyId: context!.apiKeyId,
    apiKeyName: context!.apiKeyName,
  });

  await emitWebhookEvent({
    companyId: context!.companyId,
    eventType: 'journal.posted',
    payload: {
      id: (outcome.body as any)?.data?.id,
      occurredAt: new Date().toISOString(),
    },
  });

  return NextResponse.json(outcome.body, { status: outcome.statusCode });
}
