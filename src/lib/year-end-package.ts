/**
 * year-end-package/1 — the one-click T2 handoff bundle (design
 * improvement-plan/DESIGN-TAX-DOMAIN.md §7).
 *
 * One package per company per fiscal year, assembled from the exports
 * and registers Phase 1 built before it:
 *
 *   coverSheet     — the pre-flight results (below), printed on the
 *                    package so the state of the books is never a
 *                    surprise on import;
 *   trialBalance   — the tb-gifi/1 payload for the year, plus the
 *                    prior year's tb-gifi/1 payload as the comparative
 *                    (the tb-gifi contract's `comparatives` idea,
 *                    realised as a sibling payload so each year keeps
 *                    its own verifiable hash);
 *   glDetail       — per-account opening / in-year activity / closing
 *                    summary (balances signed, debit-positive) and the
 *                    journal listing summarised by source (user / bank
 *                    feed / payroll run / loan tool / system …);
 *   ccaRegister    — the cca-register/1 payload, embedded whole (its
 *                    own hash rides inside it);
 *   loans          — every loan's schedule, fiscal-year interest
 *                    totals, three-way balance proof at year-end, and
 *                    the shareholder-loan s.15(2) deadlines;
 *   gstWorksheets  — one gst-worksheet/1 payload per GST/HST filing
 *                    period overlapping the fiscal year;
 *   payroll        — the payroll figures LedgerPro itself holds: the
 *                    Nexvar Pay journals posted into these books.
 *                    T4/T4A data and the PD7A tie-out live in Nexvar
 *                    Pay (a separate product and database) — when no
 *                    payroll journals reached these books, the section
 *                    is an explicit empty slot naming exactly what the
 *                    preparer attaches from Nexvar Pay. LedgerPro does
 *                    not invent a cross-product integration.
 *
 * Conventions (shared with tb-gifi/1 and cca-register/1): money is
 * decimal strings built with integer-cent math; `hash` is the SHA-256
 * of the canonical payload — stable JSON (object keys sorted
 * recursively, arrays in order, no whitespace) of the payload WITHOUT
 * the hash field. Nexvar Tax consumes the bundle by importing the
 * trialBalance into its Sch 100/101/125 build, the ccaRegister into
 * Sch 8 capture, and cross-checking the loan interest totals against
 * GIFI 8710 in the TB — every failed cross-check becomes a named
 * diagnostic there, the same philosophy as the V-GIFI checks.
 *
 * This module is PURE: the pre-flight evaluation and the payload
 * builder run over plain cent-based facts. The DB assembly lives in
 * src/lib/year-end/server.ts.
 *
 * Server-side only (the hash uses node:crypto, via tb-gifi).
 */

import { canonicalPayloadHash, centsToMoney, type TbGifiPayload } from './tb-gifi';

export const YEAR_END_PACKAGE_CONTRACT_VERSION = 'year-end-package/1';

// ── Pre-flight checks ────────────────────────────────────────────────

export type PreflightStatus = 'pass' | 'warn' | 'block' | 'not_checked';

export interface PreflightFigure {
  label: string;
  value: string;
}

export interface PreflightCheck {
  id: string;
  label: string;
  status: PreflightStatus;
  /** One or two sentences, written for the bookkeeper. */
  detail: string;
  figures: PreflightFigure[];
  /** Named exceptions (accounts, loans, periods…) behind a warn/block. */
  items: string[];
}

export interface CoverSheetSummary {
  pass: number;
  warn: number;
  block: number;
  notChecked: number;
  /** Worst status present: block > warn > pass (not_checked never degrades it). */
  overall: 'pass' | 'warn' | 'block';
}

export interface CoverSheet {
  checks: PreflightCheck[];
  summary: CoverSheetSummary;
}

const money = (cents: number): string => centsToMoney(cents);

// ── Facts (all money in integer cents, dates YYYY-MM-DD) ────────────

