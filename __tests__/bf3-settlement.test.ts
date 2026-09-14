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
const mockLinkFindUnique = jest.fn();
const mockLinkUpsert = jest.fn();
const mockLinkCreate = jest.fn();
const mockLinkUpdate = jest.fn();
const mockLinkUpdateMany = jest.fn();
const mockCoaFindFirst = jest.fn();
const mockBankRuleFindMany = jest.fn();
const mockMembershipFindMany = jest.fn();
const mockNotificationCreate = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    bankRule: { findMany: (...a: unknown[]) => mockBankRuleFindMany(...a) },
    membership: { findMany: (...a: unknown[]) => mockMembershipFindMany(...a) },
    notification: { create: (...a: unknown[]) => mockNotificationCreate(...a) },
    bankSyncRun: { update: (...a: unknown[]) => mockSyncRunUpdate(...a) },
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
          update: (...a: unknown[]) => mockLinkUpdate(...a),
          updateMany: (...a: unknown[]) => mockLinkUpdateMany(...a),
        },
        chartOfAccount: { findFirst: (...a: unknown[]) => mockCoaFindFirst(...a) },
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
  id: 'conn-1', companyId: 'co-1', status: 'active', transactionsCursor: null,
  cadence: 'daily', autoCategorize: true, notifyOnFailure: true,
  accessTokenEncrypted: 'v1.x', institutionName: 'RBC Royal Bank',
};
const feedAccount = { providerAccountId: 'pa-1', financialAccountId: 'fa-1', isFeeding: true, financialAccount: { lockedThrough: null } };
const settledItem = {
  providerTransactionId: 'ptx-settled', providerAccountId: 'pa-1', pendingTransactionId: 'ptx-pending',
  date: '2026-09-12', description: 'SETTLED DESC', amount: -50, currency: 'CAD',
};

