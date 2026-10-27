/**
 * Phase 1 cleanup — QST return (simple path), computed from general-ledger
 * journal lines, mirroring computeGstHstReturn (gst-return.ts).
 *
 * Line structure VERIFIED 2026-10-26 against Revenu Québec primary
 * sources (detailed calculation, Part 1 — the QST column is the GST/HST
 * column + 100):
 *   - Form FP-500-V (2026-09), Detailed GST/HST and QST Calculations:
 *     https://www.revenuquebec.ca/documents/en/formulaires/fp/FP-500-V%282026-09%29DXI.pdf
 *   - Guide FPZ-2034.G-V (2026-09), §2.1 (line 101) and §2.3 (lines
 *     203–213, detailed net QST calculations):
 *     https://www.revenuquebec.ca/documents/en/publications/Guides_HTML/FPZ-2034.G-V%282026-09%29.pdf
 *   - Form FPZ-2034.CD-V (2026-09) corroborates lines 210/212:
 *     https://www.revenuquebec.ca/documents/en/formulaires/fpz/FPZ-2034.CD-V%282026-09%29.pdf
 *
 *   101 Total supplies (sales figure) — SHARED with GST/HST: total value
 *       of supplies, GST/HST and QST excluded (guide §2.1). Revenu Québec
 *       publishes NO separate QST revenue line in the detailed form, so
 *       this return reuses 101 (net credits to income accounts, rounded
 *       to the nearest whole dollar for parity with the GST/HST 101 on
 *       the same combined return). The "line 201 / 202" numbering seen
 *       in secondary blogs was NOT verified on revenuquebec.ca and is
 *       deliberately not used.
 *   203 QST collectible — credits − debits on the QST output (payable)
 *       account. GST/HST (2300) never enters this line.
 *   204 QST adjustments (add) — 0 in the simple path.
 *   205 = 203 + 204 (total QST collectible and adjustments)
 *   206 Input tax refunds (ITRs) — debits − credits on the QST
 *       recoverable account. Netting happens HERE, never in GL postings.
 *   207 ITR adjustments and other adjustments (add) — 0 in simple path.
 *   208 = 206 + 207 (total ITRs and adjustments)
 *   209 Net QST = 205 − 208
 *   210 QST paid in instalments — 0 in the simple path.
 *   211 QST public service bodies' rebate and other QST rebates — 0.
 *   212 = 210 + 211 (total other QST credits)
 *   213 QST payable or refund claimed = 209 − 212. This is a SINGLE
 *       signed line on the Revenu Québec form: positive = amount
 *       payable, negative = refund claimed (Revenu Québec does not
 *       collect a balance due or pay a refund of $2 or less). The
 *       derived `amountPayable` / `refundClaimed` splits below are a
 *       LedgerPro presentation convenience, not Revenu Québec lines.
 *
 * Out of scope (Part 2 of FP-500-V, not computed here): line 214 QST
 * payable on taxable immovables / emission allowances and line 216
 * (= 213 + 214). A company with such acquisitions must report them
 * outside this simple-path working copy.
 *
 * Amounts are major units (dollars), exact to the cent via integer
 * minor arithmetic internally.
 */
import type { GstJournalLine } from './gst-return';

export type QstJournalLine = GstJournalLine;

export interface QstDrillItem {
  lineId: string;
  entryId: string;
  date: string;
  accountCode: string;
  description: string;
  debit: number;
  credit: number;
  /** Signed contribution of this journal line to the Revenu Québec line total. */
  amount: number;
}

export type QstLineKey = '101' | '203' | '204' | '205' | '206' | '207' | '208' | '209' | '210' | '211' | '212' | '213';

export interface QstReturnResult {
  lines: Record<QstLineKey, number>;
  /** Derived from signed line 213 (presentation only — see header). */
  amountPayable: number;
  /** Derived from signed line 213 (presentation only — see header). */
  refundClaimed: number;
  drillDown: Record<string, QstDrillItem[]>;
}

const minor = (n: number): number => Math.round(n * 100);
const major = (n: number): number => n / 100;