export interface YearEndFacts {
  fiscalYear: { start: string; end: string; label: string };
  trialBalance: {
    totalDebitCents: number;
    totalCreditCents: number;
    accountCount: number;
  };
  gifi: {
    /** Active, non-exempt accounts — the readiness denominator. */
    total: number;
    coded: number;
    /** Countable accounts with no code, or an invalid one — no decision recorded. */
    needsCode: { code: string; name: string; balanceCents: number }[];
    /** Accounts deliberately left unmapped (the decision is recorded). */
    decidedUnmapped: { code: string; name: string }[];
  };
  /** Suspense/clearing accounts with a NON-ZERO balance at year-end. */
  suspense: { code: string; name: string; balanceCents: number }[];
  /** True when the chart has no suspense/clearing accounts at all. */
  suspenseAccountsExist: boolean;
  periodLock: {
    /** A closed period close covers the fiscal year end. */
    closed: boolean;
    /** Journal entries dated inside the year but created after it was closed. */
    postingsAfterCloseCount: number;
  };
  loans: {
    id: string;
    lenderName: string;
    kind: string;
    /** Scheduled payments due on or before year-end that were never posted or skipped. */
    unpostedDueCount: number;
    /** Schedule balance minus GL balance at year-end; null when a leg is unavailable. */
    scheduleVsGlCents: number | null;
    /** Schedule balance minus the recorded lender statement balance; null when none recorded. */
    scheduleVsStatementCents: number | null;
    /** s.15(2) deadlines (shareholder advances) — outstanding amount and days from year-end. */
    shareholderDeadlines: {
      advanceDate: string;
      deadline: string;
      daysRemaining: number;
      outstandingCents: number;
    }[];
  }[];
  fixedAssets: {
    assetCount: number;
    /** Assets whose CCA class is not one Nexvar Tax models. */
    unmodelledClass: { description: string; ccaClass: string }[];
    /** Assets with no GL asset account mapped. */
    missingGlMapping: string[];
    /** Assets whose available-for-use date precedes their acquisition date. */
    afuBeforeAcquisition: string[];
    /** Capital cost of assets acquired in the year, per the register. */
    registerAdditionsCents: number;
    /** Net debits in the year on the register's mapped asset accounts; null when nothing is mapped. */
    glAdditionsCents: number | null;
    /** Register book depreciation minus the amortization expense in the TB; null when no ledger figure exists. */
    bookVsLedgerDifferenceCents: number | null;
    /** Book depreciation computed for the year but not yet posted; 0 when posted or none. */
    unpostedDepreciationCents: number;
  };
  gst: {
    registrationPresent: boolean;
    /** Filing periods overlapping the fiscal year. `due` = period ended on/before the fiscal year end. */
    periods: { start: string; end: string; due: boolean; filed: boolean; confirmation: string | null }[];
  };
  bank: {
    /** Null when the company has no bank/credit accounts in LedgerPro at all. */
    accounts: { name: string; reconciledThrough: string | null }[] | null;
  };
  payroll: {
    /** Why the T4/PD7A tie-out cannot be checked from LedgerPro. */
    notCheckedReason: string;
  };
}

function checkTrialBalance(f: YearEndFacts): PreflightCheck {
  const { totalDebitCents, totalCreditCents, accountCount } = f.trialBalance;
  const diff = totalDebitCents - totalCreditCents;
  const figures = [
    { label: 'Total debits', value: money(totalDebitCents) },
    { label: 'Total credits', value: money(totalCreditCents) },
    { label: 'Accounts', value: String(accountCount) },
  ];
  if (diff === 0) {
    return {
      id: 'trial_balance_balances',
      label: 'Trial balance balances',
      status: 'pass',
      detail: 'Total debits equal total credits at year-end.',
      figures,
      items: [],
    };
  }
  return {
    id: 'trial_balance_balances',
    label: 'Trial balance balances',
    status: 'block',
    detail: `The trial balance is out of balance by ${money(Math.abs(diff))} — the books must be corrected before this package can support a return.`,
    figures: [...figures, { label: 'Difference', value: money(diff) }],
    items: [],
  };
}

