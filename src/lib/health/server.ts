/**
 * Books health — server side: assemble the facts for one company and
 * run the deterministic radar (src/lib/health/engine.ts).
 *
 * Every figure comes from the module that already owns it — nothing
 * here recomputes a number another module is responsible for:
 *  - GIFI coding state: computeGifiReadiness (Phase 1 item 1).
 *  - Account balances / activity: getGLActivity, the same source the
 *    trial balance and the year-end package read.
 *  - Suspense identification: the year-end package's rule (an active
 *    account whose name matches suspense|unidentified|clearing) with a
 *    non-zero GL balance.
 *  - Loan proofs: balanceProof from the loan tool (Phase 1 item 3) —
 *    the same three-way proof the loan page shows.
 *  - s.15(2) deadlines: advanceDeadlines from the shareholder module.
 *  - GST filed state: computeGstReturn's `filed` verdict (Phase 1
 *    item 6), over periods enumerated with the registration's own
 *    anchoring — the same anchoring the year-end server uses.
 *
 * Dismissals are the only persisted state (HealthFlagDismissal): a
 * reviewer silences one fingerprint with a reason, and the flag stays
 * gone until the underlying item changes its fingerprint.
 */

import { db } from '@/lib/db';
import { endOfDay, getGLActivity, parseLocalDate } from '@/lib/reporting';
import { computeGifiReadiness } from '@/lib/gifi-readiness';
import { fiscalContextOf, toAdvanceEvents } from '@/lib/loans/present';
import { balanceProof, dateToYmd } from '@/lib/loans/server';
import { advanceDeadlines } from '@/lib/loans/shareholder';
import { toCents } from '@/lib/loans/engine';
import { computeGstReturn } from '@/lib/tax/gst-return-service';
import {
  evaluateHealth,
  partitionDismissals,
  type DismissedHealthFlag,
  type HealthDismissal,
  type HealthFacts,
  type HealthReport,
} from './engine';

/** Payments / journal lines / volumes are judged over the last 12 months. */
export const HEALTH_LOOKBACK_DAYS = 365;
/** GST: check at most this many recently-ended periods (2 years of monthly). */
const GST_MAX_PERIODS = 24;

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The GST filing period containing `dateStr`, under the registration's
 *  anchoring — identical rules to src/lib/year-end/server.ts. */
