/**
 * Loan statement capture — the pure half (Phase 3, item 3).
 *
 * Everything here is deterministic and DB-free: the draft pre-fill a
 * reviewer edits before creating a loan, the statement-vs-schedule
 * check, and the tail-correction plan. The provenance rule runs
 * through all of it: a value is either 'statement' (the paper printed
 * it — the OCR read carries the model's confidence) or 'calculated'
 * (the amortization engine derived it from statement values, marked
 * as such, never dressed up as read). Nothing here invents a value
 * the statement did not support.
 */
import { LOW_CONFIDENCE_THRESHOLD } from '@/lib/receipts/ocr-provider';
import { buildSchedule, scheduleBalanceAtCents, toCents, type ScheduleRow } from './engine';
import type { LoanStatementExtraction } from './statement-ocr';

// ─── Upload validation ──────────────────────────────────────────────
// Lives in statement-validate.ts (a pure leaf module the client pages
// can import, like receipts/validate.ts); re-exported here so server
// code has one loan-statement entry point.
export {
  LOAN_STATEMENT_MAX_BYTES,
  LOAN_STATEMENT_MIME_TYPES,
  LOAN_STATEMENT_ACCEPT,
  validateLoanStatementUpload,
  type StatementUploadValidation,
} from './statement-validate';

// ─── Draft pre-fill ─────────────────────────────────────────────────

export type FieldSource = 'statement' | 'calculated';

export interface PrefillField<T> {
  value: T | null;
  /** Model confidence for statement-read fields; null for calculated ones. */
  confidence: number | null;
  /** Where the value came from — null when there is no value. */
  source: FieldSource | null;
  /** Read by the model but below the review threshold — check it first. */
  lowConfidence: boolean;
}

/**
 * The new-loan draft a statement produces. It feeds the EXISTING loan
 * create flow (POST /api/loans): the statement's current balance is
 * the new loan's principal (the loan is being registered mid-life,
 * from the paper), the statement date its start, the next payment
 * date its first payment date. `remainingPayments` is the one derived
 * figure: the engine solves the term from balance + payment + rate
 * (monthly cadence assumed — the reviewer confirms the frequency in
 * the form), and it is marked 'calculated', never 'statement'.
 */
export interface LoanDraftPrefill {
  lenderName: PrefillField<string>;
  principal: PrefillField<number>;
  startDate: PrefillField<string>;
  firstPaymentDate: PrefillField<string>;
  paymentAmount: PrefillField<number>;
  annualRatePct: PrefillField<number>;
  remainingPayments: PrefillField<number>;
}

function statementField<T>(field: { value: T | null; confidence: number | null }): PrefillField<T> {
  return {
    value: field.value,
    confidence: field.confidence,
    source: field.value !== null ? 'statement' : null,
    lowConfidence:
      field.value !== null && field.confidence !== null && field.confidence < LOW_CONFIDENCE_THRESHOLD,
  };
}

export function buildLoanDraftPrefill(x: LoanStatementExtraction): LoanDraftPrefill {
  let remainingPayments: number | null = null;
  if (x.currentBalance.value !== null && x.paymentAmount.value !== null && x.annualRatePct.value !== null) {
    try {
      const solved = buildSchedule({
        principalCents: toCents(x.currentBalance.value),
        annualRatePct: x.annualRatePct.value,
        frequency: 'monthly',
        firstPaymentDate: x.nextPaymentDate.value ?? x.statementDate.value ?? '2000-01-01',
        paymentCents: toCents(x.paymentAmount.value),
      });
      remainingPayments = solved.numberOfPayments;
    } catch {
      // Payment does not cover the interest, or the balance is at the
      // balloon — no honest term to offer; the field stays empty.
      remainingPayments = null;
    }
  }

  return {
    lenderName: statementField(x.lenderName),
    principal: statementField(x.currentBalance),
    startDate: statementField(x.statementDate),
    firstPaymentDate: statementField(x.nextPaymentDate),
    paymentAmount: statementField(x.paymentAmount),
    annualRatePct: statementField(x.annualRatePct),
    remainingPayments: {
      value: remainingPayments,
      confidence: null,
      source: remainingPayments !== null ? 'calculated' : null,
      lowConfidence: false,
    },
  };
}

// ─── Statement vs schedule check ────────────────────────────────────

/**
 * Drift bands for the check. An exact match is the statement agreeing
 * with the schedule to the cent. A small difference (≤ $5) is the
 * ordinary noise of a statement cut between payment dates — accrued
 * interest timing, a payment in transit. Anything larger is a real
 * divergence the reviewer should understand before accepting the
 * correction.
 */
export const SMALL_DRIFT_CENTS = 500;

export type DriftLevel = 'match' | 'small' | 'large';

export interface ScheduleCheck {
  statementDate: string;
  statementBalanceCents: number;
  scheduleBalanceCents: number;
  /** statement − schedule: positive means the lender says MORE is owed than the schedule shows. */
  differenceCents: number;
  drift: DriftLevel;
}

export function classifyDrift(differenceCents: number): DriftLevel {
  if (differenceCents === 0) return 'match';
  return Math.abs(differenceCents) <= SMALL_DRIFT_CENTS ? 'small' : 'large';
}

export function computeScheduleCheck(args: {
  rows: ScheduleRow[];
  principalCents: number;
  statementDate: string;
  statementBalanceCents: number;
}): ScheduleCheck {
  const scheduleBalanceCents = scheduleBalanceAtCents(args.rows, args.principalCents, args.statementDate);
  const differenceCents = args.statementBalanceCents - scheduleBalanceCents;
  return {
    statementDate: args.statementDate,
    statementBalanceCents: args.statementBalanceCents,
    scheduleBalanceCents,
    differenceCents,
    drift: classifyDrift(differenceCents),
  };
}

// ─── Tail-correction plan ───────────────────────────────────────────

/**
 * Where a re-amortization anchors. The tail is every schedule row due
 * AFTER the statement date; the anchor period is the last row due on
 * or before it (posted history is never touched — the plan only ever
 * rebuilds 'scheduled' rows). The rebuilt tail opens at the STATEMENT
 * balance on the first tail row's own date, at the loan's contractual
 * payment — the loan engine's existing differing-actuals pattern,
 * anchored on the statement instead of a posted payment.
 */
export interface TailCorrectionPlan {
  /** Period of the last row due on or before the statement date (0 = none yet). */
  anchorPeriod: number;
  /** Date the rebuilt tail's first payment falls on; null when no tail remains. */
  firstTailDate: string | null;
  /** Period number the rebuilt tail starts at; null when no tail remains. */
  startPeriod: number | null;
  /** The regular payment to rebuild with (the tail's own, or the anchor row's). */
  regularPaymentCents: number | null;
}

export function planTailCorrection(rows: ScheduleRow[], statementDate: string): TailCorrectionPlan {
  const anchor = rows.filter((r) => r.date <= statementDate).pop();
  const tail = rows.filter((r) => r.date > statementDate);
  const firstTail = tail[0];
  return {
    anchorPeriod: anchor?.period ?? 0,
    firstTailDate: firstTail?.date ?? null,
    startPeriod: firstTail?.period ?? null,
    regularPaymentCents: firstTail?.paymentCents ?? anchor?.paymentCents ?? null,
  };
}
