import { db } from '@/lib/db';
import { encryptToken } from '@/lib/bank-feed/crypto';

// Only the external provider is mocked. Prisma, PostgreSQL transactions,
// advisory locks, encrypted-token decoding and accounting records are real.
const mockSyncPage = jest.fn();
jest.mock('@/lib/bank-feed/plaid-client', () => ({
  syncTransactionsPage: (...args: unknown[]) => mockSyncPage(...args),
}));
import { syncConnection } from '@/lib/bank-feed/sync';

const run = process.env.CI_BF_DATABASE === '1' ? describe : describe.skip;
const companyId = 'bf5-ci-company';
const connectionId = 'bf5-ci-connection';
const bankId = 'bf5-ci-bank';
const page = (overrides: Record<string, unknown> = {}) => ({
  added: [], modified: [], removed: [], nextCursor: 'cursor-complete', hasMore: false, ...overrides,
});
const item = (id: string) => ({
  providerTransactionId: id, providerAccountId: 'bf5-provider-account', pendingTransactionId: null,
  date: '2026-09-01', description: 'Synthetic coffee purchase', amount: -5, currency: 'CAD',
});

run('BF-5 real PostgreSQL sync lifecycle', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ledgerpro_ci') {
      throw new Error('These fixtures may run only against the disposable CI database.');
    }
    process.env.BANK_FEED_KEK = Buffer.alloc(32, 19).toString('base64');
    process.env.PLAID_ENV = 'sandbox';
    process.env.VERCEL_ENV = 'preview';
    process.env.BANK_FEEDS_DISABLED = 'false';
    await db.company.create({ data: { id: companyId, name: 'BF-5 synthetic database rehearsal', fiscalYearStart: new Date('2026-01-01') } });
    await db.financialAccount.create({ data: { id: bankId, companyId, name: 'Synthetic bank', kind: 'checking', currency: 'CAD' } });
  });

  beforeEach(async () => {
    mockSyncPage.mockReset();
    await db.bankConnection.create({ data: {
      id: connectionId, companyId, itemId: 'bf5-provider-item', institutionName: 'Synthetic provider',
      accessTokenEncrypted: encryptToken('synthetic-access-token'), transactionsCursor: 'cursor-start',
      notifyOnFailure: false, autoCategorize: false,
      accounts: { create: { providerAccountId: 'bf5-provider-account', name: 'Synthetic account', subtype: 'checking', currency: 'CAD', financialAccountId: bankId, isFeeding: true } },
    } });
  });

  afterEach(async () => {
    await db.bankConnection.deleteMany({ where: { companyId } });
    await db.transaction.deleteMany({ where: { companyId } });
  });
  afterAll(async () => {
    await db.financialAccount.deleteMany({ where: { companyId } });
    await db.company.deleteMany({ where: { id: companyId } });
    await db.$disconnect();
  });

  test('second-page failure rolls back rows and cursor but persists a failure record', async () => {
    mockSyncPage.mockResolvedValueOnce(page({ added: [item('bf5-row-1')], nextCursor: 'cursor-partial', hasMore: true }))
      .mockRejectedValueOnce(new Error('Synthetic provider failure'));
    await expect(syncConnection(connectionId, 'manual')).rejects.toThrow('Synthetic provider failure');
    expect(await db.transaction.count({ where: { companyId } })).toBe(0);
    expect(await db.bankFeedTransaction.count({ where: { connectionId } })).toBe(0);
    expect((await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).transactionsCursor).toBe('cursor-start');
    const runs = await db.bankSyncRun.findMany({ where: { connectionId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'failed', addedCount: 0, dedupedCount: 0 });

    mockSyncPage.mockResolvedValue(page({ added: [item('bf5-row-1')] }));
    expect((await syncConnection(connectionId, 'manual')).added).toBe(1);
    expect(mockSyncPage.mock.calls[2][0].cursor).toBe('cursor-start');
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  test('identical purchases with distinct provider IDs survive; replay adds neither again', async () => {
    mockSyncPage.mockResolvedValue(page({ added: [item('bf5-row-1'), item('bf5-row-2')] }));
    expect((await syncConnection(connectionId, 'manual')).added).toBe(2);
    expect((await syncConnection(connectionId, 'manual')).deduped).toBe(2);
    expect(await db.transaction.count({ where: { companyId, status: 'toreview' } })).toBe(2);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  test('overlapping sync waits for the first commit and reads its committed cursor', async () => {
    let release!: () => void;
    let entered!: () => void;
    const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const providerRelease = new Promise<void>((resolve) => { release = resolve; });
    mockSyncPage.mockImplementationOnce(async () => {
      entered();
      await providerRelease;
      return page({ added: [item('bf5-concurrent')] });
    }).mockResolvedValue(page());
    const first = syncConnection(connectionId, 'manual');
    await providerEntered;
    const second = syncConnection(connectionId, 'cron');
    let sawWaitingLock = false;
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const locks = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) AS waiting`;
        if (locks[0]?.waiting) { sawWaitingLock = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally { release(); }
    await Promise.all([first, second]);
    expect(sawWaitingLock).toBe(true);
    expect(mockSyncPage.mock.calls.map(([args]) => args.cursor)).toEqual(['cursor-start', 'cursor-complete']);
    expect(await db.transaction.count({ where: { companyId } })).toBe(1);
    expect(await db.bankSyncRun.count({ where: { connectionId, status: 'success' } })).toBe(2);
  }, 15000);
});
