/**
 * Phase 1 — tax field on Settings → Categorization rules.
 * A tax-enabled rule stamps a single split on the transactions it
 * categorizes; posting that split must split tax identically to a
 * manually entered split. Non-tax rules change nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRuleTaxSplit } from '@/lib/banking/rule-tax';
import { computeSplitTaxes, buildPostingLines } from '@/lib/banking/splits';
import { resolveSimpleTaxAccounts } from '@/lib/tax/simple';

const accounts = resolveSimpleTaxAccounts({});

describe('buildRuleTaxSplit', () => {
  it('returns null when tax is disabled (behaviour unchanged)', () => {
    expect(buildRuleTaxSplit({ taxEnabled: false, taxProvince: 'AB', taxInclusive: true, taxRecoverable: true }, { categoryCode: '6100', amount: -105 })).toBeNull();
  });

  it('stamps a single province split with the rule treatment', () => {
    const split = buildRuleTaxSplit(
      { taxEnabled: true, taxProvince: 'AB', taxInclusive: true, taxRecoverable: true },
      { categoryCode: '4000', amount: 180174.75 },
    );
    expect(split).toMatchObject({
      categoryCode: '4000',
      amount: 180174.75,
      taxProvince: 'AB',
      taxInclusive: true,
      taxRecoverable: true,
      taxRate: null,
    });
  });

  it('uses the absolute amount (bank rows are signed)', () => {
    const split = buildRuleTaxSplit(
      { taxEnabled: true, taxProvince: 'BC', taxInclusive: true, taxRecoverable: false },
      { categoryCode: '6300', amount: -112 },
    );
    expect(split?.amount).toBe(112);
    expect(split?.taxRecoverable).toBe(false);
  });
});

describe('rule-stamped split posts identically to a manual split', () => {
  it('Muja-shaped revenue: $180,174.75 inflow, AB GST inclusive → net $171,595.00 + GST $8,579.75', () => {
    const split = buildRuleTaxSplit(
      { taxEnabled: true, taxProvince: 'AB', taxInclusive: true, taxRecoverable: true },
      { categoryCode: '4000', amount: 180174.75 },
    )!;
    const computed = computeSplitTaxes([split], 'in');
    expect(computed[0].net).toBe(171595.0);
    expect(computed[0].taxAmount).toBe(8579.75);
    const lines = buildPostingLines({
      splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode, tax: c.tax })),
      direction: 'in',
      bankAccountCode: '1010',
      total: 180174.75,
      description: 'Contract revenue',
      taxAccounts: accounts,
    });
    const revenue = lines.find((l) => l.glAccountCode === '4000');
    const gst = lines.find((l) => l.glAccountCode === '2300');
    const bank = lines.find((l) => l.glAccountCode === '1010');
    expect(revenue?.credit).toBe(171595.0);
    expect(gst?.credit).toBe(8579.75);
    expect(bank?.debit).toBe(180174.75);
  });

  it('rule purchase in BC: expense carries PST, GST is an ITC', () => {
    const split = buildRuleTaxSplit(
      { taxEnabled: true, taxProvince: 'BC', taxInclusive: true, taxRecoverable: true },
      { categoryCode: '6300', amount: -112 },
    )!;
    const computed = computeSplitTaxes([split], 'out');
    const lines = buildPostingLines({
      splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode, tax: c.tax })),
      direction: 'out',
      bankAccountCode: '1010',
      total: 112,
      description: 'Rent',
      taxAccounts: accounts,
    });
    expect(lines.find((l) => l.glAccountCode === '6300')?.debit).toBe(107);
    expect(lines.find((l) => l.glAccountCode === '2310')?.debit).toBe(5);
    expect(lines.find((l) => l.glAccountCode === '2300')).toBeUndefined();
  });
});

describe('schema + migration', () => {
  it('CategorizationRule carries the Phase 1 tax columns', () => {
    const schema = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model CategorizationRule'), schema.indexOf('model CategorizationRule') + 1600);
    expect(model).toContain('taxEnabled');
    expect(model).toContain('taxProvince');
    expect(model).toContain('taxInclusive');
    expect(model).toContain('taxRecoverable');
  });

  it('migration adds the columns with behaviour-preserving defaults', () => {
    const sql = readFileSync(
      resolve(__dirname, '../prisma/migrations/20261026090000_p1_categorization_rule_tax/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('"taxEnabled" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('"taxProvince" TEXT');
    expect(sql).toContain('"taxInclusive" BOOLEAN NOT NULL DEFAULT true');
    expect(sql).toContain('"taxRecoverable" BOOLEAN NOT NULL DEFAULT true');
  });

  it('rule create/patch schemas accept the tax fields', async () => {
    const { taxFieldsSchema } = await import('@/lib/banking/rule-schema');
    const parsed = taxFieldsSchema.parse({ taxEnabled: true, taxProvince: 'ON', taxInclusive: false, taxRecoverable: false });
    expect(parsed).toEqual({ taxEnabled: true, taxProvince: 'ON', taxInclusive: false, taxRecoverable: false });
    expect(() => taxFieldsSchema.parse({ taxProvince: 'XX' })).toThrow();
    const defaults = taxFieldsSchema.parse({});
    expect(defaults.taxEnabled).toBe(false);
    expect(defaults.taxInclusive).toBe(true);
  });
});
