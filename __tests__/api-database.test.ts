import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { withIdempotency, IdempotencyContext, requestFingerprint } from '@/lib/api/idempotency';
import { postInvoicePayment, PaymentPostingOptions } from '@/lib/journal';
import type { Prisma } from '@prisma/client';

// Actual PostgreSQL, no mocks. Never run against a deployed database.
const enabled = process.env.CI_API_DATABASE === '1';
const suite = enabled ? describe : describe.skip;

suite('API accounting transaction integration (PostgreSQL)', () => {
  let companyId: string;
  let apiKeyId: string;
  let invoiceId: string;
  let accountId: string;
  let webhookEndpointId: string;
  let options: PaymentPostingOptions;

  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ledgerpro_ci') {
      throw new Error('API database tests require the isolated local ledgerpro_ci database.');
    }
  });

  beforeEach(async () => {
    const tag = randomUUID();
    const company = await db.company.create({ data: { name: `API CI ${tag}`, fiscalYearStart: new Date('2026-01-01') } });
    companyId = company.id;
    const key = await db.apiKey.create({ data: { companyId, name: 'CI only', keyPrefix: 'ci', keyHash: tag, permissions: ['write_posting'] } });
    apiKeyId = key.id;
    const customer = await db.contact.create({ data: { companyId, name: 'CI customer', type: 'customer' } });
    await db.chartOfAccount.createMany({ data: [
      { companyId, code: '1010', name: 'CI cash', type: 'asset' },
      { companyId, code: '1100', name: 'CI receivable', type: 'asset' },
    ] });
    const account = await db.financialAccount.create({ data: { companyId, name: 'CI bank', kind: 'checking', glAccountCode: '1010' } });
    accountId = account.id;
    const endpoint = await db.webhookEndpoint.create({
      data: {
        companyId,
        url: 'http://127.0.0.1/webhook',
        secret: 'whsec_ci_only',
        events: ['payment.recorded'],
      },
    });
    webhookEndpointId = endpoint.id;
    invoiceId = `CI-${tag}`;
    await db.invoice.create({ data: { id: invoiceId, companyId, customerId: customer.id, issueDate: new Date('2026-01-02'), dueDate: new Date('2026-01-31'), subtotal: 100, total: 100, status: 'sent' } });
    options = { documentId: invoiceId, companyId, counterpartyName: 'CI customer', amountForeign: 25, currency: 'CAD', invoiceRate: 1, settlementRate: 1, paymentDate: new Date('2026-01-03'), paymentAccountCode: '1010', paymentAccountCurrency: 'CAD', paymentAccountId: accountId, fxAccountCode: '4310', roundingAccountCode: '4390' };
  });

  afterEach(async () => {
    if (!companyId) return;
    await db.journalLine.deleteMany({ where: { journalEntry: { companyId } } });
    await db.journalEntry.deleteMany({ where: { companyId } });
    await db.invoice.deleteMany({ where: { companyId } });
    await db.financialAccount.deleteMany({ where: { companyId } });
    await db.chartOfAccount.deleteMany({ where: { companyId } });
    await db.contact.deleteMany({ where: { companyId } });
    await db.auditLog.deleteMany({ where: { companyId } });
    await db.webhookEndpoint.deleteMany({ where: { companyId } });
    await db.apiKey.deleteMany({ where: { companyId } });
    await db.company.delete({ where: { id: companyId } });
  });
  afterAll(async () => { await db.$disconnect(); });

  const context = (requestKey: string): IdempotencyContext => ({ requestKey, apiKeyId, companyId, method: 'POST', path: '/api/v1/payments', requestHash: requestFingerprint(options) });
  const pay = async (tx: Prisma.TransactionClient) => {
    const entry = await postInvoicePayment(options, tx);
    return { resourceType: 'payment', resourceId: entry.id, statusCode: 201, body: { id: entry.id } };
  };
  const assertBalances = async (amount: number, journals: number) => {
    expect(Number((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).paidAmount)).toBe(amount);
    expect(Number((await db.financialAccount.findUniqueOrThrow({ where: { id: accountId } })).currentBalance)).toBe(amount);
    const entries = await db.journalEntry.findMany({ where: { companyId }, include: { lines: true } });
    expect(entries).toHaveLength(journals);
    for (const entry of entries) {
      expect(entry.lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0)).toBe(0);
    }
  };

  test('concurrent same-key payments execute once and replay the committed result', async () => {
    let executions = 0;
    const execute = async (tx: Prisma.TransactionClient) => {
      executions += 1;
      // Give the second independent transaction time to contend on the lock.
      await tx.$executeRaw`SELECT pg_sleep(0.15)`;
      return pay(tx);
    };
    const results = await Promise.all([withIdempotency(context('same'), execute), withIdempotency(context('same'), execute)]);
    expect(executions).toBe(1);
    expect(results.filter(r => r.replayed)).toHaveLength(1);
    expect(results[0].body).toEqual(results[1].body);
    expect(await db.apiIdempotencyRecord.count({ where: { apiKeyId } })).toBe(1);
    await assertBalances(25, 1);
  }, 30000);

  test('distinct keys on the same invoice preserve both payments and balances', async () => {
    await Promise.all([withIdempotency(context('first'), pay), withIdempotency(context('second'), pay)]);
    await assertBalances(50, 2);
  }, 30000);

  test('failed replay-record insertion rolls back journal, invoice and cash, then retry succeeds', async () => {
    const ctx = context('rollback');
    await expect(withIdempotency(ctx, async tx => {
      const outcome = await pay(tx);
      // Force the wrapper's final replay-record insert to violate its unique
      // constraint after real accounting writes have happened in this tx.
      await tx.apiIdempotencyRecord.create({ data: { ...ctx, resourceType: 'forced_failure', statusCode: 201, response: {} } });
      return outcome;
    })).rejects.toMatchObject({ code: 'P2002' });
    await assertBalances(0, 0);
    expect(await db.apiIdempotencyRecord.count({ where: { apiKeyId } })).toBe(0);
    expect((await withIdempotency(ctx, pay)).replayed).toBe(false);
    await assertBalances(25, 1);
  }, 30000);

  test('audit and webhook intent commit atomically, replay once, and reject a changed payload', async () => {
    const ctx = context('effects');
    const effects = {
      audit: { action: 'api.payment.record', entityType: 'payment', apiKeyName: 'CI only' },
      eventType: 'payment.recorded' as const,
    };

    await expect(withIdempotency(ctx, async tx => {
      const outcome = await pay(tx);
      // Force the wrapper's own record insert to fail after it has queued the
      // audit and webhook rows. All three effects must roll back together.
      await tx.apiIdempotencyRecord.create({
        data: { ...ctx, resourceType: 'forced_failure', statusCode: 201, response: {} },
      });
      return outcome;
    }, effects)).rejects.toMatchObject({ code: 'P2002' });

    expect(await db.auditLog.count({ where: { companyId } })).toBe(0);
    expect(await db.webhookDelivery.count({ where: { endpointId: webhookEndpointId } })).toBe(0);
    await assertBalances(0, 0);

    const first = await withIdempotency(ctx, pay, effects);
    expect(first.replayed).toBe(false);
    expect(await db.auditLog.count({ where: { companyId } })).toBe(1);
    expect(await db.webhookDelivery.count({ where: { endpointId: webhookEndpointId } })).toBe(1);

    const replay = await withIdempotency(ctx, pay, effects);
    expect(replay.replayed).toBe(true);
    expect(replay.body).toEqual(first.body);
    expect(await db.auditLog.count({ where: { companyId } })).toBe(1);
    expect(await db.webhookDelivery.count({ where: { endpointId: webhookEndpointId } })).toBe(1);

    const conflict = await withIdempotency({
      ...ctx,
      requestHash: requestFingerprint({ ...options, amountForeign: 99 }),
    }, pay, effects);
    expect(conflict.statusCode).toBe(409);
    expect((conflict.body as any).error.code).toBe('idempotency_key_conflict');
    await assertBalances(25, 1);
  }, 30000);
});