function checkGifi(f: YearEndFacts): PreflightCheck {
  const g = f.gifi;
  const figures: PreflightFigure[] = [
    { label: 'Coded', value: `${g.coded} of ${g.total}` },
    { label: 'Undecided', value: String(g.needsCode.length) },
    { label: 'Unmapped by choice', value: String(g.decidedUnmapped.length) },
  ];
  const items = [
    ...g.needsCode.map(
      (a) => `${a.code} ${a.name} — no GIFI decision (balance ${money(a.balanceCents)})`
    ),
    ...g.decidedUnmapped.map((a) => `${a.code} ${a.name} — left unmapped by choice`),
  ];
  if (g.needsCode.length === 0) {
    return {
      id: 'gifi_decisions',
      label: 'Every account carries a GIFI decision',
      status: 'pass',
      detail:
        g.decidedUnmapped.length > 0
          ? `Every account is coded or deliberately left unmapped. The ${g.decidedUnmapped.length} unmapped-by-choice account(s) below export as unmapped and land in Nexvar Tax's mapping review, as recorded.`
          : 'Every account on the chart carries a GIFI code.',
      figures,
      items,
    };
  }
  // Design §2.3: the year-end gate is a gate, not a wall — the package
  // can always be generated; undecided accounts export as null and
  // land in mapping review. So this warns, never blocks.
  return {
    id: 'gifi_decisions',
    label: 'Every account carries a GIFI decision',
    status: 'warn',
    detail: `${g.needsCode.length} account(s) have no GIFI decision yet. They export as unmapped and land in Nexvar Tax's mapping review — coding them here first is the cheaper path.`,
    figures,
    items,
  };
}

function checkSuspense(f: YearEndFacts): PreflightCheck {
  if (f.suspense.length === 0) {
    return {
      id: 'suspense_zero',
      label: 'Suspense and clearing accounts at zero',
      status: 'pass',
      detail: f.suspenseAccountsExist
        ? 'Every suspense/clearing account is at zero at year-end.'
        : 'The chart has no suspense or clearing accounts.',
      figures: [],
      items: [],
    };
  }
  // Design §2.3: a non-zero year-end suspense balance is a books
  // problem, not a mapping problem — money the books cannot yet
  // explain does not belong in a filing package unflagged.
  return {
    id: 'suspense_zero',
    label: 'Suspense and clearing accounts at zero',
    status: 'block',
    detail:
      'Suspense/clearing accounts may stay unmapped only while their balance is zero. A non-zero balance at year-end means deposits or payments are still unidentified — clear them before filing.',
    figures: f.suspense.map((a) => ({ label: `${a.code} ${a.name}`, value: money(a.balanceCents) })),
    items: f.suspense.map((a) => `${a.code} ${a.name} — balance ${money(a.balanceCents)}`),
  };
}

function checkPeriodLock(f: YearEndFacts): PreflightCheck {
  const p = f.periodLock;
  if (!p.closed) {
    return {
      id: 'period_lock',
      label: 'Fiscal year closed, no postings after the lock',
      status: 'warn',
      detail:
        'This fiscal year has not been closed in Period Close. The package is still generated, but closing the year first is what stops late postings from quietly changing these figures.',
      figures: [],
      items: [],
    };
  }
  if (p.postingsAfterCloseCount > 0) {
    return {
      id: 'period_lock',
      label: 'Fiscal year closed, no postings after the lock',
      status: 'block',
      detail: `${p.postingsAfterCloseCount} journal entr${p.postingsAfterCloseCount === 1 ? 'y was' : 'ies were'} dated inside this fiscal year but created after the year was closed. The closed figures and the current books no longer agree — review them before relying on this package.`,
      figures: [{ label: 'Postings after close', value: String(p.postingsAfterCloseCount) }],
      items: [],
    };
  }
  return {
    id: 'period_lock',
    label: 'Fiscal year closed, no postings after the lock',
    status: 'pass',
    detail: 'The fiscal year is closed and nothing has been posted into it since.',
    figures: [],
    items: [],
  };
}

