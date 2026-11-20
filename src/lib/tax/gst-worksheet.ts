/**
 * GST/HST worksheet — the working paper behind the GST34 return
 * (improvement plan, Phase 1 item 6; design: improvement-plan
 * DESIGN-TAX-DOMAIN.md §5.2/§5.3 — "the worksheet is the product").
 *
 * This module is a PRESENTATION + RECONCILIATION layer over the simple
 * path engine (src/lib/tax/gst-return.ts). It never recomputes a CRA
 * line: every amount comes from the engine's GstReturnResult. What it
 * adds:
 *
 *  1. The full worksheet — every GST34 line 101–115 (102 does not exist
 *     on the GST34; 113 Balance, which the engine carries internally as
 *     113C, is surfaced as a line). Nil lines are present, never hidden.
 *     Each line carries its composition: the GL accounts and journal
 *     transactions behind it (GL lines), the itemized adjustments
 *     (104/107/110/111), or its formula in terms of other lines
 *     (calculated lines).
 *  2. Reconciliation checks — the differences CRA auditors ask about
 *     first (design §5.2): line 101 vs the GL revenue accounts, the two
 *     control accounts' continuity period over period, and the return
 *     vs the tax engine's document-level tax detail. Differences are
 *     reported with figures, never silently absorbed.
 *  3. The NETFILE hand-off: CRA's GST/HST NETFILE is a 4-number return
 *     (design §5.3) — the filer's access code plus lines 101, 109 and
 *     114/115 keyed on CRA's site. `netfile` names exactly those.
 *  4. `gst-worksheet/1` — the audit-trail package: a sibling of
 *     tb-gifi/1 and cca-register/1 (same conventions: contract version,
 *     company/registration identifiers, money as decimal strings built
 *     with integer-cent math, `hash` = SHA-256 of the canonical payload
 *     without the hash field). It carries the worksheet, the
 *     transaction-level detail behind each line, period continuity,
 *     the reconciliation results, and the filing record (confirmation
 *     number) when the period is recorded as filed.
 *
 * Pure functions only — the service (gst-return-service.ts) loads the
 * GL context; everything here is unit-testable without a database.
 * Server-side use (the payload hash uses node:crypto via tb-gifi).
 */

import {
  GST_RETURN_LABELS,
  type GstAdjustmentItem,
  type GstDrillItem,
  type GstReturnResult,
} from './gst-return';
import { canonicalPayloadHash, centsToMoney } from '../tb-gifi';

export const GST_WORKSHEET_CONTRACT_VERSION = 'gst-worksheet/1';

const minor = (n: number): number => Math.round(n * 100);
const major = (n: number): number => n / 100;
const sumMinorOf = (values: number[]): number => values.reduce((s, v) => s + minor(v), 0);

/** Worksheet line order — the full GST34 set. 102 does not exist on the GST34. */
export const GST_WORKSHEET_LINE_ORDER = [
  '101', '103', '104', '105', '106', '107', '108', '109',
  '110', '111', '112', '113', '114', '115',
] as const;

export const GST_WORKSHEET_LABELS: Record<string, string> = {
  ...GST_RETURN_LABELS,
  '113': 'Balance',
};

type LineKind = 'gl' | 'adjustments' | 'calculated';

const LINE_KIND: Record<string, LineKind> = {
  '101': 'gl', '103': 'gl', '106': 'gl',
  '104': 'adjustments', '107': 'adjustments', '110': 'adjustments', '111': 'adjustments',
  '105': 'calculated', '108': 'calculated', '109': 'calculated',
  '112': 'calculated', '113': 'calculated', '114': 'calculated', '115': 'calculated',
};

/** Formula for each calculated line, in terms of other worksheet lines. */
const LINE_FORMULAS: Record<string, { terms: { line: string; sign: 1 | -1 }[]; note: string }> = {
  '105': { terms: [{ line: '103', sign: 1 }, { line: '104', sign: 1 }], note: 'GST/HST collected plus adjustments' },
  '108': { terms: [{ line: '106', sign: 1 }, { line: '107', sign: 1 }], note: 'ITCs plus adjustments' },
  '109': { terms: [{ line: '105', sign: 1 }, { line: '108', sign: -1 }], note: 'Total GST/HST less total ITCs' },
  '112': { terms: [{ line: '110', sign: 1 }, { line: '111', sign: 1 }], note: 'Instalments plus rebates' },
  '113': { terms: [{ line: '109', sign: 1 }, { line: '112', sign: -1 }], note: 'Net tax less other credits' },
  '114': { terms: [{ line: '113', sign: -1 }], note: 'The credit part of the line 113 balance, when it favours the registrant; otherwise nil' },
  '115': { terms: [{ line: '113', sign: 1 }], note: 'The owing part of the line 113 balance, when it favours CRA; otherwise nil' },
};

