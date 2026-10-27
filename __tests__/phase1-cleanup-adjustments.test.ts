/**
 * Phase 1 cleanup — simple-path GST/HST adjustments (lines 104/107/110/111).
 *
 * Storage: `inputs.simpleAdjustments` on the period's TaxReturnWorkpaper
 * (no schema change). Adjustments are period-level dollar rows with notes,
 * distinct from reviewed-workpaper GL classifications — in GL mode they do
 * NOT trip the manual-classification blocker.
 *
 * Muja regression fixture: GL lines revenue Cr $171,595.00 net +
 * Cr 2300 $8,579.75, no ITCs.
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
  companyTaxConfiguration: { findUnique: jest.fn() },
  companyTaxRegistration: { findFirst: jest.fn(), create: jest.fn() },
  chartOfAccount: { findMany: jest.fn() },
  documentLineTaxSnapshot: { findMany: jest.fn() },
  journalEntry: { findMany: jest.fn() },
  journalLine: { findMany: jest.fn() },
  taxReturnWorkpaper: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
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

import { computeGstHstReturn, gstReturnCsv, normalizeGstAdjustments, validateGstAdjustments, type GstJournalLine } from '@/lib/tax/gst-return';
import { calculateWorkpaper, type WorkpaperSource } from '@/lib/tax/workpaper';
import { calculateCurrent } from '@/lib/tax/workpaper-service';
import { computeGstReturn, saveGstAdjustments } from '@/lib/tax/gst-return-service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
let seq = 0;
const jl = (accountCode: string, accountType: string, debit: number, credit: number, description = ''): GstJournalLine => ({
  id: `l${++seq}`, entryId: `e${seq}`, date: '2026-03-15', accountCode, accountType, description, debit, credit,
});
/** Muja shape: revenue Cr $171,595.00 net + Cr 2300 $8,579.75, no ITCs. */
const mujaLines = (): GstJournalLine[] => [
  jl('4000', 'income', 0, 171595.0, 'Contract revenue (net)'),
  jl('2300', 'liability', 0, 8579.75, 'GST collected'),
];
const ADJ = {
  add: [{ amount: 100.0, note: 'Bad-debt recovery' }],
  deduct: [{ amount: 50.0, note: 'Credit note adjustment' }],
  instalments: [{ amount: 1000.0, note: 'Instalment paid' }],
  rebates: [{ amount: 25.0, note: 'Rebate offset' }],
};

