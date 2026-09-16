import { NextRequest } from 'next/server';

process.env.BANK_FEED_KEK = Buffer.alloc(32, 7).toString('base64');

const mockTxQueryRaw = jest.fn();
const mockConnectionFindUniqueOrThrow = jest.fn();
const mockConnectionUpdate = jest.fn();
const mockSyncRunFindFirst = jest.fn();
const mockSyncRunCreate = jest.fn();
const mockSyncRunUpdate = jest.fn();
const mockFeedAccountFindMany = jest.fn();
const mockTxFindFirst = jest.fn();
const mockTxFindMany = jest.fn();
const mockTxCreate = jest.fn();
const mockTxUpdate = jest.fn();
const mockMembershipFindMany = jest.fn();
const mockNotificationCreate = jest.fn();
const mockLinkFindUnique = jest.fn();
const mockLinkUpsert = jest.fn();
const mockLinkCreate = jest.fn();
const mockLinkUpdateMany = jest.fn();
const mockCoaFindFirst = jest.fn();
const mockBankRuleFindMany = jest.fn();
const mockJournalCreate = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    bankRule: { findMany: (...a: unknown[]) => mockBankRuleFindMany(...a) },
    membership: { findMany: (...a: unknown[]) => mockMembershipFindMany(...a) },
    notification: { create: (...a: unknown[]) => mockNotificationCreate(...a) },
    // Failure marking runs outside the transaction on the db-level client.
    bankSyncRun: { update: (...a: unknown[]) => mockSyncRunUpdate(...a), create: (...a: unknown[]) => mockSyncRunCreate(...a) },
    $transaction: (fn: unknown) =>
      fn({
        $queryRaw: (...a: unknown[]) => mockTxQueryRaw(...a),
        bankConnection: { findUniqueOrThrow: (...a: unknown[]) => mockConnectionFindUniqueOrThrow(...a), update: (...a: unknown[]) => mockConnectionUpdate(...a) },
        bankSyncRun: {
          findFirst: (...a: unknown[]) => mockSyncRunFindFirst(...a),
          create: (...a: unknown[]) => mockSyncRunCreate(...a),
          update: (...a: unknown[]) => mockSyncRunUpdate(...a),
        },
        bankFeedAccount: { findMany: (...a: unknown[]) => mockFeedAccountFindMany(...a) },
        transaction: {
          findFirst: (...a: unknown[]) => mockTxFindFirst(...a),
          findMany: (...a: unknown[]) => mockTxFindMany(...a),
          create: (...a: unknown[]) => mockTxCreate(...a),
          update: (...a: unknown[]) => mockTxUpdate(...a),
        },
        bankFeedTransaction: {
          findUnique: (...a: unknown[]) => mockLinkFindUnique(...a),
          upsert: (...a: unknown[]) => mockLinkUpsert(...a),
          create: (...a: unknown[]) => mockLinkCreate(...a),
          updateMany: (...a: unknown[]) => mockLinkUpdateMany(...a),
        },
        chartOfAccount: { findFirst: (...a: unknown[]) => mockCoaFindFirst(...a) },
        journalEntry: { create: (...a: unknown[]) => mockJournalCreate(...a) },
      }),
  },
}));

const mockSyncPage = jest.fn();
jest.mock('@/lib/bank-feed/plaid-client', () => ({
  syncTransactionsPage: (...a: unknown[]) => mockSyncPage(...a),
}));
jest.mock('@/lib/bank-feed/crypto', () => ({
  decryptToken: jest.fn().mockReturnValue('decrypted-token'),
}));

import { syncConnection } from '@/lib/bank-feed/sync';

const connection = {
  id: 'conn-1',
  companyId: 'co-1',
  status: 'active',
  transactionsCursor: null,
  cadence: 'daily',
  autoCategorize: true,
  notifyOnFailure: true,
  accessTokenEncrypted: 'v1.whatever',
};

const feedAccount = { providerAccountId: 'pa-1', financialAccountId: 'fa-1', isFeeding: true };

