import { readFileSync } from 'node:fs';
const envRaw = readFileSync('.env.staging.local', 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}
const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient();
const mode = process.argv[2];
if (mode === 'create') {
  const good = await db.webhookEndpoint.create({
    data: {
      companyId: 'p1f-staging-ontario',
      url: 'https://webhook.site/11b70f3e-c5cf-4615-b23f-890eda3bea40',
      description: 'API-D rehearsal catcher',
      secret: 'whsec_rehearsal_catcher',
      events: ['invoice.created', 'invoice.posted', 'bill.created', 'bill.updated', 'payment.recorded', 'journal.posted'],
    },
  });
  const failing = await db.webhookEndpoint.create({
    data: {
      companyId: 'p1f-staging-ontario',
      url: 'https://httpstat.us/500',
      description: 'API-D rehearsal failing endpoint',
      secret: 'whsec_rehearsal_failing',
      events: ['invoice.created'],
    },
  });
  console.log('good=' + good.id + ' failing=' + failing.id);
} else if (mode === 'status') {
  const ds = await db.webhookDelivery.findMany({
    where: { endpoint: { companyId: 'p1f-staging-ontario' } },
    select: { id: true, eventType: true, status: true, attempts: true, lastError: true, nextAttemptAt: true, endpoint: { select: { url: true } } },
    orderBy: { createdAt: 'desc' },
  });
  console.log(JSON.stringify(ds, null, 1));
} else if (mode === 'reset-backoff') {
  const id = process.argv[3];
  await db.webhookDelivery.update({ where: { id }, data: { nextAttemptAt: new Date() } });
  console.log('reset ' + id);
} else if (mode === 'cleanup') {
  const del = await db.webhookEndpoint.deleteMany({ where: { companyId: 'p1f-staging-ontario' } });
  console.log('removed endpoints=' + del.count);
}
await db.$disconnect();
