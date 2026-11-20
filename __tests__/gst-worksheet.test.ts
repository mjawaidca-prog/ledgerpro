/**
 * Phase 1 item 6 — GST/HST worksheet: full line composition,
 * reconciliation checks, NETFILE hand-off, and the gst-worksheet/1
 * audit-trail package. The worksheet layer never recomputes a CRA
 * line — fixtures run the real engine (computeGstHstReturn) and the
 * worksheet is built over its result.
 */
import { computeGstHstReturn, type GstJournalLine } from '@/lib/tax/gst-return';
import {
  buildGstWorksheet, buildGstWorksheetPayload,
  GST_WORKSHEET_LINE_ORDER, type BuildGstWorksheetInput,
} from '@/lib/tax/gst-worksheet';

let seq = 0;
const jl = (accountCode: string, accountType: string, debit: number, credit: number, description = ''): GstJournalLine => ({
  id: `l${++seq}`,
  entryId: `e${seq}`,
  date: '2026-02-15',
  accountCode,
  accountType,
  description,
  debit,
  credit,
});

/**
 * Quarter fixture: revenue $12,500.50 exact (line 101 rounds to
 * $12,501), GST collected $625, ITCs $100 net, a $25 line-104
 * adjustment and a $100 instalment → net tax $550, balance $450 owing.
 */
function quarterResult() {
  const lines = [
    jl('4000', 'income', 0, 10000, 'Contract revenue'),
    jl('4010', 'income', 0, 2500.50, 'Other revenue'),
    jl('2300', 'liability', 0, 625, 'GST collected'),
    jl('2310', 'asset', 130, 0, 'ITC on purchases'),
    jl('2310', 'asset', 0, 30, 'ITC reversal'),
  ];
  return computeGstHstReturn({
    lines,
    outputAccountCode: '2300',
    recoverableAccountCode: '2310',
    adjustments: {
      add: [{ amount: 25, note: 'Bad-debt recovery' }],
      instalments: [{ amount: 100, note: 'Q1 instalment' }],
    },
  });
}

function worksheetInput(overrides: Partial<BuildGstWorksheetInput> = {}): BuildGstWorksheetInput {
  return {
    result: quarterResult(),
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    registration: { registrationNumber: '123456789RT0001', filingFrequency: 'quarterly', province: 'AB' },
    filed: null,
    accountNames: { '4000': 'Sales', '4010': 'Other revenue', '2300': 'GST/HST payable', '2310': 'GST/HST recoverable' },
    control: {
      output: { accountCode: '2300', opening: 200, closingPerGl: 825 },
      recoverable: { accountCode: '2310', opening: 40, closingPerGl: 140 },
    },
    engineDetail: { outputTax: 625, recoverableTax: 100, snapshotCount: 4 },
    ...overrides,
  };
}

describe('worksheet — full line set, nil lines shown', () => {
  const ws = buildGstWorksheet(worksheetInput());

  it('presents all 14 GST34 lines in order (113 Balance surfaced, 102 does not exist)', () => {
    expect(ws.lines.map((l) => l.line)).toEqual([...GST_WORKSHEET_LINE_ORDER]);
    expect(ws.lines).toHaveLength(14);
  });

  it('amounts come from the engine, with 113 = 109 − 112 derived', () => {
    const byLine = Object.fromEntries(ws.lines.map((l) => [l.line, l.amount]));
    expect(byLine['101']).toBe(12501);
    expect(byLine['105']).toBe(650);
    expect(byLine['109']).toBe(550);
    expect(byLine['112']).toBe(100);
    expect(byLine['113']).toBe(450);
    expect(byLine['115']).toBe(450);
  });

  it('nil lines are present and flagged nil, never hidden', () => {
    const l114 = ws.lines.find((l) => l.line === '114')!;
    expect(l114.amount).toBe(0);
    expect(l114.nil).toBe(true);
    const l107 = ws.lines.find((l) => l.line === '107')!;
    expect(l107.nil).toBe(true);
  });
});