describe('BF-3 settlement and notification wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTxQueryRaw.mockResolvedValue([]);
    mockConnectionFindUniqueOrThrow.mockResolvedValue(connection);
    mockSyncRunFindFirst.mockResolvedValue(null);
    mockSyncRunCreate.mockResolvedValue({ id: 'run-1' });
    mockSyncRunUpdate.mockResolvedValue({});
    mockFeedAccountFindMany.mockResolvedValue([feedAccount]);
    mockBankRuleFindMany.mockResolvedValue([]);
    mockTxFindFirst.mockResolvedValue(null);
    mockTxFindMany.mockResolvedValue([]);
    mockTxCreate.mockImplementation(async ({ data }: any) => ({ ...data, id: 'tx-new' }));
    mockTxUpdate.mockResolvedValue({});
    mockLinkFindUnique.mockResolvedValue(null);
    mockLinkUpdate.mockResolvedValue({});
    mockLinkUpdateMany.mockResolvedValue({ count: 0 });
    mockLinkUpsert.mockResolvedValue({});
    mockConnectionUpdate.mockResolvedValue({});
    mockCoaFindFirst.mockResolvedValue(null);
    mockMembershipFindMany.mockResolvedValue([{ userId: 'owner-1' }]);
    mockNotificationCreate.mockResolvedValue({});
  });

  test('a settled version updates the pending row in place and keeps the user categorization', async () => {
    mockSyncPage.mockResolvedValue({
      added: [settledItem], modified: [], removed: [], nextCursor: 'c-2', hasMore: false,
    });
    mockLinkFindUnique.mockResolvedValue({
      transaction: { id: 'tx-pending', status: 'toreview', reconciledInId: null, voidedAt: null, categoryId: 'cat-user', appliedRuleId: null },
    });

    const outcome = await syncConnection('conn-1', 'webhook');
    expect(outcome.settled).toBe(1);
    expect(outcome.added).toBe(0);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tx-pending' }, data: expect.objectContaining({ amount: -50 }) })
    );
    expect(mockTxUpdate.mock.calls[0][0].data.categoryId).toBeUndefined(); // categorization untouched
    expect(mockTxCreate).not.toHaveBeenCalled();
    expect(mockLinkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerTransactionId: 'ptx-settled', settledAt: expect.any(Date) }) })
    );
  });

  test('a settled version of an already-reconciled row is blocked and notifies', async () => {
    mockSyncPage.mockResolvedValue({
      added: [settledItem], modified: [], removed: [], nextCursor: 'c-2', hasMore: false,
    });
    mockLinkFindUnique.mockResolvedValue({
      transaction: { id: 'tx-pending', status: 'toreview', reconciledInId: 'rec-1', voidedAt: null, categoryId: null, appliedRuleId: null },
    });

    const outcome = await syncConnection('conn-1', 'webhook');
    expect(outcome.blockedUpdates).toBe(1);
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Bank feed: settlement blocked' }) })
    );
  });

  test('ambiguous overlap rows are created and flagged held', async () => {
    mockSyncPage.mockResolvedValue({
      added: [{ providerTransactionId: 'ptx-1', providerAccountId: 'pa-1', pendingTransactionId: null, date: '2026-09-10', description: 'STARBUCKS', amount: -12.5, currency: 'CAD' }],
      modified: [], removed: [], nextCursor: 'c-2', hasMore: false,
    });
    mockTxFindMany.mockResolvedValue([
      { id: 'r-old', date: new Date('2026-09-11'), amount: -12.5, description: 'AMAZON.CA' },
    ]);
    const outcome = await syncConnection('conn-1', 'webhook');
    expect(outcome.added).toBe(1);
    expect(outcome.held).toBe(1);
    expect(mockLinkCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ overlapCandidate: true }) })
    );
  });

  test('high-confidence overlap dedupes and links without creating a row', async () => {
    mockSyncPage.mockResolvedValue({
      added: [{ providerTransactionId: 'ptx-1', providerAccountId: 'pa-1', pendingTransactionId: null, date: '2026-09-10', description: 'STARBUCKS STORE 123', amount: -12.5, currency: 'CAD' }],
      modified: [], removed: [], nextCursor: 'c-2', hasMore: false,
    });
    mockTxFindMany.mockResolvedValue([
      { id: 'r-old', date: new Date('2026-09-11'), amount: -12.5, description: 'STARBUCKS STORE 123 TORONTO' },
    ]);
    const outcome = await syncConnection('conn-1', 'webhook');
    expect(outcome.deduped).toBe(1);
    expect(outcome.added).toBe(0);
    expect(mockLinkUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ transactionId: 'r-old' }) })
    );
  });

  test('modified rows inside a locked reconciliation are blocked and notified', async () => {
    mockFeedAccountFindMany.mockResolvedValue([
      { ...feedAccount, financialAccount: { lockedThrough: new Date('2026-12-31') } },
    ]);
    mockSyncPage.mockResolvedValue({
      added: [], nextCursor: 'c-2', hasMore: false, removed: [],
      modified: [{ providerTransactionId: 'ptx-mod', providerAccountId: 'pa-1', pendingTransactionId: null, date: '2026-09-11', description: 'CHANGED', amount: -20, currency: 'CAD' }],
    });
    mockLinkFindUnique.mockResolvedValue({
      transaction: { id: 'tx-mod', status: 'toreview', reconciledInId: null, voidedAt: null, date: new Date('2026-09-10') },
    });
    const outcome = await syncConnection('conn-1', 'webhook');
    expect(outcome.blockedUpdates).toBe(1);
    expect(outcome.updated).toBe(0);
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Bank feed: correction blocked' }) })
    );
  });

  test('provider removals keep the row and notify', async () => {
    mockSyncPage.mockResolvedValue({
      added: [], modified: [], removed: [{ transactionId: 'ptx-gone' }], nextCursor: 'c-2', hasMore: false,
    });
    mockLinkUpdateMany.mockResolvedValue({ count: 1 });
    const outcome = await syncConnection('conn-1', 'webhook');
    expect(outcome.removedMarked).toBe(1);
    expect(mockNotificationCreate).toHaveBeenCalled();
  });
});
