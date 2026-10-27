/**
 * Phase 1 cleanup — QST return (simple path).
 *
 * Line structure verified 2026-10-26 against Revenu Québec FP-500-V
 * (2026-09) Part 1 and guide FPZ-2034.G-V §2.3 (see qst-return.ts):
 * 101 shared total supplies; 203 QST collectible; 205 = 203+204;
 * 206 ITRs; 208 = 206+207; 209 = 205−208; 213 = 209−212 (signed).
 *
 * QC fixture: a $1,149.75 tax-inclusive sale posted through the real
 * splits path (GST 5% + QST 9.975% on the net, per taxes.ts) splits to
 * net revenue $1,000.00, GST $50.00 (→ 2300) and QST $99.75 (→ 2340).
 * The GST amount must appear ONLY in the GST/HST return, the QST amount
 * ONLY in the QST return.
 */
import { computeQstReturn, qstReturnCsv, type QstJournalLine } from '@/lib/tax/qst-return';
import { computeGstHstReturn } from '@/lib/tax/gst-return';
import { computeSplitTaxes, buildPostingLines } from '@/lib/banking/splits';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeSimpleLineTax, resolveSimpleTaxAccounts, SIMPLE_TAX_ACCOUNT_CODES } from '@/lib/tax/simple';
import { TAX_ACCOUNT_ALLOWED_TYPES } from '@/lib/tax/config';

const accounts = resolveSimpleTaxAccounts({});
let seq = 0;
const jl = (accountCode: string, accountType: string, debit: number, credit: number, description = ''): QstJournalLine => ({
  id: `l${++seq}`,
  entryId: `e${seq}`,
  date: '2026-03-15',
  accountCode,
  accountType,
  description,
  debit,
  credit,
});

const TYPES: Record<string, string> = {
  '4000': 'income', '6300': 'expense', '2300': 'liability', '2310': 'asset',
  '2340': 'liability', '2350': 'asset', '1010': 'asset',
};

function qcSaleJournalLines(): QstJournalLine[] {
  const splits = [{ categoryCode: '4000', amount: 1149.75, taxProvince: 'QC', taxInclusive: true, taxRecoverable: true }];
  const computed = computeSplitTaxes(splits, 'in');
  const postings = buildPostingLines({
    splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode, tax: c.tax })),
    direction: 'in',
    bankAccountCode: '1010',
    total: 1149.75,
    description: 'QC sale',
    taxAccounts: accounts,
  });
  return postings.map((p) => jl(p.glAccountCode, TYPES[p.glAccountCode] ?? '', p.debit, p.credit, p.description));
}

function qcPurchaseJournalLines(): QstJournalLine[] {
  const splits = [{ categoryCode: '6300', amount: 1149.75, taxProvince: 'QC', taxInclusive: true, taxRecoverable: true }];
  const computed = computeSplitTaxes(splits, 'out');
  const postings = buildPostingLines({
    splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode, tax: c.tax })),
    direction: 'out',
    bankAccountCode: '1010',
    total: 1149.75,
    description: 'QC purchase',
    taxAccounts: accounts,
  });
  return postings.map((p) => jl(p.glAccountCode, TYPES[p.glAccountCode] ?? '', p.debit, p.credit, p.description));
}

describe('QC tax split semantics (fixture premise)', () => {
  it('gross $1,149.75 inclusive → net $1,000.00, GST $50.00, QST $99.75', () => {
    const r = computeSimpleLineTax(1149.75, { province: 'QC', priceMode: 'inclusive', direction: 'sale' });
    expect(r.net).toBe(1000);
    expect(r.outputGstHst).toBe(50);
    expect(r.outputQst).toBe(99.75);
  });

  it('sale postings route GST to 2300 and QST to 2340 (never mixed)', () => {
    const lines = qcSaleJournalLines();
    expect(lines.find((l) => l.accountCode === '4000')?.credit).toBe(1000);
    expect(lines.find((l) => l.accountCode === '2300')?.credit).toBe(50);
    expect(lines.find((l) => l.accountCode === '2340')?.credit).toBe(99.75);
    expect(lines.find((l) => l.accountCode === '2350')).toBeUndefined();
  });

  it('purchase postings route GST ITC to 2310 and QST ITR to 2350', () => {
    const lines = qcPurchaseJournalLines();
    expect(lines.find((l) => l.accountCode === '2310')?.debit).toBe(50);
    expect(lines.find((l) => l.accountCode === '2350')?.debit).toBe(99.75);
    expect(lines.find((l) => l.accountCode === '2340')).toBeUndefined();
  });
});