const ADJUSTMENT_GROUP_BY_LINE: Record<string, 'add' | 'deduct' | 'instalments' | 'rebates'> = {
  '104': 'add', '107': 'deduct', '110': 'instalments', '111': 'rebates',
};

export interface GstWorksheetAccountSlice {
  accountCode: string;
  accountName: string | null;
  /** Signed contribution of this account to the line total (dollars). */
  amount: number;
  transactionCount: number;
}

export interface GstLineComposition {
  /** GL lines: per-account rollup of the drill-down. Empty for other kinds. */
  accounts: GstWorksheetAccountSlice[];
  /** GL lines: the journal transactions behind the line. Empty for other kinds. */
  transactions: GstDrillItem[];
  /** Adjustment lines: the itemized period adjustments. Empty for other kinds. */
  adjustmentItems: GstAdjustmentItem[];
  /** Calculated lines: the formula, in terms of other lines. Null for other kinds. */
  formula: { terms: { line: string; sign: 1 | -1 }[]; note: string } | null;
}

export interface GstWorksheetLine {
  line: string;
  label: string;
  amount: number;
  kind: LineKind;
  /** True when the line is $0 — shown as nil on the worksheet, never hidden. */
  nil: boolean;
  composition: GstLineComposition;
}

export interface GstControlContinuity {
  role: 'output' | 'recoverable';
  label: string;
  accountCode: string;
  accountName: string | null;
  /** The return line this account's period movement must equal. */
  movementLine: '103' | '106';
  /** Balance at the day before the period (credit-positive for output, debit-positive for recoverable). */
  opening: number;
  /** The return line amount (the engine's figure for the period movement). */
  movement: number;
  expectedClosing: number;
  /** Balance at period end, summed independently from the GL. */
  closingPerGl: number;
  difference: number;
  tiesOut: boolean;
}

export interface GstReconciliationCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  figures: { label: string; amount: number }[];
  /** actual − expected, in dollars; null when no numeric difference applies. */
  difference: number | null;
}

export interface GstNetfileSummary {
  /** GST/HST registration (RT) number the return is filed under, when one is on file. */
  registrationNumber: string | null;
  periodStart: string;
  periodEnd: string;
  /**
   * The four keyed NETFILE items: the filer's CRA access code (held by
   * the filer — never stored here) plus lines 101, 109 and 114/115.
   * `keyedNumbers` lists the three return figures; the access code is
   * represented by this flag so the hand-off shows all four slots.
   */
  accessCodeRequired: true;
  keyedNumbers: { line: string; label: string; amount: number }[];
  outcome: 'refund' | 'payment' | 'nil';
  /** The recorded filing (confirmation number + date) once the period is marked filed. */
  filing: { filed: boolean; confirmation: string | null; filedAt: string | null };
}

export interface GstWorksheet {
  lines: GstWorksheetLine[];
  continuity: GstControlContinuity[];
  reconciliations: GstReconciliationCheck[];
  netfile: GstNetfileSummary;
}

export interface GstControlContext {
  accountCode: string;
  /** Balance before the period, signed: output = credits − debits; recoverable = debits − credits. */
  opening: number;
  /** Balance at period end on the same convention, summed independently of the return computation. */
  closingPerGl: number;
}

export interface BuildGstWorksheetInput {
  result: GstReturnResult;
  periodStart: string;
  periodEnd: string;
  registration: { registrationNumber: string; filingFrequency: string; province: string | null } | null;
  filed: { filedAt: string; filingConfirmation: string | null } | null;
  /** Chart-of-accounts names by code, for composition labels. */
  accountNames: Record<string, string>;
  control: { output: GstControlContext; recoverable: GstControlContext };
  /**
   * The tax engine's document-level tax detail for the period (sums of
   * DocumentLineTaxComponent taxHome for GST/HST components), or null
   * when the engine holds no detail — the corroboration checks then
   * report "not corroborated" instead of pretending to tie.
   */
  engineDetail: { outputTax: number; recoverableTax: number; snapshotCount: number } | null;
}