// ---------------------------------------------------------------------------
// Pure computation — computeGstHstReturn with adjustments
// ---------------------------------------------------------------------------
describe('computeGstHstReturn — adjustments (Phase 1 cleanup)', () => {
  test('Muja regression WITHOUT adjustments reproduces today exactly', () => {
    const r = computeGstHstReturn({ lines: mujaLines(), outputAccountCode: '2300', recoverableAccountCode: '2310' });
    expect(r.lines).toEqual({
      '101': 171595.0, '103': 8579.75, '104': 0, '105': 8579.75, '106': 0, '107': 0,
      '108': 0, '109': 8579.75, '110': 0, '111': 0, '112': 0, '114': 0, '115': 8579.75,
    });
    expect(r.adjustments).toEqual({
      add: [], deduct: [], instalments: [], rebates: [],
      totals: { '104': 0, '107': 0, '110': 0, '111': 0 },
    });
  });

  test('absent, empty-object and empty-list adjustments are identical', () => {
    const lines = mujaLines();
    const base = computeGstHstReturn({ lines, outputAccountCode: '2300', recoverableAccountCode: '2310' });
    const emptyObj = computeGstHstReturn({ lines, outputAccountCode: '2300', recoverableAccountCode: '2310', adjustments: {} });
    const emptyLists = computeGstHstReturn({
      lines, outputAccountCode: '2300', recoverableAccountCode: '2310',
      adjustments: { add: [], deduct: [], instalments: [], rebates: [] },
    });
    expect(emptyObj.lines).toEqual(base.lines);
    expect(emptyLists.lines).toEqual(base.lines);
    expect(emptyLists.drillDown).toEqual(base.drillDown);
  });

  test('Muja WITH adjustments: 104/107/110/111 flow into 105/108/109/112/115', () => {
    const r = computeGstHstReturn({ lines: mujaLines(), outputAccountCode: '2300', recoverableAccountCode: '2310', adjustments: ADJ });
    expect(r.lines).toEqual({
      '101': 171595.0, '103': 8579.75, '104': 100.0, '105': 8679.75, '106': 0, '107': 50.0,
      '108': 50.0, '109': 8629.75, '110': 1000.0, '111': 25.0, '112': 1025.0, '114': 0, '115': 7604.75,
    });
    expect(r.adjustments.totals).toEqual({ '104': 100, '107': 50, '110': 1000, '111': 25 });
    expect(r.adjustments.add).toEqual([{ amount: 100, note: 'Bad-debt recovery' }]);
  });

  test('multiple rows per group sum exactly (cent-exact)', () => {
    const r = computeGstHstReturn({
      lines: mujaLines(), outputAccountCode: '2300', recoverableAccountCode: '2310',
      adjustments: { add: [{ amount: 10.1, note: 'a' }, { amount: 0.02, note: 'b' }, { amount: 5, note: 'c' }] },
    });
    expect(r.lines['104']).toBe(15.12);
    expect(r.lines['105']).toBe(8594.87);
  });

  test('refund case: instalments exceeding net tax make 113C negative → 114 refund', () => {
    const lines = [jl('4000', 'income', 0, 1000, 'Revenue'), jl('2300', 'liability', 0, 50, 'GST collected')];
    const r = computeGstHstReturn({
      lines, outputAccountCode: '2300', recoverableAccountCode: '2310',
      adjustments: { instalments: [{ amount: 200, note: 'Instalments paid' }], rebates: [{ amount: 10, note: 'Rebate' }] },
    });
    expect(r.lines['109']).toBe(50);
    expect(r.lines['112']).toBe(210);
    expect(r.lines['114']).toBe(160);
    expect(r.lines['115']).toBe(0);
  });

  test('refund case via deduct adjustments exceeding collections', () => {
    const lines = [jl('4000', 'income', 0, 1000, 'Revenue'), jl('2300', 'liability', 0, 50, 'GST collected')];
    const r = computeGstHstReturn({
      lines, outputAccountCode: '2300', recoverableAccountCode: '2310',
      adjustments: { deduct: [{ amount: 80, note: 'Bad debt written off' }] },
    });
    expect(r.lines['109']).toBe(-30);
    expect(r.lines['114']).toBe(30);
    expect(r.lines['115']).toBe(0);
  });

  test('CSV carries an adjustments section with line, note and amount', () => {
    const r = computeGstHstReturn({ lines: mujaLines(), outputAccountCode: '2300', recoverableAccountCode: '2310', adjustments: ADJ });
    const csv = gstReturnCsv({ companyName: '2751623 Alberta Corporation', periodStart: '2025-10-02', periodEnd: '2026-10-01', filedLabel: 'NOT FILED — working copy', result: r });
    expect(csv).toContain('Adjustments');
    expect(csv).toContain('Bad-debt recovery');
    expect(csv).toContain('100.00');
    expect(csv).toContain('Instalment paid');
    expect(csv).toContain('7604.75');
    // Without adjustments there is no adjustments section (today's CSV shape).
    const plain = computeGstHstReturn({ lines: mujaLines(), outputAccountCode: '2300', recoverableAccountCode: '2310' });
    const plainCsv = gstReturnCsv({ companyName: 'X', periodStart: '2025-10-02', periodEnd: '2026-10-01', filedLabel: 'NOT FILED — working copy', result: plain });
    expect(plainCsv).not.toContain('Bad-debt recovery');
  });

  test('validation rejects negative amounts and missing notes', () => {
    expect(validateGstAdjustments(ADJ)).toBeNull();
    expect(validateGstAdjustments({ add: [{ amount: -1, note: 'x' }] })).toContain('$0 or more');
    expect(validateGstAdjustments({ add: [{ amount: 1, note: '  ' }] })).toContain('short note');
    expect(normalizeGstAdjustments(undefined).totals).toEqual({ '104': 0, '107': 0, '110': 0, '111': 0 });
  });
});