function checkLoans(f: YearEndFacts): PreflightCheck {
  if (f.loans.length === 0) {
    return {
      id: 'loans_tie_out',
      label: 'Loans tie to the ledger; shareholder deadlines in view',
      status: 'pass',
      detail: 'No loans on the register.',
      figures: [],
      items: [],
    };
  }
  const items: string[] = [];
  for (const loan of f.loans) {
    if (loan.unpostedDueCount > 0) {
      items.push(
        `${loan.lenderName} — ${loan.unpostedDueCount} scheduled payment(s) due by year-end were never posted or skipped`
      );
    }
    if (loan.scheduleVsGlCents != null && loan.scheduleVsGlCents !== 0) {
      items.push(
        `${loan.lenderName} — schedule and GL disagree by ${money(Math.abs(loan.scheduleVsGlCents))}`
      );
    }
    if (loan.scheduleVsStatementCents != null && loan.scheduleVsStatementCents !== 0) {
      items.push(
        `${loan.lenderName} — schedule and the recorded lender statement balance disagree by ${money(Math.abs(loan.scheduleVsStatementCents))}`
      );
    }
    for (const d of loan.shareholderDeadlines) {
      if (d.daysRemaining <= 365) {
        items.push(
          d.daysRemaining < 0
            ? `${loan.lenderName} — s.15(2): advance of ${d.advanceDate} (${money(d.outstandingCents)} outstanding) passed its ${d.deadline} repayment deadline`
            : `${loan.lenderName} — s.15(2): advance of ${d.advanceDate} (${money(d.outstandingCents)} outstanding) must be repaid by ${d.deadline}`
        );
      }
    }
  }
  if (items.length === 0) {
    return {
      id: 'loans_tie_out',
      label: 'Loans tie to the ledger; shareholder deadlines in view',
      status: 'pass',
      detail: 'Every loan schedule ties to its GL account at year-end, all due payments are posted, and no s.15(2) deadline falls in the next 12 months.',
      figures: [{ label: 'Loans', value: String(f.loans.length) }],
      items: [],
    };
  }
  return {
    id: 'loans_tie_out',
    label: 'Loans tie to the ledger; shareholder deadlines in view',
    status: 'warn',
    detail: 'One or more loans need attention before the return is prepared — see the items below. The schedules and proofs are in the package either way.',
    figures: [{ label: 'Loans', value: String(f.loans.length) }],
    items,
  };
}