describe('worksheet — per-line composition', () => {
  const ws = buildGstWorksheet(worksheetInput());

  it('GL line 101 rolls up by account and keeps the transactions', () => {
    const l101 = ws.lines.find((l) => l.line === '101')!;
    expect(l101.kind).toBe('gl');
    expect(l101.composition.accounts).toEqual([
      { accountCode: '4000', accountName: 'Sales', amount: 10000, transactionCount: 1 },
      { accountCode: '4010', accountName: 'Other revenue', amount: 2500.50, transactionCount: 1 },
    ]);
    expect(l101.composition.transactions).toHaveLength(2);
    const rollupTotal = l101.composition.accounts.reduce((s, a) => s + a.amount, 0);
    expect(rollupTotal).toBe(12500.50); // exact revenue, before CRA rounding of the line itself
  });

  it('GL line 106 composition nets the ITC account lines', () => {
    const l106 = ws.lines.find((l) => l.line === '106')!;
    expect(l106.composition.accounts).toEqual([
      { accountCode: '2310', accountName: 'GST/HST recoverable', amount: 100, transactionCount: 2 },
    ]);
  });

  it('adjustment lines carry their itemized adjustments', () => {
    const l104 = ws.lines.find((l) => l.line === '104')!;
    expect(l104.kind).toBe('adjustments');
    expect(l104.composition.adjustmentItems).toEqual([{ amount: 25, note: 'Bad-debt recovery' }]);
    const l110 = ws.lines.find((l) => l.line === '110')!;
    expect(l110.composition.adjustmentItems).toEqual([{ amount: 100, note: 'Q1 instalment' }]);
  });

  it('calculated lines carry their formula in terms of other lines', () => {
    const l105 = ws.lines.find((l) => l.line === '105')!;
    expect(l105.kind).toBe('calculated');
    expect(l105.composition.formula?.terms).toEqual([
      { line: '103', sign: 1 }, { line: '104', sign: 1 },
    ]);
    const l109 = ws.lines.find((l) => l.line === '109')!;
    expect(l109.composition.formula?.terms).toEqual([
      { line: '105', sign: 1 }, { line: '108', sign: -1 },
    ]);
    const l113 = ws.lines.find((l) => l.line === '113')!;
    expect(l113.composition.formula?.terms).toEqual([
      { line: '109', sign: 1 }, { line: '112', sign: -1 },
    ]);
  });
});

describe('worksheet — reconciliation checks', () => {
  it('all checks pass on a clean quarter', () => {
    const ws = buildGstWorksheet(worksheetInput());
    const byId = Object.fromEntries(ws.reconciliations.map((r) => [r.id, r]));
    expect(byId['revenue-tie-out'].status).toBe('pass');
    expect(byId['revenue-tie-out'].difference).toBe(0.5); // whole-dollar rounding only
    expect(byId['continuity-output'].status).toBe('pass');
    expect(byId['continuity-recoverable'].status).toBe('pass');
    expect(byId['output-vs-tax-engine'].status).toBe('pass');
    expect(byId['itc-vs-tax-engine'].status).toBe('pass');
    expect(byId['return-arithmetic'].status).toBe('pass');
  });

  it('continuity: opening + movement = closing for both control accounts', () => {
    const ws = buildGstWorksheet(worksheetInput());
    const [output, recoverable] = ws.continuity;
    expect(output).toMatchObject({ opening: 200, movement: 625, expectedClosing: 825, closingPerGl: 825, difference: 0, tiesOut: true });
    expect(recoverable).toMatchObject({ opening: 40, movement: 100, expectedClosing: 140, closingPerGl: 140, difference: 0, tiesOut: true });
  });

  it('continuity difference is flagged as a failure, not absorbed', () => {
    const ws = buildGstWorksheet(worksheetInput({
      control: {
        output: { accountCode: '2300', opening: 200, closingPerGl: 900 }, // $75 unexplained
        recoverable: { accountCode: '2310', opening: 40, closingPerGl: 140 },
      },
    }));
    const check = ws.reconciliations.find((r) => r.id === 'continuity-output')!;
    expect(check.status).toBe('fail');
    expect(check.difference).toBe(75);
    expect(ws.continuity[0].tiesOut).toBe(false);
  });

  it('revenue difference beyond rounding fails the tie-out', () => {
    const result = quarterResult();
    const tampered = { ...result, lines: { ...result.lines, '101': 12000 } };
    const ws = buildGstWorksheet(worksheetInput({ result: tampered }));
    const check = ws.reconciliations.find((r) => r.id === 'revenue-tie-out')!;
    expect(check.status).toBe('fail');
    expect(check.difference).toBe(-500.50);
  });

  it('no tax-engine detail → corroboration warns instead of pretending to tie', () => {
    const ws = buildGstWorksheet(worksheetInput({ engineDetail: null }));
    for (const id of ['output-vs-tax-engine', 'itc-vs-tax-engine']) {
      const check = ws.reconciliations.find((r) => r.id === id)!;
      expect(check.status).toBe('warn');
      expect(check.difference).toBeNull();
    }
  });

  it('tax-engine difference warns with the difference shown', () => {
    const ws = buildGstWorksheet(worksheetInput({
      engineDetail: { outputTax: 600, recoverableTax: 90, snapshotCount: 4 },
    }));
    const output = ws.reconciliations.find((r) => r.id === 'output-vs-tax-engine')!;
    expect(output.status).toBe('warn');
    expect(output.difference).toBe(25);
    const itc = ws.reconciliations.find((r) => r.id === 'itc-vs-tax-engine')!;
    expect(itc.status).toBe('warn');
    expect(itc.difference).toBe(10);
  });
});

