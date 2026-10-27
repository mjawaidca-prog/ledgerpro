/**
 * Phase 1.5 — service-level tests with a mocked database.
 * Covers: workpaper source loading (bridge activation), the Muja draft →
 * prepare → review flow, prepare-blocker enforcement, and Tax Setup service
 * validation / role checks / review stamping. Prisma is stubbed the same way
 * as in tax-posting-service.test.ts because the sandbox cannot generate the
 * Prisma client (engine download is blocked).
 */
class DecimalStub {
  v: number;
  constructor(value: unknown) { this.v = value instanceof DecimalStub ? value.v : Number(value as never); }
  mul(n: number) { return new DecimalStub(this.v * n); }
  isInteger() { return Math.abs(this.v - Math.round(this.v)) < 1e-9; }
  abs() { return new DecimalStub(Math.abs(this.v)); }
  greaterThan(n: number) { return this.v > n; }
  toNumber() { return this.v; }
}
class KnownRequestErrorStub extends Error { constructor(public code: string) { super(`known request ${code}`); } }

const mockDb: Record<string, any> = {
  company: { findUnique: jest.fn() },
  membership: { findUnique: jest.fn() },
  companyTaxConfiguration: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  companyTaxRegistration: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  chartOfAccount: { findMany: jest.fn(), findUnique: jest.fn() },
  documentLineTaxSnapshot: { findMany: jest.fn() },
  journalEntry: { findMany: jest.fn() },
  journalLine: { findMany: jest.fn() },
  taxCodeVersion: { count: jest.fn() },
  taxReturnWorkpaper: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb)),
};
jest.mock('@/lib/db', () => ({ db: mockDb }));
jest.mock('@prisma/client', () => ({
  Prisma: { Decimal: DecimalStub, PrismaClientKnownRequestError: KnownRequestErrorStub },
  TaxRegime: {}, UserRole: {},
}));
jest.mock('@/lib/tax/posting-service', () => ({
  TaxPostingError: class extends Error {
    constructor(public code: string, message: string, public status = 400) { super(message); this.name = 'TaxPostingError'; }
  },
}));

import { loadWorkpaperSource, calculateCurrent, createWorkpaper, transitionWorkpaper } from '@/lib/tax/workpaper-service';
import { loadTaxSetup, saveTaxConfiguration, createTaxRegistration, updateTaxRegistration } from '@/lib/tax/setup-service';
import { TaxPostingError } from '@/lib/tax/posting-service';

const START = new Date('2025-10-02T00:00:00Z');
const END = new Date('2026-10-01T00:00:00Z');
const INPUTS = { classifications: [], periodEvidence: 'TD statements and GST reclass journal reviewed.', reviewNote: '' };

function mockMujaLoader(enabled = true) {
  mockDb.company.findUnique.mockResolvedValue({ id: 'muja', name: '2751623 Alberta Corporation', currency: 'CAD' });
  mockDb.companyTaxRegistration.findFirst.mockResolvedValue({
    id: 'reg-muja', regime: 'gst_hst', registrationNumber: '731893160 RT0001', province: 'AB',
    method: 'regular', filingFrequency: 'annual', active: true,
    validFrom: new Date('2025-10-02T00:00:00Z'), validTo: new Date('2026-10-01T00:00:00Z'),
    reviewedAt: new Date('2026-10-26T00:00:00Z'),
  });
  mockDb.companyTaxConfiguration.findUnique.mockResolvedValue({
    enabled,
    gstHstOutputAccount: { code: '2300' }, gstHstRecoverableAccount: { code: '2310' },
    qstOutputAccount: null, qstRecoverableAccount: null, pstRstPayableAccount: null, taxClearingAccount: null,
  });
  mockDb.chartOfAccount.findMany.mockResolvedValue([{ code: '4000' }]);
  mockDb.documentLineTaxSnapshot.findMany.mockResolvedValue([]);
  mockDb.journalEntry.findMany.mockResolvedValue([
    { id: 'j1', entryDate: new Date('2025-12-01T00:00:00Z'), description: 'Contract revenue', taxPosting: null,
      lines: [{ id: 'l1', glAccountCode: '4000', debit: '0', credit: '100000.00', description: null }] },
    { id: 'j2', entryDate: new Date('2026-06-30T00:00:00Z'), description: 'Contract revenue', taxPosting: null,
      lines: [{ id: 'l2', glAccountCode: '4000', debit: '0', credit: '80174.75', description: null }] },
    { id: 'j3', entryDate: new Date('2026-10-01T00:00:00Z'), description: 'GST split reclass', taxPosting: null,
      lines: [
        { id: 'l3', glAccountCode: '4000', debit: '8579.75', credit: '0', description: null },
        { id: 'l4', glAccountCode: '2300', debit: '0', credit: '8579.75', description: null },
      ] },
  ]);
  mockDb.journalLine.findMany.mockResolvedValue([]);
}

