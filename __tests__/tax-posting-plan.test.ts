import { buildTaxPostingPlan, reverseTaxPostingPlan, PostingComponentDecision } from '@/lib/tax/posting-plan';

const component = (
  kind: PostingComponentDecision['kind'],
  rateMilliPercent: number,
  overrides: Partial<PostingComponentDecision> = {},
): PostingComponentDecision => ({
  kind,
  treatment: rateMilliPercent === 0 ? 'zero_rated' : 'taxable',
  rateMilliPercent,
  recoveryBasisPoints: 0,
  authority: kind === 'QST' ? 'revenu_quebec' : kind === 'PST' ? 'british_columbia' : 'cra',
  ...overrides,
});

const base = {
  documentCurrency: 'CAD',
  homeCurrency: 'CAD',
  mappings: {
    control: '1100',
    gstHstOutput: '2300',
    gstHstRecoverable: '1300',
    qstOutput: '2310',
    qstRecoverable: '1310',
    pstRstPayable: '2320',
  },
  lines: [{
    sourceLineId: 'line-1',
    taxCodeVersionId: 'version-1',
    categoryAccountCode: '4000',
    amountMinor: 10_000,
    priceMode: 'exclusive' as const,
    components: [component('HST', 13_000)],
  }],
};

const totals = (lines: ReturnType<typeof buildTaxPostingPlan>['journalLines']) => ({
  debit: lines.reduce((sum, line) => sum + line.debitMinor, 0),
  credit: lines.reduce((sum, line) => sum + line.creditMinor, 0),
});

describe('P1-C tax posting plan', () => {
  test('posts an Ontario sale to AR, revenue, and the mapped HST output account', () => {
    const plan = buildTaxPostingPlan({ ...base, direction: 'sale' });
    expect(plan).toMatchObject({ netMinor: 10_000, taxMinor: 1_300, grossMinor: 11_300 });
    expect(plan.journalLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ glAccountCode: '1100', debitMinor: 11_300, creditMinor: 0 }),
      expect.objectContaining({ glAccountCode: '4000', debitMinor: 0, creditMinor: 10_000 }),
      expect.objectContaining({ glAccountCode: '2300', debitMinor: 0, creditMinor: 1_300 }),
    ]));
    expect(totals(plan.journalLines)).toEqual({ debit: 11_300, credit: 11_300 });
  });

  test('posts recoverable GST separately while capitalizing nonrecoverable BC PST', () => {
    const plan = buildTaxPostingPlan({
      ...base,
      direction: 'purchase',
      mappings: { ...base.mappings, control: '2200' },
      lines: [{
        ...base.lines[0],
        categoryAccountCode: '5000',
        components: [
          component('GST', 5_000, { recoveryBasisPoints: 10_000, recoveryReason: 'Commercial activity' }),
          component('PST', 7_000),
        ],
      }],
    });
    expect(plan.snapshots[0].components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'GST', recoverableMinor: 500, nonRecoverableMinor: 0 }),
      expect.objectContaining({ kind: 'PST', recoverableMinor: 0, nonRecoverableMinor: 700 }),
    ]));
    expect(plan.journalLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ glAccountCode: '5000', debitMinor: 10_700 }),
      expect.objectContaining({ glAccountCode: '1300', debitMinor: 500 }),
      expect.objectContaining({ glAccountCode: '2200', creditMinor: 11_200 }),
    ]));
    expect(totals(plan.journalLines)).toEqual({ debit: 11_200, credit: 11_200 });
  });

  test('freezes component-level Quebec treatment without compounding', () => {
    const plan = buildTaxPostingPlan({
      ...base,
      direction: 'sale',
      lines: [{ ...base.lines[0], components: [component('GST', 5_000), component('QST', 9_975)] }],
    });
    expect(plan.taxMinor).toBe(1_498);
    expect(plan.snapshots[0].components.map(row => [row.kind, row.taxMinor])).toEqual([
      ['GST', 500], ['QST', 998],
    ]);
  });

  test('uses exact frozen FX conversion and balances home and foreign columns', () => {
    const plan = buildTaxPostingPlan({
      ...base,
      direction: 'sale',
      documentCurrency: 'USD',
      homeCurrency: 'CAD',
      fxRate: '1.36000000',
    });
    expect(plan).toMatchObject({ grossMinor: 11_300, grossHomeMinor: 15_368 });
    expect(totals(plan.journalLines)).toEqual({ debit: 15_368, credit: 15_368 });
    expect(plan.journalLines.find(line => line.glAccountCode === '1100')).toMatchObject({
      debitMinor: 15_368,
      debitForeignMinor: 11_300,
      currency: 'USD',
      fxRate: '1.36000000',
    });
  });

  test('credit reversal is the exact opposite of frozen snapshots and journal lines', () => {
    const original = buildTaxPostingPlan({ ...base, direction: 'sale' });
    const credit = reverseTaxPostingPlan(original);
    expect(credit.taxMinor).toBe(-original.taxMinor);
    expect(credit.snapshots[0].components[0].taxHomeMinor).toBe(-original.snapshots[0].components[0].taxHomeMinor);
    expect(credit.journalLines).toEqual(original.journalLines.map(line => expect.objectContaining({
      glAccountCode: line.glAccountCode,
      debitMinor: line.creditMinor,
      creditMinor: line.debitMinor,
    })));
    expect(totals(credit.journalLines)).toEqual({ debit: 11_300, credit: 11_300 });
  });

  test('rejects missing mappings and unfrozen FX rates before a journal can be built', () => {
    expect(() => buildTaxPostingPlan({
      ...base,
      direction: 'sale',
      mappings: { control: '1100' },
    })).toThrow('No output GL account');
    expect(() => buildTaxPostingPlan({
      ...base,
      direction: 'sale',
      documentCurrency: 'USD',
      homeCurrency: 'CAD',
    })).toThrow('frozen FX rate');
  });

  test('preserves GST-taxable/PST-exempt decisions independently', () => {
    const plan = buildTaxPostingPlan({
      ...base,
      direction: 'sale',
      lines: [{
        ...base.lines[0],
        components: [component('GST', 5_000), component('PST', 0, { treatment: 'exempt' })],
      }],
    });
    expect(plan.snapshots[0].components.map(row => row.treatment)).toEqual(['taxable', 'exempt']);
    expect(plan.taxMinor).toBe(500);
  });
});