export const QST_RETURN_LABELS: Record<string, string> = {
  '101': 'Total supplies (sales figure) — shared with GST/HST',
  '203': 'QST collectible',
  '204': 'QST adjustments (add to net tax)',
  '205': 'Total QST collectible and adjustments',
  '206': 'Input tax refunds (ITRs)',
  '207': 'ITR adjustments and other adjustments (add)',
  '208': 'Total ITRs and adjustments',
  '209': 'Net QST',
  '210': 'QST paid in instalments',
  '211': 'QST rebates (public service bodies’ and other)',
  '212': 'Total other QST credits',
  '213': 'QST payable or refund claimed (signed)',
};

export function computeQstReturn(input: {
  lines: QstJournalLine[];
  outputAccountCode: string;
  recoverableAccountCode: string;
}): QstReturnResult {
  const drillDown: Record<string, QstDrillItem[]> = { '101': [], '203': [], '206': [] };
  const push = (line: string, l: QstJournalLine, amountMinor: number) => {
    if (amountMinor === 0) return;
    drillDown[line].push({
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
  let itrMinorTotal = 0;

  for (const l of input.lines) {
    if (l.accountType === 'income') {
      const c = minor(l.credit) - minor(l.debit);
      revenueMinor += c;
      push('101', l, c);
    }
    if (l.accountCode === input.outputAccountCode) {
      const c = minor(l.credit) - minor(l.debit);
      outputMinorTotal += c;
      push('203', l, c);
    }
    if (l.accountCode === input.recoverableAccountCode) {
      const c = minor(l.debit) - minor(l.credit);
      itrMinorTotal += c;
      push('206', l, c);
    }
  }

  // Line 101 is the shared total-supplies line: same whole-dollar
  // rounding as the GST/HST return so both sides of the combined
  // Revenu Québec return agree on the identical line.
  const line101Minor = Math.sign(revenueMinor) * Math.floor((Math.abs(revenueMinor) + 50) / 100) * 100;
  const netMinor = outputMinorTotal - itrMinorTotal; // 209, and 213 while 210/211 are 0

  const lines: QstReturnResult['lines'] = {
    '101': major(line101Minor),
    '203': major(outputMinorTotal),
    '204': 0,
    '205': major(outputMinorTotal), // 203 + 204
    '206': major(itrMinorTotal),
    '207': 0,
    '208': major(itrMinorTotal), // 206 + 207
    '209': major(netMinor),
    '210': 0,
    '211': 0,
    '212': 0,
    '213': major(netMinor), // 209 − 212
  };

  return {
    lines,
    amountPayable: major(Math.max(0, netMinor)),
    refundClaimed: major(Math.max(0, -netMinor)),
    drillDown,
  };
}

/** Working-copy CSV for the return (drill-down appended). Labelled by the caller with filing status. */
export function qstReturnCsv(input: {
  companyName: string;
  periodStart: string;
  periodEnd: string;
  filedLabel: string;
  result: QstReturnResult;
}): string {
  const cell = (v: unknown): string => {
    let s = String(v ?? '');
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const rows: unknown[][] = [
    ['LedgerPro QST return — working copy (Revenu Québec FP-500-V detailed lines)', input.filedLabel],
    ['Company', input.companyName],
    ['Period', input.periodStart, input.periodEnd],
    ['Amounts', 'CAD'],
    [],
    ['Revenu Québec line', 'Label', 'Amount'],
  ];
  for (const [line, amount] of Object.entries(input.result.lines)) {
    rows.push([line, QST_RETURN_LABELS[line] ?? '', amount.toFixed(2)]);
  }
  rows.push(['(derived)', 'Amount payable (line 213 if positive)', input.result.amountPayable.toFixed(2)]);
  rows.push(['(derived)', 'Refund claimed (line 213 if negative)', input.result.refundClaimed.toFixed(2)]);
  rows.push([], ['Drill-down', 'Journal line', 'Journal entry', 'Date', 'Account', 'Description', 'Debit', 'Credit', 'Contribution']);
  for (const [line, items] of Object.entries(input.result.drillDown)) {
    for (const d of items) {
      rows.push([line, d.lineId, d.entryId, d.date, d.accountCode, d.description, d.debit.toFixed(2), d.credit.toFixed(2), d.amount.toFixed(2)]);
    }
  }
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