beforeEach(() => { jest.clearAllMocks(); mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb)); });

describe('workpaper loader bridge activation', () => {
  test('zero snapshots + zero reviewed postings selects gl_simple_path and reconciles Muja', async () => {
    mockMujaLoader();
    const source = await loadWorkpaperSource('muja', 'reg-muja', START, END);
    expect(source.sourceMode).toBe('gl_simple_path');
    expect(source.blockers).toEqual([]);
    const { calculated } = await calculateCurrent('muja', 'reg-muja', START, END, INPUTS);
    expect(calculated.lines).toMatchObject({ '101': 17159500, '103': 857975, '106': 0, '109': 857975 });
    expect(calculated.reconciled).toBe(true);
  });

  test('any reviewed posting in the period keeps the reviewed path', async () => {
    mockMujaLoader();
    const entries = await mockDb.journalEntry.findMany();
    entries[0].taxPosting = { id: 'tp-1' };
    mockDb.journalEntry.findMany.mockResolvedValue(entries);
    const source = await loadWorkpaperSource('muja', 'reg-muja', START, END);
    expect(source.sourceMode).toBe('reviewed_snapshots');
  });
});

describe('Muja workpaper lifecycle on the bridge', () => {
  test('draft → prepare → review succeeds with reviewed postings disabled; record_filing is not exercised', async () => {
    mockMujaLoader(false);
    mockDb.membership.findUnique.mockResolvedValue({ role: 'owner' });
    mockDb.taxReturnWorkpaper.findFirst.mockResolvedValue(null);
    mockDb.taxReturnWorkpaper.create.mockImplementation(async ({ data }: any) => ({ id: 'wp-1', status: 'draft', ...data }));
    const created = await createWorkpaper('muja', 'owner-1', 'reg-muja', START, END, INPUTS);
    expect(created.id).toBe('wp-1');
    const createData = mockDb.taxReturnWorkpaper.create.mock.calls[0][0].data;
    expect(createData.snapshot.sourceMode).toBe('gl_simple_path');
    expect(createData.snapshot.lines['109']).toBe(857975);

    const { sourceHash } = await calculateCurrent('muja', 'reg-muja', START, END, INPUTS);
    const saved = {
      id: 'wp-1', companyId: 'muja', registrationId: 'reg-muja', periodStart: START, periodEnd: END,
      inputs: INPUTS, status: 'draft', sourceHash,
    };
    mockDb.taxReturnWorkpaper.findFirst.mockResolvedValue(saved);
    mockDb.taxReturnWorkpaper.update.mockImplementation(async ({ data }: any) => ({ ...saved, ...data }));
    const prepared = await transitionWorkpaper('muja', 'owner-1', 'wp-1', 'prepare');
    expect(prepared.status).toBe('prepared');
    mockDb.taxReturnWorkpaper.findFirst.mockResolvedValue({ ...saved, status: 'prepared' });
    const reviewed = await transitionWorkpaper('muja', 'owner-1', 'wp-1', 'review');
    expect(reviewed.status).toBe('reviewed');
    expect(mockDb.auditLog.create).toHaveBeenCalled();
  });

  test('prepare is blocked for a reviewed-source period while reviewed postings are disabled', async () => {
    mockMujaLoader(false);
    const entries = await mockDb.journalEntry.findMany();
    entries[0].taxPosting = { id: 'tp-1' };
    mockDb.journalEntry.findMany.mockResolvedValue(entries);
    const source = await loadWorkpaperSource('muja', 'reg-muja', START, END);
    expect(source.sourceMode).toBe('reviewed_snapshots');
    expect(source.blockers).toContain('The reviewed tax workflow is not enabled for this company.');
    mockDb.membership.findUnique.mockResolvedValue({ role: 'owner' });
    const saved = {
      id: 'wp-2', companyId: 'muja', registrationId: 'reg-muja', periodStart: START, periodEnd: END,
      inputs: INPUTS, status: 'draft', sourceHash: 'x',
    };
    mockDb.taxReturnWorkpaper.findFirst.mockResolvedValue(saved);
    await expect(transitionWorkpaper('muja', 'owner-1', 'wp-2', 'prepare')).rejects.toMatchObject({ code: 'workpaper_not_reconciled' });
  });
});