describe('QST return — QC sale fixture', () => {
  const result = computeQstReturn({ lines: qcSaleJournalLines(), outputAccountCode: '2340', recoverableAccountCode: '2350' });

  it('line 101 = total supplies $1,000.00 (tax excluded, shared line)', () => {
    expect(result.lines['101']).toBe(1000);
  });
  it('line 203 = QST collectible $99.75; 205 = 203 + 204', () => {
    expect(result.lines['203']).toBe(99.75);
    expect(result.lines['204']).toBe(0);
    expect(result.lines['205']).toBe(99.75);
  });
  it('lines 206–208 = $0 (no ITRs)', () => {
    expect(result.lines['206']).toBe(0);
    expect(result.lines['208']).toBe(0);
  });
  it('line 209 net QST = line 213 = $99.75, all payable, no refund', () => {
    expect(result.lines['209']).toBe(99.75);
    expect(result.lines['210']).toBe(0);
    expect(result.lines['211']).toBe(0);
    expect(result.lines['212']).toBe(0);
    expect(result.lines['213']).toBe(99.75);
    expect(result.amountPayable).toBe(99.75);
    expect(result.refundClaimed).toBe(0);
  });
  it('drill-down shows revenue on 101 and QST on 203 (account 2340)', () => {
    expect(result.drillDown['101']).toHaveLength(1);
    expect(result.drillDown['203']).toHaveLength(1);
    expect(result.drillDown['203'][0].accountCode).toBe('2340');
    expect(result.drillDown['203'][0].amount).toBe(99.75);
  });
  it('GST $50.00 is absent from every QST line', () => {
    for (const amount of Object.values(result.lines)) expect(amount).not.toBe(50);
    expect(result.drillDown['203'].every((d) => d.accountCode !== '2300')).toBe(true);
  });
});

describe('QST return — ITRs net in the return, not the GL', () => {
  it('sale + equal purchase → net QST $0 (ITR offsets collectible in the return only)', () => {
    const result = computeQstReturn({
      lines: [...qcSaleJournalLines(), ...qcPurchaseJournalLines()],
      outputAccountCode: '2340',
      recoverableAccountCode: '2350',
    });
    expect(result.lines['203']).toBe(99.75);
    expect(result.lines['206']).toBe(99.75);
    expect(result.lines['208']).toBe(99.75);
    expect(result.lines['209']).toBe(0);
    expect(result.lines['213']).toBe(0);
    expect(result.drillDown['206']).toHaveLength(1);
    expect(result.drillDown['206'][0].accountCode).toBe('2350');
  });

  it('refund position: ITRs exceed collectible → 213 negative, refund claimed derived', () => {
    const lines = [
      jl('4000', 'income', 0, 100, 'Small sale net'),
      jl('2340', 'liability', 0, 9.98, 'QST collected'),
      jl('2350', 'asset', 99.75, 0, 'ITR on equipment'),
    ];
    const result = computeQstReturn({ lines, outputAccountCode: '2340', recoverableAccountCode: '2350' });
    expect(result.lines['209']).toBe(-89.77);
    expect(result.lines['213']).toBe(-89.77);
    expect(result.refundClaimed).toBe(89.77);
    expect(result.amountPayable).toBe(0);
  });

  it('credit notes net against 101 and 203', () => {
    const lines = [
      jl('4000', 'income', 0, 1000, 'Sale'),
      jl('2340', 'liability', 0, 99.75, 'QST'),
      jl('4000', 'income', 200, 0, 'Credit note'),
      jl('2340', 'liability', 19.95, 0, 'QST on credit note'),
    ];
    const result = computeQstReturn({ lines, outputAccountCode: '2340', recoverableAccountCode: '2350' });
    expect(result.lines['101']).toBe(800);
    expect(result.lines['203']).toBe(79.8);
  });

  it('configured (non-default) QST account codes are honoured', () => {
    const lines = [
      jl('4000', 'income', 0, 200, 'Sale'),
      jl('2440', 'liability', 0, 19.95, 'QST to custom payable'),
      jl('1250', 'asset', 9.98, 0, 'ITR in custom receivable'),
    ];
    const result = computeQstReturn({ lines, outputAccountCode: '2440', recoverableAccountCode: '1250' });
    expect(result.lines['203']).toBe(19.95);
    expect(result.lines['206']).toBe(9.98);
    expect(result.lines['209']).toBe(9.97);
  });
});

