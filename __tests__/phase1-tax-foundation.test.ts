/**
 * Phase 1 — tax foundation (simple path).
 * Fixtures: AB GST 5% sale/purchase, BC GST+PST purchase (PST non-recoverable),
 * ON HST, QC GST+QST, legacy single-rate routing fix, journal expansion,
 * rounding, and the unchanged no-tax path.
 */
import { computeSimpleLineTax, resolveSimpleTaxAccounts, SIMPLE_TAX_ACCOUNT_CODES } from '@/lib/tax/simple';
import { computeSplitTaxes, buildPostingLines } from '@/lib/banking/splits';
import { expandJournalTaxLines } from '@/lib/tax/journal-tax';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const accounts = resolveSimpleTaxAccounts({});
const byCode = (lines: { glAccountCode: string; debit: number; credit: number }[], code: string) =>
  lines.filter((l) => l.glAccountCode === code);

describe('computeSimpleLineTax (engine wrapper)', () => {
  it('AB sale $105 inclusive → $100 net + $5 GST output', () => {
    const r = computeSimpleLineTax(105, { province: 'AB', priceMode: 'inclusive', direction: 'sale' });
    expect(r.net).toBe(100);
    expect(r.tax).toBe(5);
    expect(r.gross).toBe(105);
    expect(r.outputGstHst).toBe(5);
  });

  it('AB purchase $105 inclusive, recoverable → $5 ITC, expense $100', () => {
    const r = computeSimpleLineTax(105, { province: 'AB', priceMode: 'inclusive', direction: 'purchase' });
    expect(r.net).toBe(100);
    expect(r.recoverableTax).toBe(5);
    expect(r.nonrecoverableTax).toBe(0);
  });

  it('BC purchase $112 inclusive → net $100, GST $5 recoverable, PST $7 non-recoverable', () => {
    const r = computeSimpleLineTax(112, { province: 'BC', priceMode: 'inclusive', direction: 'purchase' });
    expect(r.net).toBe(100);
    expect(r.recoverableTax).toBe(5);
    expect(r.nonrecoverableTax).toBe(7);
  });

  it('BC purchase with recoverable=false → all $12 tax expensed', () => {
    const r = computeSimpleLineTax(112, { province: 'BC', priceMode: 'inclusive', direction: 'purchase', recoverable: false });
    expect(r.recoverableTax).toBe(0);
    expect(r.nonrecoverableTax).toBe(12);
  });

  it('ON sale $113 inclusive → $100 + $13 HST', () => {
    const r = computeSimpleLineTax(113, { province: 'ON', priceMode: 'inclusive', direction: 'sale' });
    expect(r.net).toBe(100);
    expect(r.outputGstHst).toBe(13);
  });

  it('QC purchase $100 exclusive → GST $5.00 + QST $9.98, both recoverable', () => {
    const r = computeSimpleLineTax(100, { province: 'QC', priceMode: 'exclusive', direction: 'purchase' });
    const gst = r.components.find((c) => c.kind === 'GST');
    const qst = r.components.find((c) => c.kind === 'QST');
    expect(gst?.tax).toBe(5);
    expect(qst?.tax).toBe(9.98); // 9.975 rounds half away from zero per component
    expect(r.recoverableTax).toBe(14.98);
    expect(r.gross).toBe(114.98);
  });

  it('rounding: $2.50 exclusive @5% → $0.13 tax (half away from zero)', () => {
    const r = computeSimpleLineTax(2.5, { province: 'AB', priceMode: 'exclusive', direction: 'sale' });
    expect(r.tax).toBe(0.13);
  });

  it('rounding: $10.05 inclusive @5% → tax $0.48, net $9.57', () => {
    const r = computeSimpleLineTax(10.05, { province: 'AB', priceMode: 'inclusive', direction: 'sale' });
    expect(r.tax).toBe(0.48);
    expect(r.net).toBe(9.57);
  });

  it('NS uses the date-sensitive rate table (14% from 2025-04-01)', () => {
    const r = computeSimpleLineTax(114, { province: 'NS', priceMode: 'inclusive', direction: 'sale', date: '2026-01-15' });
    expect(r.outputGstHst).toBe(14);
    const old = computeSimpleLineTax(115, { province: 'NS', priceMode: 'inclusive', direction: 'sale', date: '2024-06-15' });
    expect(old.outputGstHst).toBe(15);
  });
});

