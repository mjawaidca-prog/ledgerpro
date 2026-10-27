import { calculateWorkpaper, workpaperCsv, WorkpaperSource } from '@/lib/tax/workpaper';

/**
 * Phase 1.5 — GL simple-path bridge for Tax Workpapers.
 *
 * Muja fixture (2751623 Alberta Corporation, period Oct 2, 2025–Oct 1, 2026),
 * amounts in minor units (cents):
 *  - simple-path bank postings credited revenue GROSS to income account 4000
 *    ($100,000.00 + $80,174.75 = $180,174.75, GST included),
 *  - the Oct 1, 2026 GST split reclass journal: Dr 4000 $8,579.75 /
 *    Cr 2300 $8,579.75,
 *  - no purchase ITCs (account 2310 movement 0).
 * Expected workpaper: 101 = 17,159,500 ($171,595.00), 103 = 857,975
 * ($8,579.75), 106 = 0, 109 = 857,975 — matching the Phase 1 GST/HST Return
 * report and the workbook net of $152,266.52 at the P&L level.
 */
const mujaSource = (overrides: Partial<WorkpaperSource> = {}): WorkpaperSource => ({
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
const input = { classifications: [], periodEvidence: 'TD statements and GST reclass journal reviewed.', reviewNote: '' };

describe('Phase 1.5 GL simple-path bridge', () => {
  test('Muja fixture reconciles with no blockers and exact CRA lines', () => {
    const w = calculateWorkpaper(mujaSource(), input);
    expect(w.sourceMode).toBe('gl_simple_path');
    expect(w.blockers).toEqual([]);
    expect(w.reconciled).toBe(true);
    expect(w.lines).toMatchObject({
      '101': 17159500, '103': 857975, '104': 0, '105': 857975,
      '106': 0, '107': 0, '108': 0, '109': 857975, '115': 857975,
    });
    expect(w.revenueMinor).toBe(17159500);
    expect(w.netTaxMinor).toBe(857975);
    expect(w.unclassified).toEqual([]);
    expect(w.simplePath).toMatchObject({ ledgerLineCount: 4, journalCount: 3 });
    const output = w.balances.find((b) => b.role === 'output');
    expect(output).toMatchObject({ code: '2300', openingMinor: 0, movementMinor: -857975, closingMinor: -857975 });
  });

  test('opening balances carry into the control-account reconciliation', () => {
    const w = calculateWorkpaper(mujaSource({ opening: { '2300': -100000, '2310': 5000 } }), input);
    expect(w.blockers).toEqual([]);
    expect(w.balances.find((b) => b.role === 'output')?.closingMinor).toBe(-957975);
    expect(w.balances.find((b) => b.role === 'recovery')?.closingMinor).toBe(5000);
    // Opening balances never change the period's return lines.
    expect(w.lines['103']).toBe(857975);
  });

  test('purchase ITCs on the recoverable account flow to line 106', () => {
    const source = mujaSource();
    source.ledger.push({ id: 'l5', journalId: 'j4', date: '2026-03-15', code: '2310', role: 'recovery', debitMinor: 12345, creditMinor: 0, postingId: null, description: 'ITC on expenses' });
    const w = calculateWorkpaper(source, input);
    expect(w.blockers).toEqual([]);
    expect(w.lines).toMatchObject({ '106': 12345, '108': 12345, '109': 857975 - 12345 });
  });

  test('a net debit on the output account blocks as a negative return input', () => {
    const source = mujaSource();
    source.ledger.push({ id: 'l6', journalId: 'j5', date: '2026-09-01', code: '2300', role: 'output', debitMinor: 900000, creditMinor: 0, postingId: null, description: 'Unexplained output-account debit' });
    const w = calculateWorkpaper(source, input);
    expect(w.reconciled).toBe(false);
    expect(w.blockers).toContain('Negative return input requires accountant treatment outside the supported ordinary return workflow.');
  });

  test('manual classifications are rejected in GL mode instead of double-counting', () => {
    const w = calculateWorkpaper(mujaSource(), {
      ...input,
      classifications: [{ lineId: 'l4', treatment: 'line103', reason: 'Duplicate attempt', evidence: 'n/a ref' }],
    });
    expect(w.reconciled).toBe(false);
    expect(w.blockers.some((b) => b.includes('Manual classifications are not used in a GL simple-path workpaper'))).toBe(true);
    expect(w.lines['103']).toBe(857975);
  });

  test('the same GL lines WITHOUT the bridge mode still block as unclassified (mode is explicit)', () => {
    const source = mujaSource();
    delete source.sourceMode;
    const w = calculateWorkpaper(source, input);
    expect(w.sourceMode).toBe('reviewed_snapshots');
    expect(w.blockers).toContain('4 manual or legacy ledger line(s) require classification and supporting evidence.');
  });

  test('GL mode is refused for non-GST/HST regimes', () => {
    const source = mujaSource();
    source.registration = { ...source.registration, regime: 'qst', province: 'QC' };
    const w = calculateWorkpaper(source, input);
    expect(w.blockers).toContain('GL simple-path workpapers are supported for GST/HST only.');
  });

  test('CSV labels the GL simple-path mode and never claims reviewed snapshots', () => {
    const csv = workpaperCsv(calculateWorkpaper(mujaSource(), input), 'draft', null);
    expect(csv).toContain('GL simple path');
    expect(csv).toContain('NOT FILED');
  });

  test('reviewed snapshot mode produces the same lines for the same economics (regression)', () => {
    const reviewed = mujaSource({ sourceMode: 'reviewed_snapshots' });
    reviewed.sources = [{
      id: 's1', postingId: 'p1', journalId: 'j1', documentId: 'inv-1', sourceType: 'invoice',
      date: '2026-06-30', direction: 'sale', jurisdiction: 'AB', treatment: 'taxable',
      netMinor: 17159500, homeCurrency: 'CAD', reversalOfId: null,
      components: [{ type: 'gst', treatment: 'taxable', outputMinor: 857975, recoveryMinor: 0, nonrecoverableMinor: 0 }],
    }];
    reviewed.ledger = [
      { id: 'r1', journalId: 'j1', date: '2026-06-30', code: '2300', role: 'output', debitMinor: 0, creditMinor: 857975, postingId: 'p1', description: 'GST on sale' },
    ];
    const w = calculateWorkpaper(reviewed, input);
    expect(w.blockers).toEqual([]);
    expect(w.lines).toMatchObject({ '101': 17159500, '103': 857975, '106': 0, '109': 857975 });
    expect(workpaperCsv(w, 'draft', null)).toContain('Reviewed tax snapshots');
  });
});
