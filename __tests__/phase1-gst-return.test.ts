/**
 * Phase 1 — GST/HST return (simple path) computation.
 * The acceptance fixture: Muja's Year-1 revenue posted through the
 * branch-1 AB GST-inclusive path must produce CRA lines
 *   101 = $171,595.00 · 103 = $8,579.75 · 106 = $0 · 109 = $8,579.75
 */
import { computeGstHstReturn, gstReturnCsv, type GstJournalLine } from '@/lib/tax/gst-return';
import { computeSplitTaxes, buildPostingLines } from '@/lib/banking/splits';
import { resolveSimpleTaxAccounts } from '@/lib/tax/simple';

const accounts = resolveSimpleTaxAccounts({});
let seq = 0;
const jl = (accountCode: string, accountType: string, debit: number, credit: number, description = ''): GstJournalLine => ({
  id: `l${++seq}`,
  entryId: `e${seq}`,
  date: '2026-03-15',
  accountCode,
  accountType,
  description,
  debit,
  credit,
});

/** Post Muja-shaped revenue through the real branch-1 path and shape the
 *  resulting posting lines as journal lines for the return computation. */
function mujaRevenueJournalLines(): GstJournalLine[] {
  const splits = [{ categoryCode: '4000', amount: 180174.75, taxProvince: 'AB', taxInclusive: true, taxRecoverable: true }];
  const computed = computeSplitTaxes(splits, 'in');
  const postings = buildPostingLines({
    splits: computed.map((c) => ({ categoryCode: c.categoryCode, net: c.net, taxAmount: c.taxAmount, taxCode: c.taxCode, tax: c.tax })),
    direction: 'in',
    bankAccountCode: '1010',
    total: 180174.75,
    description: 'TEKsystems contract revenue',
    taxAccounts: accounts,
  });
  const types: Record<string, string> = { '4000': 'income', '2300': 'liability', '1010': 'asset' };
  return postings.map((p) => jl(p.glAccountCode, types[p.glAccountCode] ?? '', p.debit, p.credit, p.description));
}

describe('GST/HST return — Muja acceptance fixture', () => {
  const result = computeGstHstReturn({ lines: mujaRevenueJournalLines(), outputAccountCode: '2300', recoverableAccountCode: '2310' });

  it('line 101 = net revenue $171,595.00', () => {
    expect(result.lines['101']).toBe(171595.0);
  });
  it('line 103 = GST collected $8,579.75', () => {
    expect(result.lines['103']).toBe(8579.75);
  });
  it('line 105 = 103 + 104', () => {
    expect(result.lines['105']).toBe(8579.75);
  });
  it('line 106 = $0 (no purchases)', () => {
    expect(result.lines['106']).toBe(0);
    expect(result.lines['108']).toBe(0);
  });
  it('line 109 net tax = $8,579.75, all owing on 115', () => {
    expect(result.lines['109']).toBe(8579.75);
    expect(result.lines['115']).toBe(8579.75);
    expect(result.lines['114']).toBe(0);
  });
  it('drill-down shows the revenue and GST journal lines', () => {
    expect(result.drillDown['101']).toHaveLength(1);
    expect(result.drillDown['101'][0].amount).toBe(171595.0);
    expect(result.drillDown['103']).toHaveLength(1);
    expect(result.drillDown['103'][0].accountCode).toBe('2300');
  });
});