function checkFixedAssets(f: YearEndFacts): PreflightCheck {
  const a = f.fixedAssets;
  if (a.assetCount === 0) {
    return {
      id: 'fixed_assets_facts',
      label: 'Asset register tax facts complete',
      status: 'pass',
      detail: 'The asset register is empty — nothing to feed Schedule 8.',
      figures: [],
      items: [],
    };
  }
  const figures: PreflightFigure[] = [
    { label: 'Assets on the register', value: String(a.assetCount) },
    { label: 'Register additions in the year', value: money(a.registerAdditionsCents) },
  ];
  if (a.glAdditionsCents != null) {
    figures.push({ label: 'Additions posted to the asset accounts', value: money(a.glAdditionsCents) });
  }
  if (a.bookVsLedgerDifferenceCents != null) {
    figures.push({ label: 'Book depreciation vs ledger difference', value: money(a.bookVsLedgerDifferenceCents) });
  }
  if (a.unmodelledClass.length > 0) {
    return {
      id: 'fixed_assets_facts',
      label: 'Asset register tax facts complete',
      status: 'block',
      detail:
        'An asset carries a CCA class Nexvar Tax does not model — its Schedule 8 feed would be wrong. Fix the class on the asset before filing.',
      figures,
      items: a.unmodelledClass.map((x) => `${x.description} — class "${x.ccaClass}" is not modelled`),
    };
  }
  const items: string[] = [
    ...a.missingGlMapping.map((d) => `${d} — no GL asset account mapped`),
    ...a.afuBeforeAcquisition.map(
      (d) => `${d} — available-for-use date is before the acquisition date`
    ),
  ];
  if (
    a.glAdditionsCents != null &&
    Math.abs(a.registerAdditionsCents - a.glAdditionsCents) > 1
  ) {
    items.push(
      `Register additions (${money(a.registerAdditionsCents)}) and the additions posted to the asset accounts (${money(a.glAdditionsCents)}) differ — a capital purchase may be expensed in the books or missing from the register`
    );
  }
  if (a.bookVsLedgerDifferenceCents != null && a.bookVsLedgerDifferenceCents !== 0) {
    items.push(
      `Register book depreciation and the amortization expense in the trial balance differ by ${money(Math.abs(a.bookVsLedgerDifferenceCents))}`
    );
  }
  if (a.unpostedDepreciationCents > 0) {
    items.push(
      `Book depreciation of ${money(a.unpostedDepreciationCents)} is computed for the year but not yet posted`
    );
  }
  if (items.length === 0) {
    return {
      id: 'fixed_assets_facts',
      label: 'Asset register tax facts complete',
      status: 'pass',
      detail: 'Every asset carries a modelled CCA class and an available-for-use date, register additions agree with the asset accounts, and book depreciation ties to the ledger.',
      figures,
      items: [],
    };
  }
  return {
    id: 'fixed_assets_facts',
    label: 'Asset register tax facts complete',
    status: 'warn',
    detail: 'The register feeds Schedule 8, but the items below should be reviewed first.',
    figures,
    items,
  };
}

function checkGst(f: YearEndFacts): PreflightCheck {
  if (!f.gst.registrationPresent) {
    return {
      id: 'gst_periods_filed',
      label: 'GST/HST periods filed or worksheet-complete',
      status: 'not_checked',
      detail:
        'No GST/HST registration is on file for this company, so its filing periods cannot be enumerated or checked. Add the registration in Tax Setup if the company is registered.',
      figures: [],
      items: [],
    };
  }
  const due = f.gst.periods.filter((p) => p.due);
  const unfiled = due.filter((p) => !p.filed);
  const figures: PreflightFigure[] = [
    { label: 'Periods overlapping the year', value: String(f.gst.periods.length) },
    { label: 'Due by year-end', value: String(due.length) },
    { label: 'Filed (confirmation recorded)', value: String(due.length - unfiled.length) },
  ];
  if (unfiled.length === 0) {
    return {
      id: 'gst_periods_filed',
      label: 'GST/HST periods filed or worksheet-complete',
      status: 'pass',
      detail: 'Every GST/HST period due by year-end has a filing recorded with its CRA confirmation number.',
      figures,
      items: [],
    };
  }
  return {
    id: 'gst_periods_filed',
    label: 'GST/HST periods filed or worksheet-complete',
    status: 'warn',
    detail:
      'The period(s) below ended in this fiscal year but have no filing recorded. Their worksheets are in the package; record the filing (with the CRA confirmation number) once each return is filed.',
    figures,
    items: unfiled.map((p) => `${p.start} to ${p.end} — no filing recorded`),
  };
}