describe('banking splits — province path posting lines', () => {
  it('AB purchase split $105 incl → Dr expense 100, Dr 2310 ITC 5, Cr bank 105', () => {
    const computed = computeSplitTaxes(
      [{ categoryCode: '6100', amount: 105, taxCode: null, taxRate: null, taxInclusive: true, taxProvince: 'AB' }],
      'out',
    );
    const lines = buildPostingLines({
      splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode, tax: c.tax })),
      direction: 'out',
      bankAccountCode: '1010',
      total: 105,
      description: 'Software',
      taxAccounts: accounts,
    });
    expect(byCode(lines, '6100')[0].debit).toBe(100);
    expect(byCode(lines, '2310')[0].debit).toBe(5);
    expect(byCode(lines, '2300')).toHaveLength(0);
    expect(byCode(lines, '1010')[0].credit).toBe(105);
  });

  it('BC purchase split $112 incl → Dr expense 107 (net+PST), Dr 2310 5, Cr bank 112', () => {
    const computed = computeSplitTaxes(
      [{ categoryCode: '6300', amount: 112, taxCode: null, taxRate: null, taxInclusive: true, taxProvince: 'BC' }],
      'out',
    );
    const lines = buildPostingLines({
      splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode, tax: c.tax })),
      direction: 'out',
      bankAccountCode: '1010',
      total: 112,
      description: 'Rent',
      taxAccounts: accounts,
    });
    expect(byCode(lines, '6300')[0].debit).toBe(107);
    expect(byCode(lines, '2310')[0].debit).toBe(5);
    expect(byCode(lines, '1010')[0].credit).toBe(112);
  });

  it('AB sale split $105 incl → Cr revenue 100, Cr 2300 5, Dr bank 105', () => {
    const computed = computeSplitTaxes(
      [{ categoryCode: '4100', amount: 105, taxCode: null, taxRate: null, taxInclusive: true, taxProvince: 'AB' }],
      'in',
    );
    const lines = buildPostingLines({
      splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode, tax: c.tax })),
      direction: 'in',
      bankAccountCode: '1010',
      total: 105,
      description: 'Services',
      taxAccounts: accounts,
    });
    expect(byCode(lines, '4100')[0].credit).toBe(100);
    expect(byCode(lines, '2300')[0].credit).toBe(5);
    expect(byCode(lines, '1010')[0].debit).toBe(105);
  });
});

describe('banking splits — legacy single-rate routing fix', () => {
  it('legacy GST purchase no longer debits 2300; ITC goes to the recoverable account', () => {
    const computed = computeSplitTaxes([
      { categoryCode: '6100', amount: 105, taxCode: 'GST 5% (included)', taxRate: 5, taxInclusive: true },
    ]);
    expect(computed[0].tax.recoverableGstHst).toBe(5);
    const lines = buildPostingLines({
      splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode, tax: c.tax })),
      direction: 'out',
      bankAccountCode: '1010',
      total: 105,
      description: 'Legacy',
      taxAccounts: accounts,
    });
    expect(byCode(lines, '2300')).toHaveLength(0);
    expect(byCode(lines, SIMPLE_TAX_ACCOUNT_CODES.recoverable)[0].debit).toBe(5);
  });

  it('legacy PST-labelled purchase is expensed, not recovered', () => {
    const computed = computeSplitTaxes([
      { categoryCode: '6100', amount: 107, taxCode: 'PST 7% (included)', taxRate: 7, taxInclusive: true },
    ]);
    expect(computed[0].tax.nonrecoverable).toBe(7);
    expect(computed[0].tax.recoverableGstHst).toBe(0);
  });

  it('no-tax split is byte-identical in shape to the pre-Phase-1 lines', () => {
    const computed = computeSplitTaxes([{ categoryCode: '6100', amount: 50, taxCode: null, taxRate: null, taxInclusive: true }]);
    expect(computed[0].taxAmount).toBe(0);
    const lines = buildPostingLines({
      splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode, tax: c.tax })),
      direction: 'out',
      bankAccountCode: '1010',
      total: 50,
      description: 'Plain',
      taxAccounts: accounts,
    });
    expect(lines).toEqual([
      { glAccountCode: '6100', description: 'Plain', debit: 50, credit: 0 },
      { glAccountCode: '1010', description: 'Plain', debit: 0, credit: 50 },
    ]);
  });
});