function accountRollup(items: GstDrillItem[], accountNames: Record<string, string>): GstWorksheetAccountSlice[] {
  const byCode = new Map<string, { minorTotal: number; count: number }>();
  for (const item of items) {
    const cur = byCode.get(item.accountCode) ?? { minorTotal: 0, count: 0 };
    cur.minorTotal += minor(item.amount);
    cur.count += 1;
    byCode.set(item.accountCode, cur);
  }
  return [...byCode.entries()]
    .map(([accountCode, v]) => ({
      accountCode,
      accountName: accountNames[accountCode] ?? null,
      amount: major(v.minorTotal),
      transactionCount: v.count,
    }))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

function buildLines(input: BuildGstWorksheetInput): GstWorksheetLine[] {
  const { result } = input;
  const amounts: Record<string, number> = {
    ...result.lines,
    // 113 Balance — the balance the engine already computes internally
    // (109 − 112, its "113C"); surfaced here as a worksheet line.
    '113': major(minor(result.lines['109']) - minor(result.lines['112'])),
  };
  return GST_WORKSHEET_LINE_ORDER.map((line) => {
    const kind = LINE_KIND[line];
    const composition: GstLineComposition = { accounts: [], transactions: [], adjustmentItems: [], formula: null };
    if (kind === 'gl') {
      const items = result.drillDown[line] ?? [];
      composition.transactions = items;
      composition.accounts = accountRollup(items, input.accountNames);
    } else if (kind === 'adjustments') {
      composition.adjustmentItems = result.adjustments[ADJUSTMENT_GROUP_BY_LINE[line]] ?? [];
    } else {
      composition.formula = LINE_FORMULAS[line] ?? null;
    }
    const amount = amounts[line] ?? 0;
    return {
      line,
      label: GST_WORKSHEET_LABELS[line] ?? '',
      amount,
      kind,
      nil: minor(amount) === 0,
      composition,
    };
  });
}

function buildContinuity(input: BuildGstWorksheetInput): GstControlContinuity[] {
  const mk = (
    role: 'output' | 'recoverable', label: string, movementLine: '103' | '106', ctx: GstControlContext,
  ): GstControlContinuity => {
    const movement = input.result.lines[movementLine];
    const expectedClosing = major(minor(ctx.opening) + minor(movement));
    const difference = major(minor(ctx.closingPerGl) - minor(expectedClosing));
    return {
      role,
      label,
      accountCode: ctx.accountCode,
      accountName: input.accountNames[ctx.accountCode] ?? null,
      movementLine,
      opening: ctx.opening,
      movement,
      expectedClosing,
      closingPerGl: ctx.closingPerGl,
      difference,
      tiesOut: minor(difference) === 0,
    };
  };
  return [
    mk('output', 'GST/HST collected (payable) control account', '103', input.control.output),
    mk('recoverable', 'GST/HST recoverable (ITC) control account', '106', input.control.recoverable),
  ];
}

function buildReconciliations(input: BuildGstWorksheetInput, continuity: GstControlContinuity[]): GstReconciliationCheck[] {
  const { result } = input;
  const checks: GstReconciliationCheck[] = [];

  // 1 — Revenue: line 101 vs the GL revenue accounts (exact, unrounded).
  // The only legitimate difference is CRA's whole-dollar rounding of 101.
  const revenueExact = major(sumMinorOf((result.drillDown['101'] ?? []).map((d) => d.amount)));
  const revenueDiff = major(minor(result.lines['101']) - minor(revenueExact));
  checks.push({
    id: 'revenue-tie-out',
    label: 'Line 101 vs GL revenue accounts',
    status: Math.abs(revenueDiff) <= 0.5 ? 'pass' : 'fail',
    detail: Math.abs(revenueDiff) <= 0.5
      ? 'Line 101 agrees with the revenue accounts for the period; the only difference is CRA whole-dollar rounding.'
      : 'Line 101 differs from the revenue accounts by more than whole-dollar rounding — the return does not reflect the books.',
    figures: [
      { label: 'Line 101 (as reported)', amount: result.lines['101'] },
      { label: 'Revenue per GL (exact)', amount: revenueExact },
    ],
    difference: revenueDiff,
  });

  // 2/3 — Control-account continuity, period over period (design §5.2).
  for (const c of continuity) {
    checks.push({
      id: `continuity-${c.role}`,
      label: `Control account continuity — ${c.accountCode}`,
      status: c.tiesOut ? 'pass' : 'fail',
      detail: c.tiesOut
        ? `Opening balance + line ${c.movementLine} movement = the GL balance at period end.`
        : `Opening balance + line ${c.movementLine} movement does not reach the GL balance at period end — postings to this control account are not fully reflected in the return.`,
      figures: [
        { label: 'Opening balance', amount: c.opening },
        { label: `Line ${c.movementLine} movement`, amount: c.movement },
        { label: 'Expected closing', amount: c.expectedClosing },
        { label: 'Closing per GL', amount: c.closingPerGl },
      ],
      difference: c.difference,
    });
  }

  // 4/5 — Return vs the tax engine's document-level detail (the
  // "ITCs vs expenses" auditor question, and its output-tax twin).
  // Timing/classification differences are legitimate (tax point dates
  // vs journal dates), so a difference warns; it never passes silently.
  const corroborate = (
    id: string, label: string, returnAmount: number, engineAmount: number | null, noneDetail: string,
  ): GstReconciliationCheck => {
    if (engineAmount == null) {
      return {
        id, label, status: 'warn',
        detail: noneDetail,
        figures: [{ label: 'Per return (GL)', amount: returnAmount }],
        difference: null,
      };
    }
    const difference = major(minor(returnAmount) - minor(engineAmount));
    return {
      id, label,
      status: minor(difference) === 0 ? 'pass' : 'warn',
      detail: minor(difference) === 0
        ? 'The return agrees with the tax engine’s document-level tax detail for the period.'
        : 'The return differs from the tax engine’s document-level tax detail — usually tax-point vs journal-date timing, or manual journals to the control account. The difference is shown, not absorbed.',
      figures: [
        { label: 'Per return (GL)', amount: returnAmount },
        { label: 'Per tax engine detail', amount: engineAmount },
      ],
      difference,
    };
  };
  checks.push(corroborate(
    'output-vs-tax-engine', 'Line 103 vs tax engine output tax',
    result.lines['103'],
    input.engineDetail ? input.engineDetail.outputTax : null,
    'No tax-engine document detail exists for this period, so line 103 rests on the GL control account alone and cannot be corroborated.',
  ));
  checks.push(corroborate(
    'itc-vs-tax-engine', 'Line 106 ITCs vs tax engine recoverable tax',
    result.lines['106'],
    input.engineDetail ? input.engineDetail.recoverableTax : null,
    'No tax-engine document detail exists for this period, so the ITCs rest on the GL control account alone and cannot be corroborated.',
  ));

  // 6 — Arithmetic: the calculated lines re-derive from their inputs.
  const l = result.lines;
  const balance = major(minor(l['109']) - minor(l['112']));
  const arithmeticOk =
    minor(l['105']) === minor(l['103']) + minor(l['104']) &&
    minor(l['108']) === minor(l['106']) + minor(l['107']) &&
    minor(l['109']) === minor(l['105']) - minor(l['108']) &&
    minor(l['112']) === minor(l['110']) + minor(l['111']) &&
    minor(l['114']) === Math.max(0, -minor(balance)) &&
    minor(l['115']) === Math.max(0, minor(balance));
  checks.push({
    id: 'return-arithmetic',
    label: 'Return arithmetic (105 / 108 / 109 / 112 / 114 / 115)',
    status: arithmeticOk ? 'pass' : 'fail',
    detail: arithmeticOk
      ? 'Every calculated line re-derives exactly from its inputs.'
      : 'A calculated line does not re-derive from its inputs — the return is internally inconsistent.',
    figures: [
      { label: 'Line 109 net tax', amount: l['109'] },
      { label: 'Line 113 balance', amount: balance },
    ],
    difference: null,
  });

  return checks;
}

function buildNetfile(input: BuildGstWorksheetInput): GstNetfileSummary {
  const l = input.result.lines;
  const outcome: GstNetfileSummary['outcome'] = minor(l['114']) > 0 ? 'refund' : minor(l['115']) > 0 ? 'payment' : 'nil';
  const outcomeLine = outcome === 'refund' ? '114' : '115';
  return {
    registrationNumber: input.registration?.registrationNumber ?? null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    accessCodeRequired: true,
    keyedNumbers: [
      { line: '101', label: GST_WORKSHEET_LABELS['101'], amount: l['101'] },
      { line: '109', label: GST_WORKSHEET_LABELS['109'], amount: l['109'] },
      { line: outcomeLine, label: GST_WORKSHEET_LABELS[outcomeLine], amount: l[outcomeLine] },
    ],
    outcome,
    filing: {
      filed: Boolean(input.filed),
      confirmation: input.filed?.filingConfirmation ?? null,
      filedAt: input.filed?.filedAt ?? null,
    },
  };
}

export function buildGstWorksheet(input: BuildGstWorksheetInput): GstWorksheet {
  const continuity = buildContinuity(input);
  return {
    lines: buildLines(input),
    continuity,
    reconciliations: buildReconciliations(input, continuity),
    netfile: buildNetfile(input),
  };
}

// ── gst-worksheet/1 audit-trail package ─────────────────────────────

export interface BuildGstWorksheetPayloadInput {
  companyId: string;
  companyName: string;
  /** The company's GST/HST number from its profile, when set (the worksheet's RT registration rides alongside). */
  gstNumber: string | null;
  registration: { registrationNumber: string; filingFrequency: string; province: string | null } | null;
  worksheet: GstWorksheet;
  /** ISO timestamp — part of the hashed payload, as in tb-gifi/1's postedThrough. */
  generatedAt: string;
}

const money = (n: number): string => centsToMoney(minor(n));

export function buildGstWorksheetPayload(input: BuildGstWorksheetPayloadInput): {
  payload: Record<string, unknown> & { hash: string };
  lineCount: number;
} {
  const ws = input.worksheet;
  const lines = ws.lines.map((line) => ({
    line: line.line,
    label: line.label,
    amount: money(line.amount),
    kind: line.kind,
    nil: line.nil,
    composition: {
      accounts: line.composition.accounts.map((a) => ({
        accountCode: a.accountCode,
        accountName: a.accountName,
        amount: money(a.amount),
        transactionCount: a.transactionCount,
      })),
      transactions: line.composition.transactions.map((t) => ({
        lineId: t.lineId,
        entryId: t.entryId,
        date: t.date,
        accountCode: t.accountCode,
        description: t.description,
        debit: money(t.debit),
        credit: money(t.credit),
        amount: money(t.amount),
      })),
      adjustmentItems: line.composition.adjustmentItems.map((i) => ({ amount: money(i.amount), note: i.note })),
      formula: line.composition.formula
        ? {
            terms: line.composition.formula.terms.map((t) => ({ line: t.line, sign: t.sign })),
            note: line.composition.formula.note,
          }
        : null,
    },
  }));

  const withoutHash = {
    contractVersion: GST_WORKSHEET_CONTRACT_VERSION,
    companyId: input.companyId,
    companyName: input.companyName,
    gstNumber: input.gstNumber,
    registration: input.registration
      ? {
          registrationNumber: input.registration.registrationNumber,
          filingFrequency: input.registration.filingFrequency,
          province: input.registration.province,
        }
      : null,
    periodStart: ws.netfile.periodStart,
    periodEnd: ws.netfile.periodEnd,
    generatedAt: input.generatedAt,
    lines,
    continuity: ws.continuity.map((c) => ({
      role: c.role,
      label: c.label,
      accountCode: c.accountCode,
      accountName: c.accountName,
      movementLine: c.movementLine,
      opening: money(c.opening),
      movement: money(c.movement),
      expectedClosing: money(c.expectedClosing),
      closingPerGl: money(c.closingPerGl),
      difference: money(c.difference),
      tiesOut: c.tiesOut,
    })),
    reconciliations: ws.reconciliations.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      detail: r.detail,
      figures: r.figures.map((f) => ({ label: f.label, amount: money(f.amount) })),
      difference: r.difference == null ? null : money(r.difference),
    })),
    netfile: {
      registrationNumber: ws.netfile.registrationNumber,
      accessCodeRequired: ws.netfile.accessCodeRequired,
      keyedNumbers: ws.netfile.keyedNumbers.map((k) => ({ line: k.line, label: k.label, amount: money(k.amount) })),
      outcome: ws.netfile.outcome,
    },
    filing: {
      status: ws.netfile.filing.filed ? 'filed_recorded' : 'not_filed',
      confirmation: ws.netfile.filing.confirmation,
      filedAt: ws.netfile.filing.filedAt,
    },
  };

  return {
    payload: { ...withoutHash, hash: canonicalPayloadHash(withoutHash) },
    lineCount: lines.length,
  };
}
