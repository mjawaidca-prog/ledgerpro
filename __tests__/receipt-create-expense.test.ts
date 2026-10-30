/**
 * Cash-expense fix (2026-10-30) — receipts could only attach to an
 * existing bank transaction, and no cash account kind existed, so a
 * cash purchase could not be recorded from a receipt at all.
 *
 * Part 1 pins the migration/schema/COA shape. Part 2 pins the service
 * behavior against a mocked db: the paid-from account is resolved
 * (Cash auto-created on first use, linked to GL 1040), a negative
 * transaction is created on it, the receipt attaches, and the
 * suggested split is applied — still unposted, like attach.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

jest.mock('unpdf', () => ({ getDocumentProxy: jest.fn(), extractText: jest.fn() }));
jest.mock('tesseract.js', () => ({ createWorker: jest.fn() }));
jest.mock('@/lib/db', () => ({
  db: {
    receipt: { findFirst: jest.fn(), update: jest.fn() },
    transaction: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    financialAccount: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    company: { findUnique: jest.fn() },
    periodClose: { findFirst: jest.fn() },
  },
}));
jest.mock('@/lib/default-coa', () => ({
  ...jest.requireActual('@/lib/default-coa'),
  getDefaultFinancialAccountGlCode: jest.fn(async () => '1040'),
}));
// The period/lock guards are route-layer helpers with their own coverage;
// here they are stubbed open so the service logic is what is under test.
jest.mock('@/lib/api-helpers', () => ({
  closedPeriodGuard: jest.fn(async () => null),
  accountLockedGuard: jest.fn(async () => null),
}));

import { db } from '@/lib/db';
import { createExpenseFromReceipt } from '@/lib/receipts/service';

const mockDb = db as any;

const receiptRow = {
  id: 'r1',
  companyId: 'c1',
  transactionId: null,
  originalFileName: 'receipt-photo.png',
  mimeType: 'image/png',
  sizeBytes: 100,
  status: 'inbox',
  ocrStatus: 'done',
  ocrMerchant: 'TIM HORTONS #4521',
  ocrDate: new Date('2026-10-15T12:00:00.000Z'),
  ocrTotal: 5.54,
  ocrSubtotal: 5.28,
  ocrTaxAmount: 0.26,
  ocrConfidence: 1,
  suggestedCategoryId: 'coa1',
  suggestedCategory: { code: '6800' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.periodClose.findFirst.mockResolvedValue(null);
  mockDb.company.findUnique.mockResolvedValue({ province: 'AB' });
  mockDb.financialAccount.findUnique.mockResolvedValue({ id: 'fa1', lockedThrough: null });
  mockDb.transaction.create.mockResolvedValue({ id: 'tx-new' });
  mockDb.transaction.update.mockResolvedValue({});
  mockDb.transaction.findUnique.mockResolvedValue({ id: 'tx-new', amount: -5.54 });
  mockDb.receipt.update.mockResolvedValue({ ...receiptRow, transactionId: 'tx-new', status: 'attached' });
});

describe('cash account kind — schema, migration, COA', () => {
  const migration = readFileSync(
    resolve('prisma/migrations/20261030030000_cash_account_kind/migration.sql'),
    'utf8',
  );
  const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');
  const coa = readFileSync(resolve('src/lib/default-coa.ts'), 'utf8');

  test('migration adds the cash enum value and nothing else destructive', () => {
    expect(migration).toMatch(/ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'cash'/);
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)/i);
  });

  test('schema AccountKind carries cash', () => {
    expect(schema).toMatch(/enum AccountKind \{[^}]*\bcash\b[^}]*\}/);
  });

  test('default COA seeds Petty Cash 1040 and maps the cash kind to it', () => {
    expect(coa).toMatch(/'payoutclearing', 'cash'/);
    expect(coa).toMatch(/code: '1040', name: 'Petty Cash'/);
    expect(coa).toMatch(/cash: \['1040', '1000'\]/);
  });
});

describe('createExpenseFromReceipt', () => {
  test('creates the Cash account on first use, linked to GL 1040', async () => {
    mockDb.receipt.findFirst.mockResolvedValue({ ...receiptRow });
    mockDb.financialAccount.findFirst.mockResolvedValue(null);
    mockDb.financialAccount.create.mockResolvedValue({ id: 'fa-cash', kind: 'cash', name: 'Cash' });

    const result = await createExpenseFromReceipt({ companyId: 'c1', receiptId: 'r1', paidFrom: 'cash' });

    expect(mockDb.financialAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Cash', kind: 'cash', glAccountCode: '1040' }),
      }),
    );
    expect(mockDb.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          financialAccountId: 'fa-cash',
          amount: -5.54,
          merchant: 'TIM HORTONS #4521',
          dedupeHash: expect.any(String),
        }),
      }),
    );
    // Receipt attached + suggested split applied, still unposted.
    expect(mockDb.receipt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transactionId: 'tx-new', status: 'attached' }) }),
    );
    expect(mockDb.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'categorized', splits: [expect.objectContaining({ categoryCode: '6800' })] }),
      }),
    );
    expect(result?.accountKind).toBe('cash');
    expect(result?.transactionId).toBe('tx-new');
  });

  test('reuses an existing Cash account instead of creating one', async () => {
    mockDb.receipt.findFirst.mockResolvedValue({ ...receiptRow });
    mockDb.financialAccount.findFirst.mockResolvedValue({ id: 'fa-cash', kind: 'cash', name: 'Cash' });

    const result = await createExpenseFromReceipt({ companyId: 'c1', receiptId: 'r1', paidFrom: 'cash' });

    expect(mockDb.financialAccount.create).not.toHaveBeenCalled();
    expect(result?.accountId).toBe('fa-cash');
  });

  test('honours a specific paid-from account', async () => {
    mockDb.receipt.findFirst.mockResolvedValue({ ...receiptRow });
    mockDb.financialAccount.findFirst.mockResolvedValue({ id: 'fa-card', kind: 'creditcard', name: 'Visa' });

    const result = await createExpenseFromReceipt({ companyId: 'c1', receiptId: 'r1', paidFrom: 'fa-card' });

    expect(mockDb.financialAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'fa-card', companyId: 'c1' }) }),
    );
    expect(result?.accountKind).toBe('creditcard');
  });

  test('refuses without a total or a date, and when already attached', async () => {
    mockDb.receipt.findFirst.mockResolvedValue({ ...receiptRow, ocrTotal: null });
    await expect(createExpenseFromReceipt({ companyId: 'c1', receiptId: 'r1', paidFrom: 'cash' })).rejects.toThrow(/total/i);

    mockDb.receipt.findFirst.mockResolvedValue({ ...receiptRow, ocrDate: null });
    await expect(createExpenseFromReceipt({ companyId: 'c1', receiptId: 'r1', paidFrom: 'cash' })).rejects.toThrow(/date/i);

    mockDb.receipt.findFirst.mockResolvedValue({ ...receiptRow, transactionId: 'tx-other' });
    await expect(createExpenseFromReceipt({ companyId: 'c1', receiptId: 'r1', paidFrom: 'cash' })).rejects.toThrow(/already attached/i);
  });

  test('returns null for a receipt of another company', async () => {
    mockDb.receipt.findFirst.mockResolvedValue(null);
    await expect(createExpenseFromReceipt({ companyId: 'c1', receiptId: 'nope', paidFrom: 'cash' })).resolves.toBeNull();
  });
});