describe('GST/HST return — ITC netting happens in the return, not the GL', () => {
  it('purchase GST in the ITC account reduces net tax; the payable is untouched', () => {
    const lines = [
      ...mujaRevenueJournalLines(),
      jl('6300', 'expense', 100, 0, 'Office supplies net'),
      jl('2310', 'asset', 5, 0, 'GST ITC on supplies'),
    ];
    const result = computeGstHstReturn({ lines, outputAccountCode: '2300', recoverableAccountCode: '2310' });
    expect(result.lines['103']).toBe(8579.75); // collected unchanged
    expect(result.lines['106']).toBe(5);
    expect(result.lines['109']).toBe(8574.75);
    expect(result.drillDown['106']).toHaveLength(1);
  });

  it('PST in its own payable account never enters line 103/106/109', () => {
    const lines = [
      jl('4000', 'income', 0, 100, 'BC sale net'),
      jl('2300', 'liability', 0, 5, 'GST collected'),
      jl('2330', 'liability', 0, 7, 'BC PST collected'),
    ];
    const result = computeGstHstReturn({ lines, outputAccountCode: '2300', recoverableAccountCode: '2310' });
    expect(result.lines['101']).toBe(100);
    expect(result.lines['103']).toBe(5);
    expect(result.lines['109']).toBe(5);
  });

  it('refund position: ITCs exceed collections → 114 refund, 115 zero', () => {
    const lines = [
      jl('4000', 'income', 0, 1000, 'Revenue'),
      jl('2300', 'liability', 0, 50, 'GST collected'),
      jl('2310', 'asset', 300, 0, 'ITCs on equipment'),
    ];
    const result = computeGstHstReturn({ lines, outputAccountCode: '2300', recoverableAccountCode: '2310' });
    expect(result.lines['109']).toBe(-250);
    expect(result.lines['114']).toBe(250);
    expect(result.lines['115']).toBe(0);
  });

  it('reversals net correctly (credit notes reduce 101 and 103)', () => {
    const lines = [
      jl('4000', 'income', 0, 1000, 'Sale'),
      jl('2300', 'liability', 0, 50, 'GST'),
      jl('4000', 'income', 200, 0, 'Credit note'),
      jl('2300', 'liability', 10, 0, 'GST on credit note'),
    ];
    const result = computeGstHstReturn({ lines, outputAccountCode: '2300', recoverableAccountCode: '2310' });
    expect(result.lines['101']).toBe(800);
    expect(result.lines['103']).toBe(40);
  });

  it('line 101 rounds to the nearest whole dollar; 103 keeps cents', () => {
    const lines = [
      jl('4000', 'income', 0, 100.49, 'A'),
      jl('4000', 'income', 0, 0.4, 'B'),
      jl('2300', 'liability', 0, 5.04, 'GST'),
    ];
    const result = computeGstHstReturn({ lines, outputAccountCode: '2300', recoverableAccountCode: '2310' });
    expect(result.lines['101']).toBe(101); // 100.89 → 101
    expect(result.lines['103']).toBe(5.04);
  });

  it('configured (non-default) tax account codes are honoured', () => {
    const lines = [
      jl('4000', 'income', 0, 200, 'Sale'),
      jl('2410', 'liability', 0, 10, 'GST to custom payable'),
      jl('1210', 'asset', 3, 0, 'ITC in custom receivable'),
    ];
    const result = computeGstHstReturn({ lines, outputAccountCode: '2410', recoverableAccountCode: '1210' });
    expect(result.lines['103']).toBe(10);
    expect(result.lines['106']).toBe(3);
    expect(result.lines['109']).toBe(7);
  });
});

describe('GST/HST return CSV working copy', () => {
  it('is labelled NOT FILED until filing is recorded, and carries the lines', () => {
    const result = computeGstHstReturn({ lines: mujaRevenueJournalLines(), outputAccountCode: '2300', recoverableAccountCode: '2310' });
    const csv = gstReturnCsv({ companyName: '2751623 Alberta Corporation', periodStart: '2025-10-02', periodEnd: '2026-10-01', filedLabel: 'NOT FILED — working copy', result });
    expect(csv).toContain('NOT FILED');
    expect(csv).toContain('171595.00');
    expect(csv).toContain('8579.75');
    const filed = gstReturnCsv({ companyName: 'X', periodStart: '2026-01-01', periodEnd: '2026-03-31', filedLabel: 'FILED — recorded 2026-04-30', result });
    expect(filed).toContain('FILED — recorded');
  });
});
