/**
 * Phase 1 cleanup — filed-period HARD LOCK.
 * Guard unit tests (mocked db, same style as phase1-5-services.test.ts),
 * a journal-route test (blocked create → 409; tax-neutral create in the
 * same filed period → 201), and posting-service (postBankRow) tests
 * (tax split into a filed period blocked; plain posting allowed).
 */
class DecimalStub {
  v: number;
  constructor(value: unknown) { this.v = value instanceof DecimalStub ? value.v : Number(value as never); }
  toNumber() { return this.v; }
}
class KnownRequestErrorStub extends Error { constructor(public code: string) { super(`known request ${code}`); } }

const FILED = {
  id: 'wp-filed-1',
  periodStart: new Date('2025-10-02T00:00:00Z'),
  periodEnd: new Date('2026-10-01T00:00:00Z'),
  filedAt: new Date('2026-10-20T00:00:00Z'),
  filingConfirmation: 'NETFILE-123',
};
const INSIDE = new Date('2026-03-15T00:00:00Z');
const OUTSIDE = new Date('2026-11-15T00:00:00Z');

const mockDb: Record<string, any> = {
  taxReturnWorkpaper: { findMany: jest.fn() },
  companyTaxConfiguration: { findUnique: jest.fn() },
  transaction: { update: jest.fn(), findFirst: jest.fn() },
  journalEntry: { findMany: jest.fn(), count: jest.fn() },
};
jest.mock('@/lib/db', () => ({ db: mockDb }));
jest.mock('@prisma/client', () => ({
  Prisma: { Decimal: DecimalStub, PrismaClientKnownRequestError: KnownRequestErrorStub },
}));

const mockPostJournalEntry = jest.fn();
const mockPostTransactionToLedger = jest.fn();
jest.mock('@/lib/journal', () => ({
  postJournalEntry: (...a: unknown[]) => mockPostJournalEntry(...a),
  postTransactionToLedger: (...a: unknown[]) => mockPostTransactionToLedger(...a),
}));
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: jest.fn(async () => ({ companyId: 'co-1', userId: 'u-1', error: null })),
  closedPeriodGuard: jest.fn(async () => null),
  auditLog: jest.fn(async () => undefined),
}));
jest.mock('@/lib/webhooks', () => ({ emitWebhookEvent: jest.fn(async () => undefined) }));
jest.mock('@/lib/intercompany/detect', () => ({ suggestMirror: jest.fn(async () => null) }));
jest.mock('@/lib/tax/accounts', () => ({
  ensureSimpleTaxAccounts: jest.fn(async () => ({ output: '2300', recoverable: '2310', pstPayable: '2330', qstOutput: '2300', qstRecoverable: '2310' })),
  loadSimpleTaxAccounts: jest.fn(async () => ({ output: '2300', recoverable: '2310', pstPayable: '2330', qstOutput: '2300', qstRecoverable: '2310' })),
}));
jest.mock('@/lib/fx/rate', () => ({ resolveRate: jest.fn(async () => ({ rate: 1 })) }));
jest.mock('@/lib/tax/bank-adapter', () => ({ assertReviewedBankTaxAdapter: jest.fn(() => undefined) }));

import { NextRequest } from 'next/server';
import { assertNoFiledLock, findFiledGstPeriods, FiledPeriodLockedError } from '@/lib/tax/filed-lock';
import { POST as journalPOST } from '@/app/api/journal/route';
import { postBankRow } from '@/lib/banking/posting';

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.taxReturnWorkpaper.findMany.mockResolvedValue([FILED]);
  // null configuration → the pure default codes (2300/2310/2330; QST → 2300/2310).
  mockDb.companyTaxConfiguration.findUnique.mockResolvedValue(null);
  mockDb.transaction.update.mockResolvedValue({});
  mockPostJournalEntry.mockResolvedValue({ id: 'je-new' });
  mockPostTransactionToLedger.mockResolvedValue({ id: 'je-new' });
});

describe('findFiledGstPeriods', () => {
  test('queries filed_recorded gst_hst workpapers for the company', async () => {
    const periods = await findFiledGstPeriods('co-1');
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ periodStart: FILED.periodStart, periodEnd: FILED.periodEnd, filingConfirmation: 'NETFILE-123' });
    expect(mockDb.taxReturnWorkpaper.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: 'co-1', regime: 'gst_hst', status: 'filed_recorded' },
    }));
  });
});