describe('tax setup service', () => {
  const account = (id: string, code: string, type: string, active = true) => ({ id, code, name: `Account ${code}`, type, active, companyId: 'muja' });

  test('saveTaxConfiguration rejects a bookkeeper', async () => {
    mockDb.membership.findUnique.mockResolvedValue({ role: 'bookkeeper' });
    await expect(saveTaxConfiguration({ companyId: 'muja', userId: 'u1', role: null, data: { enabled: true } }))
      .rejects.toBeInstanceOf(TaxPostingError);
  });

  test('saveTaxConfiguration rejects cross-type and missing mapping accounts', async () => {
    mockDb.membership.findUnique.mockResolvedValue({ role: 'owner' });
    mockDb.chartOfAccount.findUnique.mockResolvedValue(null);
    await expect(saveTaxConfiguration({ companyId: 'muja', userId: 'u1', role: null, data: { enabled: true, gstHstOutputAccountId: 'nope' } }))
      .rejects.toMatchObject({ code: 'invalid_tax_account' });
    // Recoverable must be an asset; a liability account is refused.
    mockDb.chartOfAccount.findUnique.mockResolvedValue(account('a1', '2310', 'liability'));
    await expect(saveTaxConfiguration({ companyId: 'muja', userId: 'u1', role: null, data: { enabled: true, gstHstRecoverableAccountId: 'a1' } }))
      .rejects.toMatchObject({ code: 'invalid_tax_account' });
  });

  test('saveTaxConfiguration creates with a review stamp and an audit row', async () => {
    mockDb.membership.findUnique.mockResolvedValue({ role: 'admin' });
    mockDb.chartOfAccount.findUnique.mockImplementation(async ({ where }: any) =>
      where.companyId_id.id === 'a-2300' ? account('a-2300', '2300', 'liability')
        : where.companyId_id.id === 'a-round' ? account('a-round', '5999', 'expense')
        : account('a-2310', '2310', 'asset'));
    mockDb.companyTaxConfiguration.findUnique.mockResolvedValue(null);
    mockDb.companyTaxConfiguration.create.mockImplementation(async ({ data }: any) => ({ id: 'cfg-1', ...data }));
    await saveTaxConfiguration({
      companyId: 'muja', userId: 'u1', role: null,
      data: { enabled: true, gstHstOutputAccountId: 'a-2300', gstHstRecoverableAccountId: 'a-2310', taxRoundingAccountId: 'a-round', reviewed: true },
    });
    const data = mockDb.companyTaxConfiguration.create.mock.calls[0][0].data;
    expect(data.configuredById).toBe('u1');
    expect(data.configuredAt).toBeInstanceOf(Date);
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'tax.setup.configuration.create' }),
    }));
  });

  test('enabling enforces the DB invariant: rounding mapped, evidence on, review stamp', async () => {
    mockDb.membership.findUnique.mockResolvedValue({ role: 'owner' });
    mockDb.chartOfAccount.findUnique.mockImplementation(async ({ where }: any) =>
      where.companyId_id.id === 'a-round' ? account('a-round', '5999', 'expense') : account('a-2300', '2300', 'liability'));
    mockDb.companyTaxConfiguration.findUnique.mockResolvedValue(null);
    // No rounding mapping.
    await expect(saveTaxConfiguration({ companyId: 'muja', userId: 'u1', role: null, data: { enabled: true, reviewed: true } }))
      .rejects.toMatchObject({ code: 'tax_configuration_not_ready' });
    // Rounding mapped but no review attestation and no prior stamp.
    await expect(saveTaxConfiguration({ companyId: 'muja', userId: 'u1', role: null, data: { enabled: true, taxRoundingAccountId: 'a-round' } }))
      .rejects.toMatchObject({ code: 'tax_configuration_not_ready' });
    // Evidence switched off.
    await expect(saveTaxConfiguration({
      companyId: 'muja', userId: 'u1', role: null,
      data: { enabled: true, taxRoundingAccountId: 'a-round', reviewed: true, requireJurisdictionEvidence: false },
    })).rejects.toMatchObject({ code: 'tax_configuration_not_ready' });
    // A prior review stamp is preserved when re-saving an enabled config.
    mockDb.companyTaxConfiguration.findUnique.mockResolvedValue({ id: 'cfg-1', configuredById: 'u0', configuredAt: new Date('2026-01-01T00:00:00Z') });
    mockDb.companyTaxConfiguration.update.mockImplementation(async ({ data }: any) => ({ id: 'cfg-1', ...data }));
    await saveTaxConfiguration({ companyId: 'muja', userId: 'u1', role: null, data: { enabled: true, taxRoundingAccountId: 'a-round' } });
    const updateData = mockDb.companyTaxConfiguration.update.mock.calls[0][0].data;
    expect(updateData.configuredById).toBe('u0');
  });

  test('createTaxRegistration maps a duplicate to a 409', async () => {
    mockDb.membership.findUnique.mockResolvedValue({ role: 'owner' });
    mockDb.companyTaxRegistration.create.mockRejectedValue(new KnownRequestErrorStub('P2002'));
    await expect(createTaxRegistration({
      companyId: 'muja', userId: 'u1', role: null,
      data: { regime: 'gst_hst', registrationNumber: '731893160 RT0001', province: 'AB', filingFrequency: 'annual', validFrom: '2025-10-02' },
    })).rejects.toMatchObject({ code: 'duplicate_registration', status: 409 });
  });

  test('updateTaxRegistration stamps review, and a substantive edit clears it', async () => {
    mockDb.membership.findUnique.mockResolvedValue({ role: 'owner' });
    const existing = {
      id: 'reg-1', companyId: 'muja', regime: 'gst_hst', registrationNumber: 'A', province: 'AB', method: 'regular',
      filingFrequency: 'annual', validFrom: new Date('2025-10-02T00:00:00Z'), validTo: null, active: true,
      reviewedById: null, reviewedAt: null, createdAt: new Date(), updatedAt: new Date(),
    };
    mockDb.companyTaxRegistration.findFirst.mockResolvedValue(existing);
    mockDb.companyTaxRegistration.update.mockImplementation(async ({ data }: any) => ({ ...existing, ...data, reviewedAt: data.reviewedAt ?? existing.reviewedAt }));
    const reviewed = await updateTaxRegistration({ companyId: 'muja', userId: 'u9', role: null, registrationId: 'reg-1', data: { reviewed: true } });
    expect(reviewed.reviewed).toBe(true);
    expect(mockDb.companyTaxRegistration.update.mock.calls[0][0].data.reviewedById).toBe('u9');

    jest.clearAllMocks();
    mockDb.membership.findUnique.mockResolvedValue({ role: 'owner' });
    mockDb.companyTaxRegistration.findFirst.mockResolvedValue({ ...existing, reviewedById: 'u9', reviewedAt: new Date() });
    mockDb.companyTaxRegistration.update.mockImplementation(async ({ data }: any) => ({ ...existing, ...data }));
    mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb));
    await updateTaxRegistration({ companyId: 'muja', userId: 'u9', role: null, registrationId: 'reg-1', data: { registrationNumber: 'B' } });
    expect(mockDb.companyTaxRegistration.update.mock.calls[0][0].data.reviewedById).toBeNull();
  });

  test('loadTaxSetup separates workpaper readiness from reviewed-posting readiness', async () => {
    const cfg = {
      id: 'cfg-1', enabled: true, defaultPriceMode: 'exclusive', requireJurisdictionEvidence: true,
      configuredById: 'u1', configuredAt: new Date(),
      gstHstOutputAccount: account('a-2300', '2300', 'liability'), gstHstRecoverableAccount: account('a-2310', '2310', 'asset'),
      qstOutputAccount: null, qstRecoverableAccount: null, pstRstPayableAccount: null,
      taxRoundingAccount: null, taxClearingAccount: null,
    };
    mockDb.company.findUnique.mockResolvedValue({
      id: 'muja', name: '2751623 Alberta Corporation', province: 'AB', businessNumber: '731893160',
      gstNumber: '731893160 RT0001', fiscalYearStart: new Date('2025-10-02T00:00:00Z'), currency: 'CAD',
    });
    mockDb.chartOfAccount.findMany.mockResolvedValue([account('a-2300', '2300', 'liability'), account('a-2310', '2310', 'asset')]);
    mockDb.companyTaxConfiguration.findUnique.mockResolvedValue(cfg);
    mockDb.companyTaxRegistration.findMany.mockResolvedValue([{
      id: 'reg-1', regime: 'gst_hst', registrationNumber: '731893160 RT0001', province: 'AB', method: 'regular',
      filingFrequency: 'annual', validFrom: new Date('2025-10-02T00:00:00Z'), validTo: new Date('2026-10-01T00:00:00Z'),
      active: true, reviewedById: 'u1', reviewedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    }]);
    mockDb.taxCodeVersion.count.mockResolvedValue(0); // no approved tax codes yet
    const view = await loadTaxSetup('muja', 'u1');
    expect(view.workpaperReadiness.ready).toBe(true);
    expect(view.reviewedPostingReadiness.ready).toBe(false);
    expect(view.configuration?.mappings.gstHstOutput?.code).toBe('2300');
    expect(view.configuration?.mappings.gstHstRecoverable?.code).toBe('2310');
  });
});
