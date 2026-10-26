/**
 * Phase 1 — GST/HST return (simple path), computed from general-ledger
 * journal lines. Definitions mirror the CRA GST34 working copy and the
 * existing reviewed workpaper (src/lib/tax/workpaper.ts) so the two paths
 * agree on the same books:
 *
 *   101 Sales and other revenue — net credits to income accounts,
 *       rounded to the nearest whole dollar (as in the workpaper).
 *   103 GST/HST collected or collectible — credits − debits on the
 *       GST/HST output (payable) account. PST/RST lives in its own
 *       payable account and QST in its own accounts: neither enters 103.
 *   104 Adjustments (add) — 0 in the simple path (manual adjustments are
 *       classified in Tax Workpapers).
 *   105 = 103 + 104
 *   106 Input tax credits — debits − credits on the GST/HST recoverable
 *       (ITC) account. Netting happens HERE, in the return — postings
 *       never net ITCs against the payable in the GL.
 *   107 Adjustments (deduct) — 0 in the simple path.
 *   108 = 106 + 107;  109 Net tax = 105 − 108.
 *   110 Instalments / 111 Rebates — 0 in the simple path (recorded via
 *       Tax Workpapers); 112 = 110 + 111; balance 113C = 109 − 112;
 *       114 refund = max(0, −113C); 115 payment = max(0, 113C).
 *
 * Line definitions verified against CRA Info Sheet GI-066 (Canada.ca,
 * October 2026) and GI-064 — see phase1-gst-design.md §0.
 * Amounts are major units (dollars), exact to the cent via integer minor
 * arithmetic internally.
 */

export interface GstJournalLine {
  id: string;
  entryId: string;
  date: string; // YYYY-MM-DD
  accountCode: string;
  accountType: string; // 'income' | 'asset' | 'liability' | ...
  description: string;
  debit: number;
  credit: number;
}

export interface GstDrillItem {
  lineId: string;
  entryId: string;
  date: string;
  accountCode: string;
  description: string;
  debit: number;
  credit: number;
  /** Signed contribution of this journal line to the CRA line total. */
  amount: number;
}

export interface GstReturnResult {
  lines: Record<'101' | '103' | '104' | '105' | '106' | '107' | '108' | '109' | '110' | '111' | '112' | '114' | '115', number>;
  drillDown: Record<string, GstDrillItem[]>;
}

const minor = (n: number): number => Math.round(n * 100);
const major = (n: number): number => n / 100;
const sumMinor = (values: number[]): number => values.reduce((s, v) => s + minor(v), 0);

export const GST_RETURN_LABELS: Record<string, string> = {
  '101': 'Sales and other revenue',
  '103': 'GST/HST collected or collectible',
  '104': 'Adjustments (add to net tax)',
  '105': 'Total GST/HST and adjustments',
  '106': 'Input tax credits (ITCs)',
  '107': 'Adjustments (deduct from net tax)',
  '108': 'Total ITCs and adjustments',
  '109': 'Net tax',
  '110': 'Instalments and other payments',
  '111': 'Rebates',
  '112': 'Total other credits',
  '114': 'Refund claimed',
  '115': 'Payment enclosed / amount owing',
};

export function computeGstHstReturn(input: {
  lines: GstJournalLine[];
  outputAccountCode: string;
  recoverableAccountCode: string;
}): GstReturnResult {
  const drillDown: Record<string, GstDrillItem[]> = { '101': [], '103': [], '106': [] };
  const push = (craLine: string, l: GstJournalLine, amountMinor: number) => {
    if (amountMinor === 0) return;
    drillDown[craLine].push({
      lineId: l.id,
      entryId: l.entryId,
      date: l.date,
      accountCode: l.accountCode,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
      amount: major(amountMinor),
    });
  };

  let revenueMinor = 0;
  let outputMinorTotal = 0;
  let itcMinorTotal = 0;

  for (const l of input.lines) {
    if (l.accountType === 'income') {
      const c = minor(l.credit) - minor(l.debit);
      revenueMinor += c;
      push('101', l, c);
    }
    if (l.accountCode === input.outputAccountCode) {
      const c = minor(l.credit) - minor(l.debit);
      outputMinorTotal += c;
      push('103', l, c);
    }
    if (l.accountCode === input.recoverableAccountCode) {
      const c = minor(l.debit) - minor(l.credit);
      itcMinorTotal += c;
      push('106', l, c);
    }
  }

  // CRA: line 101 is reported to the nearest whole dollar (workpaper parity).
  const line101Minor = Math.sign(revenueMinor) * Math.floor((Math.abs(revenueMinor) + 50) / 100) * 100;

  const lines: GstReturnResult['lines'] = {
    '101': major(line101Minor),
    '103': major(outputMinorTotal),
    '104': 0,
    '105': major(outputMinorTotal), // 103 + 104
    '106': major(itcMinorTotal),
    '107': 0,
    '108': major(itcMinorTotal), // 106 + 107
    '109': major(outputMinorTotal - itcMinorTotal),
    '110': 0,
    '111': 0,
    '112': 0,
    '114': major(Math.max(0, -(outputMinorTotal - itcMinorTotal))),
    '115': major(Math.max(0, outputMinorTotal - itcMinorTotal)),
  };

  return { lines, drillDown };
}

/** Working-copy CSV for the return (drill-down appended). Labelled by the caller with filing status. */
export function gstReturnCsv(input: {
  companyName: string;
  periodStart: string;
  periodEnd: string;
  filedLabel: string;
  result: GstReturnResult;
}): string {
  const cell = (v: unknown): string => {
    let s = String(v ?? '');
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const rows: unknown[][] = [
    ['LedgerPro GST/HST return — working copy', input.filedLabel],
    ['Company', input.companyName],
    ['Period', input.periodStart, input.periodEnd],
    ['Amounts', 'CAD'],
    [],
    ['CRA line', 'Label', 'Amount'],
  ];
  for (const [line, amount] of Object.entries(input.result.lines)) {
    rows.push([line, GST_RETURN_LABELS[line] ?? '', amount.toFixed(2)]);
  }
  rows.push([], ['Drill-down', 'Journal line', 'Journal entry', 'Date', 'Account', 'Description', 'Debit', 'Credit', 'Contribution']);
  for (const [craLine, items] of Object.entries(input.result.drillDown)) {
    for (const d of items) {
      rows.push([craLine, d.lineId, d.entryId, d.date, d.accountCode, d.description, d.debit.toFixed(2), d.credit.toFixed(2), d.amount.toFixed(2)]);
    }
  }
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