function gstPeriodContaining(
  registration: { filingFrequency: string; validFrom: Date },
  dateStr: string
): { start: string; end: string } {
  const [y, m] = dateStr.split('-').map(Number);
  const am = registration.validFrom.getUTCMonth() + 1;
  const ad = registration.validFrom.getUTCDate();
  if (registration.filingFrequency === 'monthly') {
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (registration.filingFrequency === 'quarterly') {
    const idx = y * 12 + (m - 1);
    const anchorIdx = registration.validFrom.getUTCFullYear() * 12 + (am - 1);
    const offset = (((idx - anchorIdx) % 3) + 3) % 3;
    const startIdx = idx - offset;
    const start = new Date(Date.UTC(Math.floor(startIdx / 12), startIdx % 12, 1));
    const end = new Date(Date.UTC(Math.floor((startIdx + 3) / 12), (startIdx + 3) % 12, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  const anchorMd = `${String(am).padStart(2, '0')}-${String(ad).padStart(2, '0')}`;
  const startThisYear = `${y}-${anchorMd}`;
  const start = dateStr >= startThisYear ? startThisYear : `${y - 1}-${anchorMd}`;
  const startDate = new Date(`${start}T00:00:00Z`);
  startDate.setUTCFullYear(startDate.getUTCFullYear() + 1);
  return { start, end: addDaysYmd(startDate.toISOString().slice(0, 10), -1) };
}

/** Every period from the registration's start through `asOf`, oldest first. */
function enumerateGstPeriodsThrough(
  registration: { filingFrequency: string; validFrom: Date },
  asOf: string
): { start: string; end: string }[] {
  const periods: { start: string; end: string }[] = [];
  let period = gstPeriodContaining(registration, dateToYmd(registration.validFrom));
  for (let i = 0; i < 120; i++) {
    periods.push(period);
    const nextStart = addDaysYmd(period.end, 1);
    if (nextStart > asOf) break;
    period = gstPeriodContaining(registration, nextStart);
  }
  return periods;
}

export interface AssembledBooksHealth {
  companyName: string;
  report: HealthReport;
  dismissed: DismissedHealthFlag[];
}

export async function assembleBooksHealth(
  companyId: string,
  asOfYmd?: string
): Promise<AssembledBooksHealth> {
  const asOf = asOfYmd ?? new Date().toISOString().slice(0, 10);
  const lookbackStart = addDaysYmd(asOf, -HEALTH_LOOKBACK_DAYS);
  const asOfDate = endOfDay(parseLocalDate(asOf));
  const lookbackDate = parseLocalDate(lookbackStart);

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { name: true, fiscalYearStart: true, firstFiscalYearEnd: true },
  });
  if (!company) throw new Error('Company not found');

  // ── Chart of accounts, GIFI readiness, GL balances/activity ──
  const accounts = await db.chartOfAccount.findMany({
    where: { companyId },
    orderBy: { code: 'asc' },
  });
  const activeAccounts = accounts.filter((a) => a.active);
  const readiness = computeGifiReadiness(
    activeAccounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subType: a.subType,
      detailType: a.detailType,
      gifiCode: a.gifiCode,
      gifiUnmappedByChoice: a.gifiUnmappedByChoice,
      active: a.active,
    }))
  );
  const needsCodeByCode = new Map(readiness.needsCode.map((a) => [a.code, a.status]));
  const decidedUnmappedCodes = new Set(readiness.decidedUnmapped.map((a) => a.code));

  const [activityThrough, activityLookback] = await Promise.all([
    getGLActivity(companyId, { to: asOfDate }),
    getGLActivity(companyId, { from: lookbackDate, to: asOfDate }),
  ]);
  const signedCents = (
    activity: Record<string, { debits: number; credits: number }>,
    code: string
  ) => {
    const a = activity[code];
    return a ? Math.round((a.debits - a.credits) * 100) : 0;
  };
  const activityCents = (code: string) => {
    const a = activityLookback[code];
    return a ? Math.round((Math.abs(a.debits) + Math.abs(a.credits)) * 100) : 0;
  };

  const accountFacts: HealthFacts['accounts'] = activeAccounts.map((a) => ({
    code: a.code,
    name: a.name,
    balanceCents: signedCents(activityThrough, a.code),
    activityCents: activityCents(a.code),
    gifiStatus: needsCodeByCode.has(a.code)
      ? needsCodeByCode.get(a.code) === 'invalid'
        ? 'invalid'
        : 'undecided'
      : decidedUnmappedCodes.has(a.code)
        ? 'decided_unmapped'
        : 'coded',
  }));

  // Suspense/clearing — the year-end package's identification rule.
  const suspense: HealthFacts['suspense'] = activeAccounts
    .filter((a) => /suspense|unidentified|clearing/i.test(a.name))
    .map((a) => ({ code: a.code, name: a.name, balanceCents: signedCents(activityThrough, a.code) }))
    .filter((a) => a.balanceCents !== 0);

  // ── Journal entries + lines (voided originals and reversal entries
  //    excluded — a void pair is a correction, not a duplicate) ──
  const entries = await db.journalEntry.findMany({
    where: {
      companyId,
      voidedAt: null,
      reversalOfId: null,
      entryDate: { gte: lookbackDate, lte: asOfDate },
    },
    include: { lines: true },
    orderBy: { entryDate: 'asc' },
  });
  const journalLines: HealthFacts['journalLines'] = [];
  for (const entry of entries) {
    for (const line of entry.lines) {
      journalLines.push({
        id: line.id,
        entryId: entry.id,
        entryDate: dateToYmd(entry.entryDate),
        entryDescription: entry.description,
        glAccountCode: line.glAccountCode,
        description: line.description,
        debitCents: toCents(Number(line.debit)),
        creditCents: toCents(Number(line.credit)),
      });
    }
  }

  // ── Bank transactions: payments out + the uncategorized backlog ──
  const financialAccounts = await db.financialAccount.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true, lockedThrough: true },
    orderBy: { name: 'asc' },
  });
  const accountNameById = new Map(financialAccounts.map((a) => [a.id, a.name]));
  const transactions = await db.transaction.findMany({
    where: {
      companyId,
      date: { gte: lookbackDate, lte: asOfDate },
      status: { notIn: ['voided', 'excluded', 'transfer'] },
    },
    select: {
      id: true,
      financialAccountId: true,
      date: true,
      description: true,
      merchant: true,
      payeeGuess: true,
      amount: true,
      amountHome: true,
      categoryId: true,
      status: true,
    },
    orderBy: { date: 'asc' },
  });
  const payments: HealthFacts['payments'] = [];
  const uncategorized: HealthFacts['uncategorized'] = [];
  for (const t of transactions) {
    const homeCents = toCents(Number(t.amountHome ?? t.amount));
    if (homeCents < 0) {
      const payee = t.merchant || t.payeeGuess || t.description;
      payments.push({
        id: t.id,
        date: dateToYmd(t.date),
        payee,
        description: t.description,
        amountCents: -homeCents,
        accountName: accountNameById.get(t.financialAccountId) ?? 'Bank account',
      });
    }
    if (t.status === 'toreview' && !t.categoryId) {
      uncategorized.push({
        id: t.id,
        date: dateToYmd(t.date),
        description: t.description,
        amountCents: homeCents,
      });
    }
  }
  // ── Bank reconciliation state (same rule as the year-end package) ──
  const completedRecs = financialAccounts.length
    ? await db.reconciliation.findMany({
        where: {
          companyId,
          financialAccountId: { in: financialAccounts.map((a) => a.id) },
          state: { in: ['locked', 'closed_with_variance'] },
        },
        select: { financialAccountId: true, periodEnd: true },
      })
    : [];
  const bankAccounts: HealthFacts['bankAccounts'] = [];
  for (const acct of financialAccounts) {
    const throughs = completedRecs
      .filter((r) => r.financialAccountId === acct.id)
      .map((r) => dateToYmd(r.periodEnd));
    if (acct.lockedThrough) throughs.push(dateToYmd(acct.lockedThrough));
    throughs.sort();
    const txCount = await db.transaction.count({
      where: { companyId, financialAccountId: acct.id, status: { not: 'voided' } },
    });
    bankAccounts.push({
      id: acct.id,
      name: acct.name,
      reconciledThrough: throughs[throughs.length - 1] ?? null,
      hasTransactions: txCount > 0,
    });
  }

  // ── Loans: three-way proof + s.15(2) deadlines ──
  const ctx = fiscalContextOf(company);
  const loans = await db.loan.findMany({
    where: { companyId },
    include: {
      payments: { orderBy: { periodNumber: 'asc' } },
      advances: { orderBy: { advanceDate: 'asc' } },
    },
    orderBy: { startDate: 'asc' },
  });
  const loanFacts: HealthFacts['loans'] = [];
  for (const loan of loans) {
    if (loan.status !== 'active') continue;
    const proof = await balanceProof(loan, loan.payments, asOf);
    const proofDifferences: HealthFacts['loans'][number]['proofDifferences'] = [];
    if (proof.scheduleVsGlCents !== null && proof.scheduleVsGlCents !== 0) {
      proofDifferences.push({
        leg: 'schedule_vs_gl',
        scheduleCents: proof.scheduleBalanceCents,
        otherCents: proof.glBalanceCents ?? 0,
        differenceCents: proof.scheduleVsGlCents,
      });
    }
    if (proof.scheduleVsStatementCents !== null && proof.scheduleVsStatementCents !== 0) {
      proofDifferences.push({
        leg: 'schedule_vs_statement',
        scheduleCents: proof.scheduleBalanceCents,
        otherCents: proof.statementBalanceCents ?? 0,
        differenceCents: proof.scheduleVsStatementCents,
      });
    }
    // s.15(2) deadlines exist only where the corporation lent TO the
    // shareholder (shareholder_advance) — the year-end server's rule.
    let deadlines: HealthFacts['loans'][number]['deadlines'] = [];
    if (loan.kind === 'shareholder_advance') {
      deadlines = advanceDeadlines(toAdvanceEvents(loan.advances), ctx.anchor, asOf, ctx.firstYear)
        .filter((d) => d.outstandingCents > 0)
        .map((d) => ({
          advanceDate: d.advance.date,
          deadline: d.deadline,
          daysRemaining: d.daysRemaining,
          outstandingCents: d.outstandingCents,
        }));
    }
    loanFacts.push({
      id: loan.id,
      lenderName: loan.lenderName,
      kind: loan.kind,
      proofDifferences,
      deadlines,
    });
  }

  // ── GST/HST: ended periods with no filing recorded ──
  const registration = await db.companyTaxRegistration.findFirst({
    where: { companyId, regime: 'gst_hst', active: true },
    orderBy: { validFrom: 'desc' },
    select: { filingFrequency: true, validFrom: true },
  });
  const gst: HealthFacts['gst'] = { registrationPresent: !!registration, unfiledPeriods: [] };
  if (registration) {
    const ended = enumerateGstPeriodsThrough(registration, asOf)
      .filter((p) => p.end < asOf)
      .slice(-GST_MAX_PERIODS);
    for (const period of ended) {
      const view = await computeGstReturn(companyId, period.start, period.end);
      if (!view.filed) gst.unfiledPeriods.push(period);
    }
  }

  const facts: HealthFacts = {
    asOf,
    payments,
    journalLines,
    accounts: accountFacts,
    suspense,
    uncategorized,
    bankAccounts,
    loans: loanFacts,
    gst,
  };

  const dismissals = new Map<string, HealthDismissal>(
    (
      await db.healthFlagDismissal.findMany({
        where: { companyId },
        select: { fingerprint: true, reason: true, createdAt: true },
      })
    ).map((d) => [
      d.fingerprint,
      { fingerprint: d.fingerprint, reason: d.reason, dismissedAt: d.createdAt.toISOString() },
    ])
  );

  const { report, dismissed } = partitionDismissals(evaluateHealth(facts), dismissals);
  return { companyName: company.name, report, dismissed };
}

/** Dismiss one flag for a company. The fingerprint must carry a known
 *  rule prefix; the reason is the reviewer's own words, kept on record. */
export async function dismissHealthFlag(input: {
  companyId: string;
  userId: string | null;
  fingerprint: string;
  reason: string;
}): Promise<void> {
  const ruleId = input.fingerprint.split(':')[0] ?? '';
  await db.healthFlagDismissal.upsert({
    where: {
      companyId_fingerprint: { companyId: input.companyId, fingerprint: input.fingerprint },
    },
    create: {
      companyId: input.companyId,
      fingerprint: input.fingerprint,
      ruleId,
      reason: input.reason,
      dismissedBy: input.userId,
    },
    update: { reason: input.reason, dismissedBy: input.userId },
  });
}

/** Bring a dismissed flag back. */
export async function restoreHealthFlag(companyId: string, fingerprint: string): Promise<void> {
  await db.healthFlagDismissal.deleteMany({ where: { companyId, fingerprint } });
}