describe('BF-2 sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTxQueryRaw.mockResolvedValue([]);
    mockConnectionFindUniqueOrThrow.mockResolvedValue(connection);
    mockSyncRunFindFirst.mockResolvedValue(null);
    mockSyncRunCreate.mockResolvedValue({ id: 'run-1', status: 'running' });
    mockSyncRunUpdate.mockResolvedValue({});
    mockFeedAccountFindMany.mockResolvedValue([feedAccount]);
    mockBankRuleFindMany.mockResolvedValue([]);
    mockTxFindFirst.mockResolvedValue(null);
    mockTxFindMany.mockResolvedValue([]);
    mockMembershipFindMany.mockResolvedValue([]);
    mockNotificationCreate.mockResolvedValue({});
    mockTxCreate.mockImplementation(async ({ data }: any) => ({ ...data, id: 'tx-1' }));
    mockLinkFindUnique.mockResolvedValue(null);
    mockLinkUpdateMany.mockResolvedValue({ count: 0 });
    mockConnectionUpdate.mockResolvedValue({});
    mockCoaFindFirst.mockResolvedValue(null);
  });

  const page = (overrides: any = {}) => ({
    added: [],
    modified: [],
    removed: [],
    nextCursor: 'cursor-2',
    hasMore: false,
    ...overrides,
  });

  test('early webhook before mapping preserves initial cursor', async () => {
    mockFeedAccountFindMany.mockResolvedValue([]);
    expect((await syncConnection('conn-1', 'webhook')).skipped).toBe(true);
    expect(mockSyncPage).not.toHaveBeenCalled();
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
  });

  test('pagination budget fails the full batch and records failure', async () => {
    mockSyncPage.mockResolvedValue(page({ hasMore: true }));
    await expect(syncConnection('conn-1', 'manual')).rejects.toThrow('page budget');
    expect(mockSyncPage).toHaveBeenCalledTimes(8);
    expect(mockSyncRunCreate).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed', addedCount: 0 }) }));
  });

  test('added rows become review-queue transactions with the shared dedupe key — and no journal entries', async () => {
    mockSyncPage.mockResolvedValue(
      page({
        added: [
          {
            providerTransactionId: 'ptx-1',
            providerAccountId: 'pa-1',
            pendingTransactionId: null,
            date: '2026-09-10',
            description: 'STARBUCKS STORE 123',
            amount: -12.5,
            currency: 'CAD',
          },
        ],
      })
    );

    const outcome = await syncConnection('conn-1', 'cron');
    expect(outcome.added).toBe(1);
    expect(outcome.skipped).toBe(false);

    const createArg = mockTxCreate.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      companyId: 'co-1',
      financialAccountId: 'fa-1',
      amount: -12.5,
      currency: 'CAD',
      status: 'toreview',
      source: 'feed',
    });
    expect(createArg.data.dedupeHash).toBeTruthy();
    expect(mockJournalCreate).not.toHaveBeenCalled();
    expect(mockLinkCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerTransactionId: 'ptx-1', transactionId: 'tx-1' }) })
    );
  });

  test('applies bank rules exactly like imports (auto-categorized, still to review)', async () => {
    mockBankRuleFindMany.mockResolvedValue([
      {
        id: 'rule-1', name: 'Coffee', order: 1, op: 'contains', value: 'starbucks', anyOf: [],
        scope: { accountIds: 'all', direction: 'out' }, setCategoryCode: '6000', setTaxCode: null,
        setTaxRate: null, setTaxInclusive: true, setContactId: null, autoPost: false, enabled: true,
      },
    ]);
    mockCoaFindFirst.mockResolvedValue({ id: 'coa-6000' });
    mockSyncPage.mockResolvedValue(
      page({ added: [{ providerTransactionId: 'ptx-2', providerAccountId: 'pa-1', pendingTransactionId: null, date: '2026-09-10', description: 'STARBUCKS', amount: -6, currency: 'CAD' }] })
    );
    await syncConnection('conn-1', 'cron');
    const createArg = mockTxCreate.mock.calls[0][0];
    expect(createArg.data.categoryId).toBe('coa-6000');
    expect(createArg.data.appliedRuleId).toBe('rule-1');
    expect(createArg.data.status).toBe('toreview'); // never posted, never reconciled
  });

  test('the cursor advances in the same transaction as the committed rows', async () => {
    mockSyncPage.mockResolvedValue(page({ added: [], nextCursor: 'cursor-9', hasMore: false }));
    await syncConnection('conn-1', 'cron');
    expect(mockConnectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transactionsCursor: 'cursor-9', lastSyncAt: expect.any(Date) }) })
    );
  });

  test('an overlapping run is skipped without calling the provider', async () => {
    mockSyncRunFindFirst.mockResolvedValue({ id: 'running-run', status: 'running' });
    const outcome = await syncConnection('conn-1', 'webhook');
    expect(outcome.skipped).toBe(true);
    expect(mockSyncPage).not.toHaveBeenCalled();
  });

  test('a dedupe hit links to the existing row without creating a duplicate', async () => {
    mockTxFindFirst.mockResolvedValue({ id: 'existing-tx' });
    mockSyncPage.mockResolvedValue(
      page({ added: [{ providerTransactionId: 'ptx-3', providerAccountId: 'pa-1', pendingTransactionId: null, date: '2026-09-10', description: 'DUP', amount: -1, currency: 'CAD' }] })
    );
    const outcome = await syncConnection('conn-1', 'cron');
    expect(outcome.deduped).toBe(1);
    expect(mockTxCreate).not.toHaveBeenCalled();
    expect(mockLinkUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ transactionId: 'existing-tx' }) })
    );
  });

  test('modified rows update only review-queue rows; reconciled rows are blocked', async () => {
    mockLinkFindUnique
      .mockResolvedValueOnce({ transaction: { id: 'tx-a', status: 'toreview', reconciledInId: null, voidedAt: null } })
      .mockResolvedValueOnce({ transaction: { id: 'tx-b', status: 'toreview', reconciledInId: 'rec-1', voidedAt: null } });
    mockSyncPage.mockResolvedValue(
      page({
        modified: [
          { providerTransactionId: 'ptx-a', providerAccountId: 'pa-1', pendingTransactionId: null, date: '2026-09-11', description: 'CHANGED A', amount: -20, currency: 'CAD' },
          { providerTransactionId: 'ptx-b', providerAccountId: 'pa-1', pendingTransactionId: null, date: '2026-09-11', description: 'CHANGED B', amount: -21, currency: 'CAD' },
        ],
      })
    );
    const outcome = await syncConnection('conn-1', 'cron');
    expect(outcome.updated).toBe(1);
    expect(outcome.blockedUpdates).toBe(1);
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
  });

  test('removed provider rows mark the link and never delete the ledger row', async () => {
    mockLinkUpdateMany.mockResolvedValue({ count: 1 });
    mockSyncPage.mockResolvedValue(page({ removed: [{ transactionId: 'ptx-gone' }] }));
    const outcome = await syncConnection('conn-1', 'cron');
    expect(outcome.removedMarked).toBe(1);
    expect(mockLinkUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { removedByProviderAt: expect.any(Date) } })
    );
  });

  test('a failed page marks the run failed and rethrows', async () => {
    mockSyncPage.mockRejectedValue(new Error('provider boom'));
    await expect(syncConnection('conn-1', 'webhook')).rejects.toThrow('provider boom');
    expect(mockSyncRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
  });
});