describe('assertNoFiledLock — guard unit tests', () => {
  test('tax account line (2300 output) inside the filed period is blocked, naming period + filing date', async () => {
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '2300' }, { accountCode: '4000' }] }))
      .rejects.toMatchObject({ code: 'filed_period_locked', status: 409 });
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '2300' }] }))
      .rejects.toThrow(/2025-10-02 to 2026-10-01.*filed on 2026-10-20.*NETFILE-123/);
  });

  test('recoverable (2310) and PST payable (2330) lines inside are blocked; boundary days count as inside', async () => {
    await expect(assertNoFiledLock({ companyId: 'co-1', date: new Date('2025-10-02T00:00:00Z'), lines: [{ glAccountCode: '2310' }] })).rejects.toBeInstanceOf(FiledPeriodLockedError);
    await expect(assertNoFiledLock({ companyId: 'co-1', date: new Date('2026-10-01T00:00:00Z'), lines: [{ accountCode: '2330' }] })).rejects.toBeInstanceOf(FiledPeriodLockedError);
  });

  test('ordinary (non-tax) lines inside the filed period are allowed', async () => {
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '6000' }, { accountCode: '1010' }] })).resolves.toBeNull();
  });

  test('tax account line OUTSIDE the filed period is allowed', async () => {
    await expect(assertNoFiledLock({ companyId: 'co-1', date: OUTSIDE, lines: [{ accountCode: '2300' }] })).resolves.toBeNull();
    await expect(assertNoFiledLock({ companyId: 'co-1', date: new Date('2025-09-30T00:00:00Z'), lines: [{ accountCode: '2310' }] })).resolves.toBeNull();
  });

  test('a line carrying a tax spec on a NON-tax account inside the period is blocked (posting would expand onto tax accounts)', async () => {
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '6000', hasTaxSpec: true }] })).rejects.toMatchObject({ code: 'filed_period_locked' });
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '4000', tax: { province: 'AB' } }] })).rejects.toMatchObject({ code: 'filed_period_locked' });
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '6000', taxProvince: 'BC' }] })).rejects.toMatchObject({ code: 'filed_period_locked' });
  });

  test('QST accounts block: config-mapped QST output/recoverable codes are resolved tax accounts', async () => {
    mockDb.companyTaxConfiguration.findUnique.mockResolvedValue({
      gstHstOutputAccount: { code: '2300' }, gstHstRecoverableAccount: { code: '2310' }, pstRstPayableAccount: { code: '2330' },
      qstOutputAccount: { code: '2340' }, qstRecoverableAccount: { code: '1240' },
    });
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '2340' }] })).rejects.toMatchObject({ code: 'filed_period_locked' });
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '1240' }] })).rejects.toMatchObject({ code: 'filed_period_locked' });
  });

  test('config-mapped custom codes win over the defaults', async () => {
    mockDb.companyTaxConfiguration.findUnique.mockResolvedValue({
      gstHstOutputAccount: { code: '2410' }, gstHstRecoverableAccount: { code: '1210' }, pstRstPayableAccount: { code: '2430' },
      qstOutputAccount: { code: '2440' }, qstRecoverableAccount: { code: '1240' },
    });
    // The custom output code blocks…
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '2410' }] })).rejects.toMatchObject({ code: 'filed_period_locked' });
    // …and the default 2300 is no longer a resolved tax account for this company.
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '2300' }] })).resolves.toBeNull();
  });

  test('no filed periods → tax lines allowed everywhere', async () => {
    mockDb.taxReturnWorkpaper.findMany.mockResolvedValue([]);
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '2300' }] })).resolves.toBeNull();
  });

  test('caller-supplied resolvedTaxCodes are honoured without a config lookup', async () => {
    await expect(assertNoFiledLock({ companyId: 'co-1', date: INSIDE, lines: [{ accountCode: '9999' }], resolvedTaxCodes: new Set(['9999']) }))
      .rejects.toMatchObject({ code: 'filed_period_locked' });
    expect(mockDb.companyTaxConfiguration.findUnique).not.toHaveBeenCalled();
  });
});

