/**
 * Phase 1 cleanup — partial (fractional) tax recovery.
 *
 * Semantics: `recoveryPercent` (0–100, may be fractional) on a purchase
 * line, when present, WINS over the `recoverable` boolean; when absent,
 * the boolean applies and behaviour is exactly the pre-cleanup behaviour.
 * Out-of-range percents throw (no clamping). The fraction applies per
 * component (GST/HST + QST) inside the engine, half away from zero;
 * PST/RST remain never recoverable. The recoverable fraction posts to
 * the ITC/ITR account(s); the rest is expensed into the category line.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeSimpleLineTax, provinceComponents, recoveryBasisPoints, resolveSimpleTaxAccounts } from '@/lib/tax/simple';
import { computeSplitTaxes, buildPostingLines } from '@/lib/banking/splits';
import { expandJournalTaxLines } from '@/lib/tax/journal-tax';
import { buildRuleTaxSplit } from '@/lib/banking/rule-tax';

const accounts = resolveSimpleTaxAccounts({});
const byCode = (lines: { glAccountCode: string; debit: number; credit: number }[], code: string) =>
  lines.filter((l) => l.glAccountCode === code);

function postSplit(split: Parameters<typeof computeSplitTaxes>[0][number], description = 'Test') {
  const computed = computeSplitTaxes([split], 'out');
  const lines = buildPostingLines({
    splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode, tax: c.tax })),
    direction: 'out',
    bankAccountCode: '1010',
    total: Math.abs(split.amount),
    description,
    taxAccounts: accounts,
  });
  return { computed, lines };
}

describe('recoveryBasisPoints semantics', () => {
  it('percent present wins over the boolean, including fractional percents', () => {
    expect(recoveryBasisPoints(true, 50)).toBe(5000);
    expect(recoveryBasisPoints(false, 50)).toBe(5000);
    expect(recoveryBasisPoints(false, 50.5)).toBe(5050);
    expect(recoveryBasisPoints(true, 0)).toBe(0);
    expect(recoveryBasisPoints(false, 100)).toBe(10000);
  });

  it('absent percent falls back to the boolean exactly', () => {
    expect(recoveryBasisPoints(true)).toBe(10000);
    expect(recoveryBasisPoints(false)).toBe(0);
    expect(recoveryBasisPoints(true, null)).toBe(10000);
    expect(recoveryBasisPoints(false, undefined)).toBe(0);
  });

  it('out-of-range / non-finite percents throw a clear error (no clamping)', () => {
    expect(() => recoveryBasisPoints(true, -0.01)).toThrow(/recoveryPercent must be a number between 0 and 100/);
    expect(() => recoveryBasisPoints(true, 100.01)).toThrow(/between 0 and 100/);
    expect(() => recoveryBasisPoints(true, Number.NaN)).toThrow(/between 0 and 100/);
    expect(() =>
      computeSimpleLineTax(105, { province: 'AB', priceMode: 'inclusive', direction: 'purchase', recoveryPercent: 101 }),
    ).toThrow(/between 0 and 100/);
  });

  it('provinceComponents stamps the fractional bp on GST and QST, never on PST', () => {
    const qc = provinceComponents('QC', 'purchase', true, undefined, 50);
    expect(qc.find((c) => c.kind === 'GST')?.recoveryBasisPoints).toBe(5000);
    expect(qc.find((c) => c.kind === 'QST')?.recoveryBasisPoints).toBe(5000);
    const bc = provinceComponents('BC', 'purchase', true, undefined, 50);
    expect(bc.find((c) => c.kind === 'GST')?.recoveryBasisPoints).toBe(5000);
    expect(bc.find((c) => c.kind === 'PST')?.recoveryBasisPoints).toBe(0);
    // Sales ignore recovery entirely.
    expect(provinceComponents('AB', 'sale', true, undefined, 50)[0].recoveryBasisPoints).toBe(0);
  });
});

describe('(a) equivalence with the boolean — 100% / absent ≡ recoverable=true, 0% ≡ false', () => {
  const cases = [
    { province: 'AB' as const, amount: 105 },
    { province: 'BC' as const, amount: 112 },
    { province: 'QC' as const, amount: 114.98 },
    { province: 'ON' as const, amount: 113 },
  ];
  for (const { province, amount } of cases) {
    it(`${province}: recoveryPercent=100 and absent are byte-identical to recoverable=true`, () => {
      const base = computeSimpleLineTax(amount, { province, priceMode: 'inclusive', direction: 'purchase', recoverable: true });
      const absent = computeSimpleLineTax(amount, { province, priceMode: 'inclusive', direction: 'purchase' });
      const pct100 = computeSimpleLineTax(amount, { province, priceMode: 'inclusive', direction: 'purchase', recoveryPercent: 100 });
      const pct100OverFalse = computeSimpleLineTax(amount, { province, priceMode: 'inclusive', direction: 'purchase', recoverable: false, recoveryPercent: 100 });
      expect(pct100).toEqual(base);
      expect(absent).toEqual(base);
      expect(pct100OverFalse).toEqual(base);
    });

    it(`${province}: recoveryPercent=0 is identical to recoverable=false`, () => {
      const base = computeSimpleLineTax(amount, { province, priceMode: 'inclusive', direction: 'purchase', recoverable: false });
      const pct0 = computeSimpleLineTax(amount, { province, priceMode: 'inclusive', direction: 'purchase', recoverable: true, recoveryPercent: 0 });
      expect(pct0).toEqual(base);
      expect(pct0.recoverableTax).toBe(0);
    });
  }

  it('posting lines are identical for percent=100 vs boolean true (AB split)', () => {
    const boolLines = postSplit({ categoryCode: '6100', amount: 105, taxCode: null, taxRate: null, taxInclusive: true, taxProvince: 'AB', taxRecoverable: true }).lines;
    const pctLines = postSplit({ categoryCode: '6100', amount: 105, taxCode: null, taxRate: null, taxInclusive: true, taxProvince: 'AB', taxRecoveryPercent: 100 }).lines;
    expect(pctLines).toEqual(boolLines);
  });
});

describe('(b) 50% meals case — AB purchase, inclusive $105.00', () => {
  it('engine: GST $5.00 total, recoverable $2.50, non-recoverable $2.50', () => {
    const r = computeSimpleLineTax(105, { province: 'AB', priceMode: 'inclusive', direction: 'purchase', recoveryPercent: 50 });
    expect(r.tax).toBe(5);
    expect(r.recoverableTax).toBe(2.5);
    expect(r.nonrecoverableTax).toBe(2.5);
    expect(r.net).toBe(100);
  });

  it('posting: category debit $102.50 (net + expensed tax), ITC $2.50, bank credit $105.00', () => {
    const { computed, lines } = postSplit(
      { categoryCode: '6200', amount: 105, taxCode: null, taxRate: null, taxInclusive: true, taxProvince: 'AB', taxRecoveryPercent: 50 },
      'Meals',
    );
    expect(computed[0].taxRecoveryPercent).toBe(50);
    expect(computed[0].tax.recoverableGstHst).toBe(2.5);
    expect(computed[0].tax.nonrecoverable).toBe(2.5);
    expect(byCode(lines, '6200')[0].debit).toBe(102.5);
    expect(byCode(lines, '2310')[0].debit).toBe(2.5);
    expect(byCode(lines, '2300')).toHaveLength(0);
    expect(byCode(lines, '1010')[0].credit).toBe(105);
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });

  it('legacy taxCode-label path is unchanged by the new field', () => {
    const computed = computeSplitTaxes([
      { categoryCode: '6100', amount: 105, taxCode: 'GST 5% (included)', taxRate: 5, taxInclusive: true, taxRecoveryPercent: 50 },
    ]);
    // No taxProvince → legacy single-rate routing: full ITC, percent ignored.
    expect(computed[0].tax.recoverableGstHst).toBe(5);
    expect(computed[0].tax.nonrecoverable).toBe(0);
  });
});

describe('(c) QC case — GST + QST both at 50%', () => {
  it('exclusive $100: GST $5.00 → $2.50/$2.50; QST $9.98 → $4.99/$4.99 (per-component rounding)', () => {
    const r = computeSimpleLineTax(100, { province: 'QC', priceMode: 'exclusive', direction: 'purchase', recoveryPercent: 50 });
    const gst = r.components.find((c) => c.kind === 'GST');
    const qst = r.components.find((c) => c.kind === 'QST');
    expect(gst?.tax).toBe(5);
    expect(gst?.recoverable).toBe(2.5);
    expect(gst?.nonrecoverable).toBe(2.5);
    expect(qst?.tax).toBe(9.98);
    expect(qst?.recoverable).toBe(4.99);
    expect(qst?.nonrecoverable).toBe(4.99);
    expect(r.recoverableTax).toBe(7.49);
    expect(r.nonrecoverableTax).toBe(7.49);
    expect(r.gross).toBe(114.98);
  });

  it('split posting routes GST and QST recoverable fractions separately, rest expensed', () => {
    const { computed } = postSplit({ categoryCode: '6100', amount: 100, taxCode: null, taxRate: null, taxInclusive: false, taxProvince: 'QC', taxRecoveryPercent: 50 });
    expect(computed[0].tax.recoverableGstHst).toBe(2.5);
    expect(computed[0].tax.recoverableQst).toBe(4.99);
    expect(computed[0].tax.nonrecoverable).toBe(7.49);
  });
});

describe('(d) categorization rule stamping', () => {
  it('a rule with taxRecoveryPercent stamps it into the split JSON', () => {
    const split = buildRuleTaxSplit(
      { taxEnabled: true, taxProvince: 'AB', taxInclusive: true, taxRecoverable: true, taxRecoveryPercent: 50 },
      { categoryCode: '6200', amount: -105 },
    );
    expect(split?.taxRecoveryPercent).toBe(50);
    // …and the stamped split posts at 50% when it reaches the posting path.
    const { lines } = postSplit(split!);
    expect(byCode(lines, '6200')[0].debit).toBe(102.5);
    expect(byCode(lines, '2310')[0].debit).toBe(2.5);
  });

  it('a Prisma-Decimal-shaped percent is normalised to a plain number', () => {
    const split = buildRuleTaxSplit(
      { taxEnabled: true, taxProvince: 'AB', taxInclusive: true, taxRecoverable: true, taxRecoveryPercent: { toString: () => '50.00' } },
      { categoryCode: '6200', amount: -105 },
    );
    expect(split?.taxRecoveryPercent).toBe(50);
  });

  it('a rule without the percent stamps NO taxRecoveryPercent key (legacy split byte-identical)', () => {
    const split = buildRuleTaxSplit(
      { taxEnabled: true, taxProvince: 'AB', taxInclusive: true, taxRecoverable: true, taxRecoveryPercent: null },
      { categoryCode: '6100', amount: -105 },
    );
    expect(split).not.toHaveProperty('taxRecoveryPercent');
    const noField = buildRuleTaxSplit(
      { taxEnabled: true, taxProvince: 'AB', taxInclusive: true, taxRecoverable: true },
      { categoryCode: '6100', amount: -105 },
    );
    expect(noField).not.toHaveProperty('taxRecoveryPercent');
  });

  it('rule schema accepts 0–100 / null, rejects out-of-range', async () => {
    const { taxFieldsSchema } = await import('@/lib/banking/rule-schema');
    expect(taxFieldsSchema.parse({ taxRecoveryPercent: 50 }).taxRecoveryPercent).toBe(50);
    expect(taxFieldsSchema.parse({ taxRecoveryPercent: 50.25 }).taxRecoveryPercent).toBe(50.25);
    expect(taxFieldsSchema.parse({ taxRecoveryPercent: null }).taxRecoveryPercent).toBeNull();
    expect(taxFieldsSchema.parse({}).taxRecoveryPercent).toBeUndefined();
    expect(() => taxFieldsSchema.parse({ taxRecoveryPercent: 101 })).toThrow();
    expect(() => taxFieldsSchema.parse({ taxRecoveryPercent: -1 })).toThrow();
  });

  it('schema + migration carry the nullable Decimal(5,2) column', () => {
    const schema = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model CategorizationRule'), schema.indexOf('model CategorizationRule') + 1800);
    expect(model).toContain('taxRecoveryPercent Decimal? @db.Decimal(5, 2)');
    const sql = readFileSync(
      resolve(__dirname, '../prisma/migrations/20261026120000_p1_cleanup_rule_recovery/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('ADD COLUMN "taxRecoveryPercent" DECIMAL(5,2)');
    expect(sql).not.toContain('NOT NULL');
  });
});

describe('(e) journal expansion with recoveryPercent', () => {
  it('Dr expense $105 AB at 50% → Dr expense $102.50 + Dr 2310 $2.50, entry stays balanced', () => {
    const lines = expandJournalTaxLines(
      [
        { glAccountCode: '6200', description: 'Meals', debit: 105, credit: 0, tax: { province: 'AB', recoveryPercent: 50 } },
        { glAccountCode: '1010', description: 'Bank', debit: 0, credit: 105 },
      ],
      accounts,
    );
    expect(byCode(lines, '6200')[0].debit).toBe(102.5);
    expect(byCode(lines, '2310')[0].debit).toBe(2.5);
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
  });

  it('journal recoveryPercent=100 matches the boolean-true expansion; 0 matches false', () => {
    const mk = (tax: object) =>
      expandJournalTaxLines(
        [
          { glAccountCode: '6100', debit: 105, credit: 0, tax: { province: 'AB', ...tax } },
          { glAccountCode: '1010', debit: 0, credit: 105 },
        ],
        accounts,
      );
    expect(mk({ recoveryPercent: 100 })).toEqual(mk({ recoverable: true }));
    expect(mk({})).toEqual(mk({ recoverable: true }));
    expect(mk({ recoveryPercent: 0 })).toEqual(mk({ recoverable: false }));
  });

  it('out-of-range journal percent throws (the API surfaces this as a 400)', () => {
    expect(() =>
      expandJournalTaxLines([{ glAccountCode: '6100', debit: 105, credit: 0, tax: { province: 'AB', recoveryPercent: 150 } }], accounts),
    ).toThrow(/between 0 and 100/);
  });

  it('sales (credit) lines ignore recoveryPercent', () => {
    const lines = expandJournalTaxLines(
      [
        { glAccountCode: '1010', debit: 105, credit: 0 },
        { glAccountCode: '4100', description: 'Sales', debit: 0, credit: 105, tax: { province: 'AB', recoveryPercent: 50 } },
      ],
      accounts,
    );
    expect(byCode(lines, '4100')[0].credit).toBe(100);
    expect(byCode(lines, '2300')[0].credit).toBe(5);
  });
});
