import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { assertTaxMutationRole, TaxPostingError } from './posting-service';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Persist the document, posting, and replay receipt in the same transaction. */
export async function withReviewedDocumentRequest<T>(
  request: { companyId: string; userId: string; kind: 'invoice' | 'bill'; key: string; payload: unknown },
  create: (tx: Prisma.TransactionClient, id: string) => Promise<T>,
  replay: (tx: Prisma.TransactionClient, id: string) => Promise<T>,
): Promise<T> {
  const digest = createHash('sha256').update(`${request.companyId}:${request.kind}:${request.key}`).digest('hex');
  const id = `${request.kind === 'invoice' ? 'INV' : 'BILL'}-${digest.slice(0, 32)}`;
  const requestHash = createHash('sha256').update(canonical({ userId: request.userId, payload: request.payload })).digest('hex');
  return db.$transaction(async tx => {
    const membership = await tx.membership.findUnique({ where: { userId_companyId: { companyId: request.companyId, userId: request.userId } } });
    assertTaxMutationRole(membership?.role);
    // Serialize concurrent retries, including when the first request has not committed yet.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0))::text`;
    const receipt = await tx.auditLog.findFirst({ where: { companyId: request.companyId, action: 'tax.document.create', entityId: id } });
    if (receipt) {
      if ((receipt.metadata as { requestHash?: string } | null)?.requestHash !== requestHash) {
        throw new TaxPostingError('idempotency_key_reused', 'This save request was already used for different document contents. Reload the form before creating a different document.', 409);
      }
      return replay(tx, id);
    }
    const result = await create(tx, id);
    await tx.auditLog.create({ data: { companyId: request.companyId, userId: request.userId, action: 'tax.document.create', entityType: request.kind, entityId: id, metadata: { requestHash } } });
    return result;
  }, { maxWait: 10000, timeout: 30000 });
}