function checkBank(f: YearEndFacts): PreflightCheck {
  if (f.bank.accounts === null) {
    return {
      id: 'bank_reconciled',
      label: 'Bank accounts reconciled to year-end',
      status: 'not_checked',
      detail: 'This company has no bank or credit-card accounts set up in LedgerPro, so there is nothing to reconcile here.',
      figures: [],
      items: [],
    };
  }
  const fyEnd = f.fiscalYear.end;
  const behind = f.bank.accounts.filter((a) => a.reconciledThrough === null || a.reconciledThrough < fyEnd);
  if (behind.length === 0) {
    return {
      id: 'bank_reconciled',
      label: 'Bank accounts reconciled to year-end',
      status: 'pass',
      detail: 'Every bank and credit-card account is reconciled through the fiscal year end.',
      figures: f.bank.accounts.map((a) => ({ label: a.name, value: `reconciled through ${a.reconciledThrough}` })),
      items: [],
    };
  }
  return {
    id: 'bank_reconciled',
    label: 'Bank accounts reconciled to year-end',
    status: 'warn',
    detail: 'The account(s) below are not reconciled through the fiscal year end — balances after that date are not yet proven against a statement.',
    figures: f.bank.accounts.map((a) => ({
      label: a.name,
      value: a.reconciledThrough ? `reconciled through ${a.reconciledThrough}` : 'never reconciled',
    })),
    items: behind.map(
      (a) => `${a.name} — reconciled through ${a.reconciledThrough ?? 'never'} (year-end ${fyEnd})`
    ),
  };
}

function checkPayroll(f: YearEndFacts): PreflightCheck {
  // The T4 summary vs PD7A tie-out lives in Nexvar Pay — a separate
  // product and database. LedgerPro holds only the payroll journals
  // posted into these books (they are in the package's payroll
  // section); the tie-out itself cannot be checked from here, and the
  // cover sheet says so instead of implying it was verified.
  return {
    id: 'payroll_tie_out',
    label: 'Payroll T4 / PD7A tie-out',
    status: 'not_checked',
    detail: f.payroll.notCheckedReason,
    figures: [],
    items: [],
  };
}

/** Run every pre-flight check over the assembled facts. Never silent: a check whose data source does not exist returns not_checked with the reason. */
export function evaluatePreflight(facts: YearEndFacts): CoverSheet {
  const checks = [
    checkTrialBalance(facts),
    checkGifi(facts),
    checkSuspense(facts),
    checkPeriodLock(facts),
    checkLoans(facts),
    checkFixedAssets(facts),
    checkGst(facts),
    checkBank(facts),
    checkPayroll(facts),
  ];
  const summary: CoverSheetSummary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    block: checks.filter((c) => c.status === 'block').length,
    notChecked: checks.filter((c) => c.status === 'not_checked').length,
    overall: checks.some((c) => c.status === 'block')
      ? 'block'
      : checks.some((c) => c.status === 'warn')
        ? 'warn'
        : 'pass',
  };
  return { checks, summary };
}

// ── Package assembly ─────────────────────────────────────────────────

export interface LoanPackageInput {
  loanId: string;
  kind: string;
  status: string;
  lenderName: string;
  purpose: string | null;
  principalCents: number;
  annualRatePct: number;
  startDate: string;
  loanAccountCode: string;
  schedule: {
    period: number;
    date: string;
    openingCents: number;
    paymentCents: number;
    interestCents: number;
    principalCents: number;
    closingCents: number;
    /** LoanPayment status for term loans; null for shareholder advance ledgers. */
    status: string | null;
  }[];
  fiscalYearTotals: {
    label: string;
    start: string;
    end: string;
    interestCents: number;
    principalCents: number;
    paymentsCents: number;
    paymentCount: number;
  }[];
  proof: {
    asOf: string;
    scheduleBalanceCents: number;
    glBalanceCents: number | null;
    statementBalanceCents: number | null;
    statementBalanceDate: string | null;
    scheduleVsGlCents: number | null;
    scheduleVsStatementCents: number | null;
    tiesOut: boolean;
  } | null;
  shareholder: {
    balanceCents: number;
    deadlines: {
      advanceDate: string;
      advanceAmountCents: number;
      outstandingCents: number;
      deadline: string;
      daysRemaining: number;
      level: string | null;
    }[];
    seriesFlags: {
      repaymentDate: string;
      repaymentCents: number;
      advanceDate: string;
      advanceCents: number;
      gapDays: number;
      message: string;
    }[];
    advances: { date: string; kind: string; amountCents: number; notes: string | null }[];
  } | null;
}