describe('worksheet — NETFILE hand-off', () => {
  it('payment case: keyed numbers are 101, 109 and 115, plus the access-code slot', () => {
    const ws = buildGstWorksheet(worksheetInput());
    expect(ws.netfile.accessCodeRequired).toBe(true);
    expect(ws.netfile.registrationNumber).toBe('123456789RT0001');
    expect(ws.netfile.keyedNumbers).toEqual([
      { line: '101', label: 'Sales and other revenue', amount: 12501 },
      { line: '109', label: 'Net tax', amount: 550 },
      { line: '115', label: 'Payment enclosed / amount owing', amount: 450 },
    ]);
    expect(ws.netfile.outcome).toBe('payment');
    expect(ws.netfile.filing).toEqual({ filed: false, confirmation: null, filedAt: null });
  });

  it('refund case: the third keyed number is line 114, and the filing record rides along', () => {
    const lines = [
      jl('4000', 'income', 0, 1000, 'Revenue'),
      jl('2300', 'liability', 0, 50, 'GST collected'),
      jl('2310', 'asset', 300, 0, 'ITCs on equipment'),
    ];
    const result = computeGstHstReturn({ lines, outputAccountCode: '2300', recoverableAccountCode: '2310' });
    const ws = buildGstWorksheet(worksheetInput({
      result,
      filed: { filedAt: '2026-04-15T12:00:00.000Z', filingConfirmation: 'NF-987654' },
      control: {
        output: { accountCode: '2300', opening: 0, closingPerGl: 50 },
        recoverable: { accountCode: '2310', opening: 0, closingPerGl: 300 },
      },
      engineDetail: null,
    }));
    expect(ws.netfile.outcome).toBe('refund');
    expect(ws.netfile.keyedNumbers.map((k) => k.line)).toEqual(['101', '109', '114']);
    expect(ws.netfile.keyedNumbers[2].amount).toBe(250);
    expect(ws.netfile.filing).toEqual({ filed: true, confirmation: 'NF-987654', filedAt: '2026-04-15T12:00:00.000Z' });
  });
});

describe('gst-worksheet/1 package', () => {
  const buildPayload = (ws = buildGstWorksheet(worksheetInput())) => buildGstWorksheetPayload({
    companyId: 'co-1',
    companyName: 'Acme Consulting Inc.',
    gstNumber: '123456789RT0001',
    registration: { registrationNumber: '123456789RT0001', filingFrequency: 'quarterly', province: 'AB' },
    worksheet: ws,
    generatedAt: '2026-04-01T00:00:00.000Z',
  });

  it('carries the contract fields with decimal-string money', () => {
    const { payload, lineCount } = buildPayload();
    expect(payload.contractVersion).toBe('gst-worksheet/1');
    expect(payload.companyId).toBe('co-1');
    expect(payload.periodStart).toBe('2026-01-01');
    expect(payload.periodEnd).toBe('2026-03-31');
    expect(lineCount).toBe(14);
    const lines = payload.lines as { line: string; amount: string }[];
    expect(lines.find((l) => l.line === '101')!.amount).toBe('12501.00');
    expect(lines.find((l) => l.line === '109')!.amount).toBe('550.00');
    expect(lines.find((l) => l.line === '113')!.amount).toBe('450.00');
    expect(payload.filing).toEqual({ status: 'not_filed', confirmation: null, filedAt: null });
    const netfile = payload.netfile as { keyedNumbers: { line: string; amount: string }[] };
    expect(netfile.keyedNumbers.map((k) => k.line)).toEqual(['101', '109', '115']);
  });

  it('hash is stable for identical input and changes when a figure changes', () => {
    const ws = buildGstWorksheet(worksheetInput());
    const a = buildPayload(ws).payload;
    const b = buildPayload(ws).payload;
    expect(a.hash).toBe(b.hash);
    expect(typeof a.hash).toBe('string');
    expect((a.hash as string).length).toBe(64);

    const changed = buildGstWorksheet(worksheetInput({
      control: {
        output: { accountCode: '2300', opening: 201, closingPerGl: 826 },
        recoverable: { accountCode: '2310', opening: 40, closingPerGl: 140 },
      },
    }));
    expect(buildPayload(changed).payload.hash).not.toBe(a.hash);
  });

  it('records the filing (confirmation + date) once the period is filed', () => {
    const ws = buildGstWorksheet(worksheetInput({
      filed: { filedAt: '2026-04-20T00:00:00.000Z', filingConfirmation: 'NF-123456' },
    }));
    const { payload } = buildPayload(ws);
    expect(payload.filing).toEqual({ status: 'filed_recorded', confirmation: 'NF-123456', filedAt: '2026-04-20T00:00:00.000Z' });
  });
});