// ---------------------------------------------------------------------------
// GL workpaper bridge — calculateWorkpaper (pure)
// ---------------------------------------------------------------------------
const mujaBridgeSource = (overrides: Partial<WorkpaperSource> = {}): WorkpaperSource => ({
  company: { id: 'muja', name: '2751623 Alberta Corporation', currency: 'CAD' },
  registration: {
    id: 'reg-muja', regime: 'gst_hst', registrationNumber: '731893160 RT0001',
    province: 'AB', method: 'regular', filingFrequency: 'annual',
  },
  start: '2025-10-02', end: '2026-10-01',
  sources: [],
  ledger: [
    { id: 'l1', journalId: 'j1', date: '2025-12-01', code: '4000', role: 'income', debitMinor: 0, creditMinor: 10000000, postingId: null, description: 'Contract revenue (gross)' },
    { id: 'l2', journalId: 'j2', date: '2026-06-30', code: '4000', role: 'income', debitMinor: 0, creditMinor: 8017475, postingId: null, description: 'Contract revenue (gross)' },
    { id: 'l3', journalId: 'j3', date: '2026-10-01', code: '4000', role: 'income', debitMinor: 857975, creditMinor: 0, postingId: null, description: 'GST split reclass' },
    { id: 'l4', journalId: 'j3', date: '2026-10-01', code: '2300', role: 'output', debitMinor: 0, creditMinor: 857975, postingId: null, description: 'GST split reclass' },
  ],
  opening: { '2300': 0, '2310': 0 },
  accountCodes: { output: '2300', recovery: '2310' },
  blockers: [],
  sourceMode: 'gl_simple_path',
  ...overrides,
});
const wpInput = { classifications: [], periodEvidence: 'TD statements and GST reclass journal reviewed.', reviewNote: '' };