export interface PayrollPackageInput {
  /** 'ledgerpro_journals' when Nexvar Pay journals reached these books; otherwise the explicit empty slot. */
  status: 'ledgerpro_journals' | 'no_payroll_journals';
  /** Original (non-reversal) payroll runs posted into these books in the year. */
  runCount: number;
  /** Per-account totals of ALL payroll-source journal lines in the year (reversals included — they net). */
  accounts: { code: string; name: string; debitCents: number; creditCents: number }[];
  /** What the preparer attaches from Nexvar Pay — always stated, never implied present. */
  attachFromNexvarPay: string[];
}

export interface BuildYearEndPackageInput {
  companyId: string;
  companyName: string;
  bn: string;
  gstNumber: string | null;
  fiscalYear: { start: string; end: string; label: string };
  /** ISO timestamp — part of the hashed payload, as in tb-gifi/1's postedThrough. */
  generatedAt: string;
  coverSheet: CoverSheet;
  mappingHealth: {
    total: number;
    coded: number;
    undecidedCount: number;
    decidedUnmappedCount: number;
    /** Percent of countable accounts coded; null when there are no countable accounts. */
    scorePct: number | null;
  };
  trialBalance: {
    current: TbGifiPayload;
    priorYear: TbGifiPayload | null;
  };
  glDetail: {
    accounts: {
      code: string;
      name: string;
      type: string;
      openingCents: number;
      debitCents: number;
      creditCents: number;
      closingCents: number;
    }[];
    journalSummaryBySource: { source: string; entryCount: number; debitCents: number }[];
  };
  /** The cca-register/1 payload, embedded whole; null when the register assembly was unavailable. */
  ccaRegister: (Record<string, unknown> & { hash: string }) | null;
  loans: LoanPackageInput[];
  /** One gst-worksheet/1 payload per filing period overlapping the year. */
  gstWorksheets: {
    periodStart: string;
    periodEnd: string;
    payload: Record<string, unknown> & { hash: string };
  }[];
  payroll: PayrollPackageInput;
}

export interface BuildYearEndPackageResult {
  payload: Record<string, unknown> & { hash: string };
  summary: CoverSheetSummary;
}