describe('journal POST route — filed lock', () => {
  const req = (body: unknown) => new NextRequest('http://localhost/api/journal', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });

  test('creating a tax-affecting entry in the filed period returns 409 with the lock message', async () => {
    const res = await journalPOST(req({
      entryDate: '2026-03-15', description: 'GST adjustment',
      lines: [
        { glAccountCode: '2300', debit: 0, credit: 50 },
        { glAccountCode: '4000', debit: 50, credit: 0 },
      ],
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('filed_period_locked');
    expect(body.error).toMatch(/Period locked.*2025-10-02 to 2026-10-01.*2026-10-20.*NETFILE-123/);
    expect(mockPostJournalEntry).not.toHaveBeenCalled();
  });

  test('creating an entry with a tax SPEC in the filed period returns 409 (expansion would hit tax accounts)', async () => {
    const res = await journalPOST(req({
      entryDate: '2026-03-15', description: 'Supplies with GST',
      lines: [
        { glAccountCode: '6000', debit: 105, credit: 0, tax: { province: 'AB' } },
        { glAccountCode: '1010', debit: 0, credit: 105 },
      ],
    }));
    expect(res.status).toBe(409);
    expect(mockPostJournalEntry).not.toHaveBeenCalled();
  });

  test('a non-tax entry in the SAME filed period succeeds', async () => {
    const res = await journalPOST(req({
      entryDate: '2026-03-15', description: 'Rent accrual',
      lines: [
        { glAccountCode: '6100', debit: 1000, credit: 0 },
        { glAccountCode: '2100', debit: 0, credit: 1000 },
      ],
    }));
    expect(res.status).toBe(201);
    expect(mockPostJournalEntry).toHaveBeenCalledTimes(1);
  });

  test('a tax entry OUTSIDE the filed period succeeds', async () => {
    const res = await journalPOST(req({
      entryDate: '2026-11-15', description: 'GST on November sale',
      lines: [
        { glAccountCode: '2300', debit: 0, credit: 50 },
        { glAccountCode: '4000', debit: 50, credit: 0 },
      ],
    }));
    expect(res.status).toBe(201);
  });
});

describe('postBankRow — filed lock at the bank posting service', () => {
  const baseRow = {
    id: 'tx-1', companyId: 'co-1', financialAccountId: 'fa-1',
    date: INSIDE, description: 'Office supplies', amount: -105, currency: 'CAD',
    fxRate: null, amountHome: null, categoryId: null,
    account: { glAccountCode: '1010', currency: 'CAD' }, category: null,
  };

  test('a split carrying a tax spec (as a categorization rule stamps it) into the filed period is blocked', async () => {
    const row: any = { ...baseRow, splits: [{ categoryCode: '6000', amount: 105, taxCode: 'Tax — AB', taxRate: null, taxInclusive: true, taxProvince: 'AB', taxRecoverable: true }] };
    await expect(postBankRow({ row, companyId: 'co-1', homeCurrency: 'CAD' })).rejects.toMatchObject({ code: 'filed_period_locked', status: 409 });
    expect(mockPostJournalEntry).not.toHaveBeenCalled();
  });

  test('a split whose category IS a tax account into the filed period is blocked', async () => {
    const row: any = { ...baseRow, amount: -50, splits: [{ categoryCode: '2300', amount: 50, taxCode: null, taxRate: null, taxInclusive: true }] };
    await expect(postBankRow({ row, companyId: 'co-1', homeCurrency: 'CAD' })).rejects.toMatchObject({ code: 'filed_period_locked' });
    expect(mockPostJournalEntry).not.toHaveBeenCalled();
  });

  test('a plain (no-tax) split posting into the filed period is allowed', async () => {
    const row: any = { ...baseRow, amount: -100, splits: [{ categoryCode: '6000', amount: 100, taxCode: null, taxRate: null, taxInclusive: true }] };
    await expect(postBankRow({ row, companyId: 'co-1', homeCurrency: 'CAD' })).resolves.toBe('je-new');
    expect(mockPostJournalEntry).toHaveBeenCalledTimes(1);
  });

  test('single-category posting to a tax account in the filed period is blocked; a plain category is allowed', async () => {
    const taxRow: any = { ...baseRow, amount: 50, splits: null, category: { code: '2300', name: 'Sales Tax Payable' } };
    await expect(postBankRow({ row: taxRow, companyId: 'co-1', homeCurrency: 'CAD' })).rejects.toMatchObject({ code: 'filed_period_locked' });
    expect(mockPostTransactionToLedger).not.toHaveBeenCalled();

    const plainRow: any = { ...baseRow, amount: 100, splits: null, category: { code: '4000', name: 'Revenue' } };
    await expect(postBankRow({ row: plainRow, companyId: 'co-1', homeCurrency: 'CAD' })).resolves.toBe('je-new');
    expect(mockPostTransactionToLedger).toHaveBeenCalledTimes(1);
  });

  test('a tax split posting OUTSIDE the filed period is allowed', async () => {
    const row: any = { ...baseRow, date: OUTSIDE, splits: [{ categoryCode: '6000', amount: 105, taxCode: 'Tax — AB', taxRate: null, taxInclusive: true, taxProvince: 'AB', taxRecoverable: true }] };
    await expect(postBankRow({ row, companyId: 'co-1', homeCurrency: 'CAD' })).resolves.toBe('je-new');
  });
});
