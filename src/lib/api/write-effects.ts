import type { Prisma } from '@prisma/client';
import type { WebhookEventType } from '@/lib/webhooks';

// Durable outbox insertion only: never perform network I/O in the accounting
// transaction and never swallow persistence failures. The delivery worker
// sends these pending rows after commit.
export async function queueApiWebhookEvent(tx: Prisma.TransactionClient, opts: {
  companyId: string;
  eventType: WebhookEventType;
  eventId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { companyId: opts.companyId, enabled: true, events: { has: opts.eventType } },
    select: { id: true },
  });
  if (!endpoints.length) return;
  await tx.webhookDelivery.createMany({ data: endpoints.map(endpoint => ({
    endpointId: endpoint.id,
    eventId: opts.eventId,
    eventType: opts.eventType,
    payload: opts.payload as Prisma.InputJsonObject,
    status: 'pending' as const,
    attempts: 0,
    nextAttemptAt: new Date(),
  })) });
}
