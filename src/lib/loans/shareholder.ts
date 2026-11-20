/**
 * Shareholder-loan compliance — pure functions, no database, no I/O.
 *
 * Improvement plan Phase 1, item 3 (DESIGN-TAX-DOMAIN.md §4.2).
 * Shareholder lending is where small corporations get hurt, so this half
 * of the tool is warnings and numbers only — it never proposes a
 * clearing journal (that design decision is still open with the owner).
 *
 *   - s.15(2): a loan to a shareholder (or a connected person) that is
 *     not repaid within ONE YEAR AFTER THE END of the taxation year in
 *     which the advance was made is included in the shareholder's
 *     personal income. The deadline attaches to EACH advance, so
 *     advances are tracked individually and repayments are allocated
 *     FIFO (oldest advance cleared first) to decide what is still
 *     outstanding — never netted silently.
 *   - Series of loans and repayments: a repayment followed by a fresh
 *     advance is still part of a series under s.15(2) — flagged as a
 *     pattern, never treated as a cure.
 *   - s.80.4: a low- or no-interest shareholder loan creates a deemed
 *     interest benefit = balance × (prescribed rate − loan rate) over
 *     the days the balance was outstanding. The prescribed rate is an
 *     input (it changes quarterly; the accountant supplies the current
 *     one) — the tool supplies the number and the dates, the T4 box 117
 *     reporting call stays the accountant's.
 */

import {
  fiscalYearRangeContaining,
  type FirstFiscalYear,
} from '@/lib/fiscal-year';
import { addOneYear, daysBetween } from './engine';

export interface AdvanceEvent {
  id?: string;
  kind: 'advance' | 'repayment';
  date: string; // YYYY-MM-DD
  amountCents: number;
  notes?: string | null;
}