describe('manual journal tax expansion', () => {
  it('Dr expense $105 AB → Dr expense 100 + Dr 2310 5 (entry total preserved)', () => {
    const lines = expandJournalTaxLines(
      [
        { glAccountCode: '6100', description: 'Software', debit: 105, credit: 0, tax: { province: 'AB' } },
        { glAccountCode: '1010', description: 'Bank', debit: 0, credit: 105 },
      ],
      accounts,
    );
    expect(byCode(lines, '6100')[0].debit).toBe(100);
    expect(byCode(lines, '2310')[0].debit).toBe(5);
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });

  it('Cr revenue $105 AB → Cr revenue 100 + Cr 2300 5', () => {
    const lines = expandJournalTaxLines(
      [
        { glAccountCode: '1010', debit: 105, credit: 0 },
        { glAccountCode: '4100', description: 'Sales', debit: 0, credit: 105, tax: { province: 'AB' } },
      ],
      accounts,
    );
    expect(byCode(lines, '4100')[0].credit).toBe(100);
    expect(byCode(lines, '2300')[0].credit).toBe(5);
  });

  it('Dr expense $112 BC → Dr expense 107 + Dr 2310 5', () => {
    const lines = expandJournalTaxLines(
      [
        { glAccountCode: '6300', debit: 112, credit: 0, tax: { province: 'BC' } },
        { glAccountCode: '1010', debit: 0, credit: 112 },
      ],
      accounts,
    );
    expect(byCode(lines, '6300')[0].debit).toBe(107);
    expect(byCode(lines, '2310')[0].debit).toBe(5);
  });

  it('exclusive spec is rejected, untagged lines pass through untouched', () => {
    expect(() =>
      expandJournalTaxLines([{ glAccountCode: '6100', debit: 100, credit: 0, tax: { province: 'AB', priceMode: 'exclusive' } }], accounts),
    ).toThrow(/inclusive-only/);
    const plain = expandJournalTaxLines([{ glAccountCode: '6100', debit: 100, credit: 0 }], accounts);
    expect(plain).toEqual([{ glAccountCode: '6100', description: undefined, debit: 100, credit: 0 }]);
  });
});

describe('defaults & resolution', () => {
  it('default COA carries the ITC asset and PST payable accounts', () => {
    // default-coa.ts imports the Prisma client (ungenerated in the sandbox),
    // so assert against the template source — the same guard the other
    // migration tests use for schema-level facts.
    const src = readFileSync(resolve(__dirname, '../src/lib/default-coa.ts'), 'utf8');
    expect(src).toMatch(/code: '2310', name: 'GST\/HST Recoverable — Input Tax Credits', type: 'asset'/);
    expect(src).toMatch(/code: '2330', name: 'Provincial Sales Tax Payable', type: 'liability'/);
  });

  it('configuration mappings override defaults', () => {
    const r = resolveSimpleTaxAccounts({
      configuration: {
        gstHstOutputAccount: { code: '2315' },
        gstHstRecoverableAccount: { code: '1310' },
        pstRstPayableAccount: null,
        qstOutputAccount: null,
        qstRecoverableAccount: null,
      },
    });
    expect(r.output).toBe('2315');
    expect(r.recoverable).toBe('1310');
    expect(r.pstPayable).toBe('2330');
  });
});