describe('GST/HST return regression — same GL lines exclude QST accounts', () => {
  it('GST lines carry only the GST amounts; QST lines carry only QST', () => {
    const lines = [...qcSaleJournalLines(), ...qcPurchaseJournalLines()];
    const gst = computeGstHstReturn({ lines, outputAccountCode: '2300', recoverableAccountCode: '2310' });
    expect(gst.lines['101']).toBe(1000);
    expect(gst.lines['103']).toBe(50);
    expect(gst.lines['106']).toBe(50);
    expect(gst.lines['109']).toBe(0);
    const qst = computeQstReturn({ lines, outputAccountCode: '2340', recoverableAccountCode: '2350' });
    expect(qst.lines['203']).toBe(99.75);
    expect(qst.lines['206']).toBe(99.75);
  });
});

describe('QST default accounts — accounting identity', () => {
  it('resolveSimpleTaxAccounts defaults QST to 2340/2350, GST/HST unchanged', () => {
    const r = resolveSimpleTaxAccounts({});
    expect(r.qstOutput).toBe('2340');
    expect(r.qstRecoverable).toBe('2350');
    expect(r.output).toBe('2300');
    expect(r.recoverable).toBe('2310');
    expect(SIMPLE_TAX_ACCOUNT_CODES.qstOutput).toBe('2340');
    expect(SIMPLE_TAX_ACCOUNT_CODES.qstRecoverable).toBe('2350');
  });

  it('config mappings still win over the new defaults', () => {
    const r = resolveSimpleTaxAccounts({
      configuration: { qstOutputAccount: { code: '2440' }, qstRecoverableAccount: { code: '1250' } },
    });
    expect(r.qstOutput).toBe('2440');
    expect(r.qstRecoverable).toBe('1250');
  });

  it('default COA carries 2340 (liability) and 2350 (asset), allowed for QST mappings', () => {
    // default-coa.ts imports the Prisma client (ungenerated in the
    // sandbox), so assert against the template source — the same guard
    // phase1-tax-foundation.test.ts uses for schema-level facts.
    const src = readFileSync(resolve(__dirname, '../src/lib/default-coa.ts'), 'utf8');
    expect(src).toMatch(/code: '2340', name: 'QST Payable', type: 'liability'/);
    expect(src).toMatch(/code: '2350', name: 'QST Recoverable — Input Tax Refunds', type: 'asset'/);
    expect(TAX_ACCOUNT_ALLOWED_TYPES.qstOutput).toContain('liability');
    expect(TAX_ACCOUNT_ALLOWED_TYPES.qstRecoverable).toContain('asset');
  });
});

describe('QST return CSV working copy', () => {
  it('is labelled NOT FILED until filing is recorded, and carries the lines', () => {
    const result = computeQstReturn({ lines: qcSaleJournalLines(), outputAccountCode: '2340', recoverableAccountCode: '2350' });
    const csv = qstReturnCsv({ companyName: 'Exemple QC Inc.', periodStart: '2026-01-01', periodEnd: '2026-03-31', filedLabel: 'NOT FILED — working copy', result });
    expect(csv).toContain('NOT FILED');
    expect(csv).toContain('99.75');
    expect(csv).toContain('2340');
    const filed = qstReturnCsv({ companyName: 'X', periodStart: '2026-01-01', periodEnd: '2026-03-31', filedLabel: 'FILED — recorded 2026-04-30', result });
    expect(filed).toContain('FILED — recorded');
  });
});