function sortedEvents(events: AdvanceEvent[]): AdvanceEvent[] {
  return [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Running balance owed by the shareholder after each event, in date order. */
export function runningBalances(
  events: AdvanceEvent[]
): { event: AdvanceEvent; balanceAfterCents: number }[] {
  let balance = 0;
  return sortedEvents(events).map((event) => {
    balance += event.kind === 'advance' ? event.amountCents : -event.amountCents;
    return { event, balanceAfterCents: balance };
  });
}

/** Balance owed by the shareholder at a date (events on the date count). */
export function shareholderBalanceAtCents(events: AdvanceEvent[], asOfYmd: string): number {
  let balance = 0;
  for (const event of sortedEvents(events)) {
    if (event.date > asOfYmd) break;
    balance += event.kind === 'advance' ? event.amountCents : -event.amountCents;
  }
  return balance;
}

/**
 * The s.15(2) deadline for one advance: one year after the end of the
 * taxation year (the company's fiscal year) in which it was made.
 * E.g. a Sep 30 year-end company advancing on 2026-03-15: the advance
 * falls in the year ending 2026-09-30, so the deadline is 2027-09-30.
 */
export function shareholderDeadlineForAdvance(
  advanceDateYmd: string,
  anchor: { month: number; day: number },
  firstYear?: FirstFiscalYear | null
): string {
  const fy = fiscalYearRangeContaining(anchor, advanceDateYmd, firstYear ?? null);
  return addOneYear(fy.end);
}

export type ShareholderWarningLevel = 'overdue' | 'critical' | 'warning' | 'watch';

export interface AdvanceDeadline {
  advance: AdvanceEvent;
  /** Amount of THIS advance still outstanding after FIFO repayments. */
  outstandingCents: number;
  deadline: string;
  daysRemaining: number; // deadline − asOf; negative = past the deadline
  level: ShareholderWarningLevel | null; // null = more than 180 days out
  message: string;
}

export function warningLevelFor(daysRemaining: number): ShareholderWarningLevel | null {
  if (daysRemaining < 0) return 'overdue';
  if (daysRemaining <= 30) return 'critical';
  if (daysRemaining <= 90) return 'warning';
  if (daysRemaining <= 180) return 'watch';
  return null;
}

/**
 * Per-advance s.15(2) deadlines with warnings at 180 / 90 / 30 days.
 * Repayments clear the OLDEST outstanding advance first (FIFO), so an
 * advance only appears here while some of it is still unpaid.
 */
export function advanceDeadlines(
  events: AdvanceEvent[],
  anchor: { month: number; day: number },
  asOfYmd: string,
  firstYear?: FirstFiscalYear | null
): AdvanceDeadline[] {
  const ordered = sortedEvents(events);
  const advances = ordered
    .filter((e) => e.kind === 'advance')
    .map((advance) => ({ advance, outstandingCents: advance.amountCents }));

  // FIFO: each repayment clears the oldest advances first.
  for (const event of ordered) {
    if (event.kind !== 'repayment') continue;
    let remaining = event.amountCents;
    for (const entry of advances) {
      if (remaining <= 0) break;
      const applied = Math.min(remaining, entry.outstandingCents);
      entry.outstandingCents -= applied;
      remaining -= applied;
    }
  }

  const result: AdvanceDeadline[] = [];
  for (const { advance, outstandingCents } of advances) {
    if (outstandingCents <= 0) continue;
    const deadline = shareholderDeadlineForAdvance(advance.date, anchor, firstYear ?? null);
    const daysRemaining = daysBetween(asOfYmd, deadline);
    const level = warningLevelFor(daysRemaining);
    result.push({
      advance,
      outstandingCents,
      deadline,
      daysRemaining,
      level,
      message:
        daysRemaining < 0
          ? `Advance of ${(outstandingCents / 100).toFixed(2)} on ${advance.date} was not repaid by ${deadline} — under s.15(2) the outstanding amount is included in the shareholder's personal income.`
          : `Advance of ${(outstandingCents / 100).toFixed(2)} on ${advance.date} must be repaid by ${deadline} or it becomes personal income to the shareholder under s.15(2).`,
    });
  }
  return result.sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
}

// ─── Series of loans and repayments ───

export interface SeriesFlag {
  repaymentDate: string;
  repaymentCents: number;
  advanceDate: string;
  advanceCents: number;
  gapDays: number;
  message: string;
}

/**
 * Flag repayments followed by a fresh advance within `windowDays`
 * (default 90). Under s.15(2) a loan repaid as part of a series of loans
 * and repayments is not treated as repaid — the pattern is surfaced,
 * never silently accepted as a cure.
 */
export function detectSeriesPatterns(
  events: AdvanceEvent[],
  windowDays = 90
): SeriesFlag[] {
  const ordered = sortedEvents(events);
  const flags: SeriesFlag[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const repayment = ordered[i];
    if (repayment.kind !== 'repayment') continue;
    for (let j = i + 1; j < ordered.length; j++) {
      const next = ordered[j];
      const gap = daysBetween(repayment.date, next.date);
      if (gap > windowDays) break;
      if (next.kind === 'advance') {
        flags.push({
          repaymentDate: repayment.date,
          repaymentCents: repayment.amountCents,
          advanceDate: next.date,
          advanceCents: next.amountCents,
          gapDays: gap,
          message:
            `Repayment of ${(repayment.amountCents / 100).toFixed(2)} on ${repayment.date} was followed by a new advance of ` +
            `${(next.amountCents / 100).toFixed(2)} on ${next.date} (${gap} days later). A repayment that is part of a series of ` +
            `loans and repayments does not clear the original advance under s.15(2) — get tax advice before relying on it.`,
        });
        break; // one flag per repayment: the first re-advance is the pattern
      }
    }
  }
  return flags;
}

// ─── s.80.4 deemed interest benefit ───

/**
 * Estimated s.80.4 benefit in cents over [fromYmd, toYmd): the balance
 * outstanding each day × (prescribed rate − loan rate), pro-rated over
 * 365 days. Balances are reconstructed from the advance/repayment
 * events (events before fromYmd set the opening balance). A negative
 * rate spread counts as zero — a loan at or above the prescribed rate
 * creates no benefit.
 */
export function shareholderBenefitCents(
  events: AdvanceEvent[],
  prescribedRatePct: number,
  loanRatePct: number,
  fromYmd: string,
  toYmd: string
): number {
  const spread = Math.max(0, prescribedRatePct - loanRatePct) / 100;
  if (spread <= 0 || toYmd <= fromYmd) return 0;

  const ordered = sortedEvents(events);
  let balance = 0;
  let idx = 0;
  // Opening balance: every event before the window.
  while (idx < ordered.length && ordered[idx].date < fromYmd) {
    balance += ordered[idx].kind === 'advance' ? ordered[idx].amountCents : -ordered[idx].amountCents;
    idx++;
  }

  let benefit = 0;
  let cursor = fromYmd;
  const accrue = (until: string) => {
    const days = daysBetween(cursor, until);
    if (days > 0 && balance > 0) benefit += (balance * spread * days) / 365;
    cursor = until;
  };
  while (idx < ordered.length && ordered[idx].date < toYmd) {
    const event = ordered[idx];
    accrue(event.date);
    balance += event.kind === 'advance' ? event.amountCents : -event.amountCents;
    idx++;
  }
  accrue(toYmd);
  return Math.round(benefit);
}