export function buildYearEndPackagePayload(
  input: BuildYearEndPackageInput
): BuildYearEndPackageResult {
  const coverSheet = {
    overall: input.coverSheet.summary.overall,
    counts: {
      pass: input.coverSheet.summary.pass,
      warn: input.coverSheet.summary.warn,
      block: input.coverSheet.summary.block,
      notChecked: input.coverSheet.summary.notChecked,
    },
    mappingHealth: {
      accountsCounted: input.mappingHealth.total,
      coded: input.mappingHealth.coded,
      undecided: input.mappingHealth.undecidedCount,
      unmappedByChoice: input.mappingHealth.decidedUnmappedCount,
      scorePct: input.mappingHealth.scorePct,
    },
    checks: input.coverSheet.checks.map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      detail: c.detail,
      figures: c.figures,
      items: c.items,
    })),
  };

  const withoutHash = {
    contractVersion: YEAR_END_PACKAGE_CONTRACT_VERSION,
    companyId: input.companyId,
    companyName: input.companyName,
    bn: input.bn,
    gstNumber: input.gstNumber,
    fiscalYearStart: input.fiscalYear.start,
    fiscalYearEnd: input.fiscalYear.end,
    fiscalYearLabel: input.fiscalYear.label,
    generatedAt: input.generatedAt,
    coverSheet,
    trialBalance: {
      current: input.trialBalance.current,
      // The comparative: the prior fiscal year's own tb-gifi/1
      // payload (with its own hash), or null for a first-year company.
      priorYear: input.trialBalance.priorYear,
    },
    glDetail: {
      accounts: input.glDetail.accounts.map((a) => ({
        code: a.code,
        name: a.name,
        type: a.type,
        opening: money(a.openingCents),
        debits: money(a.debitCents),
        credits: money(a.creditCents),
        closing: money(a.closingCents),
      })),
      journalSummaryBySource: input.glDetail.journalSummaryBySource.map((s) => ({
        source: s.source,
        entryCount: s.entryCount,
        debits: money(s.debitCents),
      })),
    },
    ccaRegister: input.ccaRegister,
    loans: input.loans.map((l) => ({
      loanId: l.loanId,
      kind: l.kind,
      status: l.status,
      lenderName: l.lenderName,
      purpose: l.purpose,
      principal: money(l.principalCents),
      annualRatePct: l.annualRatePct,
      startDate: l.startDate,
      loanAccountCode: l.loanAccountCode,
      schedule: l.schedule.map((r) => ({
        period: r.period,
        date: r.date,
        opening: money(r.openingCents),
        payment: money(r.paymentCents),
        interest: money(r.interestCents),
        principal: money(r.principalCents),
        closing: money(r.closingCents),
        status: r.status,
      })),
      fiscalYearTotals: l.fiscalYearTotals.map((t) => ({
        label: t.label,
        start: t.start,
        end: t.end,
        interest: money(t.interestCents),
        principal: money(t.principalCents),
        payments: money(t.paymentsCents),
        paymentCount: t.paymentCount,
      })),
      proof: l.proof
        ? {
            asOf: l.proof.asOf,
            scheduleBalance: money(l.proof.scheduleBalanceCents),
            glBalance: l.proof.glBalanceCents != null ? money(l.proof.glBalanceCents) : null,
            statementBalance:
              l.proof.statementBalanceCents != null ? money(l.proof.statementBalanceCents) : null,
            statementBalanceDate: l.proof.statementBalanceDate,
            scheduleVsGl: l.proof.scheduleVsGlCents != null ? money(l.proof.scheduleVsGlCents) : null,
            scheduleVsStatement:
              l.proof.scheduleVsStatementCents != null ? money(l.proof.scheduleVsStatementCents) : null,
            tiesOut: l.proof.tiesOut,
          }
        : null,
      shareholder: l.shareholder
        ? {
            balance: money(l.shareholder.balanceCents),
            deadlines: l.shareholder.deadlines.map((d) => ({
              advanceDate: d.advanceDate,
              advanceAmount: money(d.advanceAmountCents),
              outstanding: money(d.outstandingCents),
              deadline: d.deadline,
              daysRemaining: d.daysRemaining,
              level: d.level,
            })),
            seriesFlags: l.shareholder.seriesFlags.map((s) => ({
              repaymentDate: s.repaymentDate,
              repayment: money(s.repaymentCents),
              advanceDate: s.advanceDate,
              advance: money(s.advanceCents),
              gapDays: s.gapDays,
              message: s.message,
            })),
            advances: l.shareholder.advances.map((a) => ({
              date: a.date,
              kind: a.kind,
              amount: money(a.amountCents),
              notes: a.notes,
            })),
          }
        : null,
    })),
    gstWorksheets: input.gstWorksheets,
    payroll: {
      status: input.payroll.status,
      source:
        input.payroll.status === 'ledgerpro_journals'
          ? 'Payroll journals posted into LedgerPro from Nexvar Pay during the fiscal year. T4/T4A data and the PD7A tie-out live in Nexvar Pay and are NOT in this package.'
          : 'No payroll journals were posted into LedgerPro for this fiscal year. If the company runs payroll, its year-end payroll package comes from Nexvar Pay — attach the items listed below.',
      runCount: input.payroll.runCount,
      accounts: input.payroll.accounts.map((a) => ({
        code: a.code,
        name: a.name,
        debits: money(a.debitCents),
        credits: money(a.creditCents),
      })),
      attachFromNexvarPay: input.payroll.attachFromNexvarPay,
    },
  };

  return {
    payload: { ...withoutHash, hash: canonicalPayloadHash(withoutHash) },
    summary: input.coverSheet.summary,
  };
}