describe('GL bridge — simpleAdjustments flow into the workpaper', () => {
  test('without adjustments the Muja workpaper is unchanged (104/107/110/111 = 0)', () => {
    const w = calculateWorkpaper(mujaBridgeSource(), wpInput);
    expect(w.blockers).toEqual([]);
    expect(w.lines).toMatchObject({ '101': 17159500, '103': 857975, '104': 0, '107': 0, '110': 0, '111': 0, '109': 857975, '115': 857975 });
  });

  test('with adjustments the workpaper agrees with the GST Return page, no classification blocker', () => {
    const w = calculateWorkpaper(mujaBridgeSource(), { ...wpInput, simpleAdjustments: ADJ });
    expect(w.blockers).toEqual([]);
    expect(w.reconciled).toBe(true);
    expect(w.lines).toMatchObject({
      '101': 17159500, '103': 857975, '104': 10000, '105': 867975, '106': 0, '107': 5000,
      '108': 5000, '109': 862975, '110': 100000, '111': 2500, '112': 102500,
      '113C': 760475, '114': 0, '115': 760475,
    });
    expect(w.simpleAdjustments?.totals).toEqual({ '104': 100, '107': 50, '110': 1000, '111': 25 });
  });

  test('reviewed-snapshot mode is untouched: simpleAdjustments are ignored there', () => {
    const source = mujaBridgeSource({ sourceMode: 'reviewed_snapshots' });
    source.sources = [{
      id: 's1', postingId: 'p1', journalId: 'j1', documentId: 'inv-1', sourceType: 'invoice',
      date: '2026-06-30', direction: 'sale', jurisdiction: 'AB', treatment: 'taxable',
      netMinor: 17159500, homeCurrency: 'CAD', reversalOfId: null,
      components: [{ type: 'gst', treatment: 'taxable', outputMinor: 857975, recoveryMinor: 0, nonrecoverableMinor: 0 }],
    }];
    source.ledger = [
      { id: 'r1', journalId: 'j1', date: '2026-06-30', code: '2300', role: 'output', debitMinor: 0, creditMinor: 857975, postingId: 'p1', description: 'GST on sale' },
    ];
    const w = calculateWorkpaper(source, { ...wpInput, simpleAdjustments: ADJ });
    expect(w.blockers).toEqual([]);
    expect(w.lines).toMatchObject({ '104': 0, '107': 0, '110': 0, '109': 857975 });
    expect(w.simpleAdjustments).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Service level — mocked DB (phase1-5 harness style)
// ---------------------------------------------------------------------------
const START = new Date('2025-10-02T00:00:00Z');
const END = new Date('2026-10-01T00:00:00Z');
const REG = {
  id: 'reg-muja', regime: 'gst_hst', registrationNumber: '731893160 RT0001', province: 'AB',
  method: 'regular', filingFrequency: 'annual', active: true,
  validFrom: new Date('2025-10-02T00:00:00Z'), validTo: null, reviewedAt: new Date('2026-10-26T00:00:00Z'),
};

function mockBase() {
  mockDb.company.findUnique.mockResolvedValue({
    id: 'muja', name: '2751623 Alberta Corporation', currency: 'CAD',
    gstNumber: '731893160 RT0001', province: 'AB', fiscalYearStart: new Date('2025-10-02T00:00:00Z'),
  });
  mockDb.companyTaxRegistration.findFirst.mockResolvedValue(REG);
  mockDb.companyTaxConfiguration.findUnique.mockResolvedValue({
    enabled: false,
    gstHstOutputAccount: { code: '2300' }, gstHstRecoverableAccount: { code: '2310' },
    qstOutputAccount: null, qstRecoverableAccount: null, pstRstPayableAccount: null, taxClearingAccount: null,
  });
  mockDb.chartOfAccount.findMany.mockImplementation(async ({ where }: any) => {
    if (where?.type === 'income') return [{ code: '4000' }];
    if (where?.code?.in) return [
      { code: '4000', type: 'income' }, { code: '2300', type: 'liability' }, { code: '2310', type: 'asset' },
    ];
    return [{ code: '4000' }];
  });
  mockDb.documentLineTaxSnapshot.findMany.mockResolvedValue([]);
  mockDb.journalEntry.findMany.mockResolvedValue([
    {
      id: 'j1', entryDate: new Date('2026-03-15T00:00:00Z'), description: 'Contract revenue', taxPosting: null,
      lines: [{ id: 'l1', glAccountCode: '4000', debit: '0', credit: '171595.00', description: null }],
    },
    {
      id: 'j2', entryDate: new Date('2026-03-15T00:00:00Z'), description: 'GST collected', taxPosting: null,
      lines: [{ id: 'l2', glAccountCode: '2300', debit: '0', credit: '8579.75', description: null }],
    },
  ]);
  mockDb.journalLine.findMany.mockResolvedValue([]);
  mockDb.taxReturnWorkpaper.findMany.mockResolvedValue([]);
  mockDb.taxReturnWorkpaper.findFirst.mockResolvedValue(null);
  mockDb.auditLog.create.mockResolvedValue({});
}

beforeEach(() => { jest.clearAllMocks(); mockBase(); });

describe('workpaper-service bridge — calculateCurrent with simpleAdjustments', () => {
  test('GL-mode workpaper lines include 104/107/110/111 and agree with the return', async () => {
    const { calculated } = await calculateCurrent('muja', 'reg-muja', START, END, { ...wpInput, simpleAdjustments: ADJ });
    expect(calculated.sourceMode).toBe('gl_simple_path');
    expect(calculated.blockers).toEqual([]);
    expect(calculated.lines).toMatchObject({
      '101': 17159500, '103': 857975, '104': 10000, '105': 867975, '107': 5000, '108': 5000,
      '109': 862975, '110': 100000, '111': 2500, '112': 102500, '115': 760475,
    });
  });

  test('GL-mode workpaper without adjustments keeps 104/107/110/111 at zero', async () => {
    const { calculated } = await calculateCurrent('muja', 'reg-muja', START, END, wpInput);
    expect(calculated.blockers).toEqual([]);
    expect(calculated.lines).toMatchObject({ '104': 0, '107': 0, '110': 0, '111': 0, '109': 857975, '115': 857975 });
  });
});

describe('gst-return-service — adjustments storage in inputs.simpleAdjustments', () => {
  test('computeGstReturn with no stored adjustments reproduces the Muja return', async () => {
    const view = await computeGstReturn('muja', '2025-10-02', '2026-10-01');
    expect(view.result.lines).toMatchObject({ '101': 171595, '103': 8579.75, '104': 0, '109': 8579.75, '115': 8579.75 });
    expect(view.adjustments.totals).toEqual({ '104': 0, '107': 0, '110': 0, '111': 0 });
    expect(view.adjustmentsWorkpaper).toBeNull();
  });

  test('saveGstAdjustments creates a draft workpaper lazily and audit-logs', async () => {
    mockDb.taxReturnWorkpaper.create.mockImplementation(async ({ data }: any) => ({ id: 'wp-1', ...data }));
    const saved = await saveGstAdjustments({
      companyId: 'muja', userId: 'owner-1', periodStart: '2025-10-02', periodEnd: '2026-10-01', adjustments: ADJ,
    });
    expect(saved.workpaperId).toBe('wp-1');
    expect(saved.result.lines).toMatchObject({ '104': 100, '105': 8679.75, '107': 50, '109': 8629.75, '112': 1025, '115': 7604.75 });
    const data = mockDb.taxReturnWorkpaper.create.mock.calls[0][0].data;
    expect(data.status).toBe('draft');
    expect(data.inputs.simpleAdjustments).toEqual(ADJ);
    expect(data.inputs.classifications).toEqual([]);
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'tax.gst_return.adjustments_saved', entityId: 'wp-1' }),
    }));
  });

  test('computeGstReturn reads stored adjustments back from the period workpaper', async () => {
    mockDb.taxReturnWorkpaper.findMany.mockResolvedValue([{
      id: 'wp-1', periodStart: START, periodEnd: END, status: 'draft', filedAt: null, filingConfirmation: null,
      inputs: { classifications: [], periodEvidence: 'x', reviewNote: '', simpleAdjustments: ADJ },
    }]);
    const view = await computeGstReturn('muja', '2025-10-02', '2026-10-01');
    expect(view.result.lines).toMatchObject({ '104': 100, '105': 8679.75, '107': 50, '109': 8629.75, '112': 1025, '115': 7604.75 });
    expect(view.adjustmentsWorkpaper).toEqual({ id: 'wp-1', status: 'draft' });
  });

  test('saveGstAdjustments updates an existing draft instead of creating a new version', async () => {
    mockDb.taxReturnWorkpaper.findFirst.mockResolvedValue({
      id: 'wp-1', status: 'draft',
      inputs: { classifications: [], periodEvidence: 'TD statements reviewed.', reviewNote: 'keep me', simpleAdjustments: { add: [], deduct: [], instalments: [], rebates: [] } },
    });
    mockDb.taxReturnWorkpaper.update.mockImplementation(async ({ data }: any) => ({ id: 'wp-1', ...data }));
    const saved = await saveGstAdjustments({
      companyId: 'muja', userId: 'owner-1', periodStart: '2025-10-02', periodEnd: '2026-10-01', adjustments: ADJ,
    });
    expect(saved.workpaperId).toBe('wp-1');
    expect(mockDb.taxReturnWorkpaper.create).not.toHaveBeenCalled();
    const data = mockDb.taxReturnWorkpaper.update.mock.calls[0][0].data;
    expect(data.inputs.simpleAdjustments).toEqual(ADJ);
    expect(data.inputs.periodEvidence).toBe('TD statements reviewed.');
    expect(data.inputs.reviewNote).toBe('keep me');
  });

  test('saveGstAdjustments refuses a filed period and a negative amount', async () => {
    mockDb.taxReturnWorkpaper.findFirst.mockResolvedValue({ id: 'wp-9', status: 'filed_recorded', inputs: {} });
    await expect(saveGstAdjustments({
      companyId: 'muja', userId: 'owner-1', periodStart: '2025-10-02', periodEnd: '2026-10-01', adjustments: ADJ,
    })).rejects.toMatchObject({ code: 'already_filed', status: 409 });
    await expect(saveGstAdjustments({
      companyId: 'muja', userId: 'owner-1', periodStart: '2025-10-02', periodEnd: '2026-10-01',
      adjustments: { add: [{ amount: -5, note: 'bad' }] },
    })).rejects.toMatchObject({ code: 'invalid_adjustments' });
  });

  test('saveGstAdjustments lazily creates a minimal registration from the company GST number', async () => {
    mockDb.companyTaxRegistration.findFirst.mockResolvedValue(null);
    mockDb.companyTaxRegistration.create.mockImplementation(async ({ data }: any) => ({ id: 'reg-new', ...data }));
    mockDb.taxReturnWorkpaper.create.mockImplementation(async ({ data }: any) => ({ id: 'wp-2', ...data }));
    const saved = await saveGstAdjustments({
      companyId: 'muja', userId: 'owner-1', periodStart: '2025-10-02', periodEnd: '2026-10-01', adjustments: ADJ,
    });
    expect(saved.workpaperId).toBe('wp-2');
    const regData = mockDb.companyTaxRegistration.create.mock.calls[0][0].data;
    expect(regData.registrationNumber).toBe('731893160 RT0001');
    expect(regData.filingFrequency).toBe('annual');
    expect(regData.reviewedById).toBe('owner-1');
  });
});
