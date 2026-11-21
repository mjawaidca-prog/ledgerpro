/**
 * Cash-flow outlook — server side: assemble the facts for one company
 * and run the pure projection (src/lib/cashflow/engine.ts).
 *
 * Every figure comes from the module or record that already owns it —
 * nothing here recomputes a number another module is responsible for:
 *  - Opening balances: FinancialAccount.currentBalance, the app's own
 *    per-account balance (bank kinds only — a credit card's balance
 *    is money owing, not a bank position).
 *  - Invoices / bills: open subledger rows; outstanding uses the
 *    codebase's own home-currency convention from src/lib/journal.ts,
 *    (totalHome ?? total) − paidAmountHome.
 *  - Loans: the LoanPayment schedule rows the loan tool generated
 *    from its amortization engine (Phase 1 item 3) — scheduled rows
 *    of active term loans only.
 *  - Recurring templates: only the template's bank leg counts (lines
 *    on GL accounts linked to a bank-kind FinancialAccount); a
 *    template with no bank line moves no cash when it posts.
 *  - Payroll: JournalEntry rows with sourceType 'payroll' (posted by
 *    Nexvar Pay's sync), decomposed into pay-date vs source-deduction
 *    portions by classifying each credit line against the company's
 *    own chart — credits to payroll-liability accounts (CPP / EI /
 *    income tax payable and their kin) are the remittance; wages
 *    payable and everything else leaves around pay day.
 *  - Remittance-paid evidence: for a month whose remittance due date
 *    has passed, a non-payroll journal in the payment window that
 *    debits those same liability accounts for at least 80% of the
 *    month's deductions marks the month paid, so it is not projected
 *    as still owing.
 *  - GST/HST: computeGstReturn (the GST module, Phase 1 item 6) over
 *    unfiled periods enumerated with the registration's own anchoring
 *    — the same anchoring src/lib/health/server.ts uses.
 */

import { db } from '@/lib/db';
import { parseLocalDate } from '@/lib/reporting';
import { toCents } from '@/lib/loans/engine';
import { dateToYmd } from '@/lib/loans/server';
import { computeGstReturn } from '@/lib/tax/gst-return-service';
import {
  addDays,
  buildCashflowOutlook,
  mondayOf,
  OUTLOOK_WEEKS,
  type CashflowFacts,
  type CashflowOutlook,
  type CashflowPayrollRunFact,
} from './engine';

const BANK_KINDS = ['checking', 'savings', 'cash', 'payoutclearing'] as const;
/** How far back payroll journals are read for cadence + remittance grouping. */
const PAYROLL_LOOKBACK_DAYS = 190;
/** GST periods ending this far before the window can still owe a
 *  payment inside it (annual filers especially) — include them. */
const GST_PERIOD_LOOKBACK_DAYS = 62;

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── GST period anchoring (same rules as src/lib/health/server.ts) ──

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

// ─── Payroll decomposition ──────────────────────────────────────────

interface ChartLite {
  name: string;
  detailType: string | null;
}

/** Is a credit to this account a CRA source-deduction amount (CPP /
 *  EI / income tax and kin) rather than pay-date money? Wages payable
 *  is the net pay — it leaves on pay day, so it is never a remittance
 *  even though it sits in the payroll-liabilities family. */
function isRemittanceAccount(account: ChartLite | undefined): boolean {
  if (!account) return false;
  const name = account.name.toLowerCase();
  if (/wages payable|net pay/.test(name)) return false;
  if (account.detailType === 'Payroll liabilities') return true;
  return /cpp|ei payable|income tax payable|payroll (liabilit|deduction|remittance)|source deduction/.test(name);
}

export interface AssembledCashflowOutlook {
  companyName: string;
  outlook: CashflowOutlook;
}

export async function assembleCashflowOutlook(
  companyId: string,
  asOfYmd?: string
): Promise<AssembledCashflowOutlook> {
  const asOf = asOfYmd ?? new Date().toISOString().slice(0, 10);
  const windowStart = mondayOf(asOf);
  const windowEnd = addDays(windowStart, OUTLOOK_WEEKS * 7 - 1);
  const windowEndDate = parseLocalDate(windowEnd);

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { name: true, legalName: true },
  });
  if (!company) throw new Error('Company not found');

  // ── Opening position: bank-kind financial accounts ──
  const financialAccounts = await db.financialAccount.findMany({
    where: { companyId, isActive: true },
    select: { name: true, kind: true, currentBalance: true, glAccountCode: true },
    orderBy: { name: 'asc' },
  });
  const bankAccounts = financialAccounts.filter((a) => (BANK_KINDS as readonly string[]).includes(a.kind));
  const bankGlCodes = new Set(
    bankAccounts.map((a) => a.glAccountCode).filter((c): c is string => !!c)
  );

  // ── Open invoices ──
  const invoices = await db.invoice.findMany({
    where: { companyId, status: { in: ['sent', 'overdue'] } },
    include: { customer: { select: { name: true, companyName: true } } },
    orderBy: { dueDate: 'asc' },
  });

  // ── Open bills ──
  const bills = await db.bill.findMany({
    where: { companyId, status: { in: ['open', 'overdue'] } },
    include: { vendor: { select: { name: true, companyName: true } } },
    orderBy: { dueDate: 'asc' },
  });

  // ── Scheduled loan payments (active term loans) ──
  const loanPayments = await db.loanPayment.findMany({
    where: {
      status: 'scheduled',
      dueDate: { lte: windowEndDate },
      loan: { companyId, status: 'active', kind: 'term' },
    },
    include: { loan: { select: { lenderName: true, purpose: true } } },
    orderBy: { dueDate: 'asc' },
  });

  // ── Recurring templates: net bank leg only ──
  const templates = await db.recurringTemplate.findMany({
    where: { companyId, active: true },
    include: { lines: true },
    orderBy: { name: 'asc' },
  });

  // ── Chart (for payroll decomposition) ──
  const chart = await db.chartOfAccount.findMany({
    where: { companyId },
    select: { code: true, name: true, detailType: true },
  });
  const chartByCode = new Map<string, ChartLite>(chart.map((a) => [a.code, a]));

  // ── Payroll journals (Nexvar Pay postings) ──
  const payrollSince = parseLocalDate(addDaysYmd(asOf, -PAYROLL_LOOKBACK_DAYS));
  const payrollEntries = await db.journalEntry.findMany({
    where: {
      companyId,
      sourceType: 'payroll',
      voidedAt: null,
      reversalOfId: null,
      entryDate: { gte: payrollSince },
    },
    include: { lines: true },
    orderBy: { entryDate: 'asc' },
  });
  const payrollRuns: CashflowPayrollRunFact[] = payrollEntries.map((entry) => {
    let totalCredits = 0;
    let remittance = 0;
    for (const line of entry.lines) {
      const credit = toCents(Number(line.credit));
      totalCredits += credit;
      if (credit > 0 && isRemittanceAccount(chartByCode.get(line.glAccountCode))) {
        remittance += credit;
      }
    }
    return {
      date: dateToYmd(entry.entryDate),
      payAmountCents: totalCredits - remittance,
      remittanceAmountCents: remittance,
    };
  });

  // ── Remittance-paid evidence ──
  // For each past-due remittance month, look for a non-payroll journal
  // in the payment window debiting the remittance accounts for at
  // least 80% of the month's deductions — the remittance payment.
  const remittancePaidMonths: string[] = [];
  {
    const byMonth = new Map<string, number>();
    for (const run of payrollRuns) {
      const mk = run.date.slice(0, 7);
      byMonth.set(mk, (byMonth.get(mk) ?? 0) + run.remittanceAmountCents);
    }
    const dueMonths = [...byMonth.entries()].filter(([, amount]) => amount > 0);
    if (dueMonths.length > 0) {
      const candidates = await db.journalEntry.findMany({
        where: {
          companyId,
          sourceType: { not: 'payroll' },
          voidedAt: null,
          reversalOfId: null,
          entryDate: { gte: payrollSince, lte: parseLocalDate(asOf) },
        },
        include: { lines: true },
      });
      const payments = candidates.map((entry) => {
        let remittanceDebits = 0;
        for (const line of entry.lines) {
          if (isRemittanceAccount(chartByCode.get(line.glAccountCode))) {
            remittanceDebits += toCents(Number(line.debit));
          }
        }
        return { date: dateToYmd(entry.entryDate), remittanceDebits };
      });
      for (const [mk, amount] of dueMonths) {
        const [y, m] = mk.split('-').map(Number);
        const dueIdx = y * 12 + (m - 1) + 1;
        const due = `${Math.floor(dueIdx / 12)}-${String((dueIdx % 12) + 1).padStart(2, '0')}-15`;
        if (due > asOf) continue; // not due yet — cannot have been paid early enough to matter
        const windowFrom = addDaysYmd(due, -10);
        const paid = payments.some(
          (p) => p.date >= windowFrom && p.date <= asOf && p.remittanceDebits >= Math.round(amount * 0.8)
        );
        if (paid) remittancePaidMonths.push(mk);
      }
    }
  }

  // ── GST/HST: unfiled periods with a net amount owing ──
  const registration = await db.companyTaxRegistration.findFirst({
    where: { companyId, regime: 'gst_hst', active: true },
    orderBy: { validFrom: 'desc' },
    select: { filingFrequency: true, validFrom: true },
  });
  const gstPeriods: CashflowFacts['gstPeriods'] = [];
  if (registration) {
    const earliestEnd = addDaysYmd(windowStart, -GST_PERIOD_LOOKBACK_DAYS);
    const periods = enumerateGstPeriodsThrough(registration, windowEnd).filter(
      (p) => p.end >= earliestEnd && p.end <= windowEnd
    );
    for (const period of periods) {
      const view = await computeGstReturn(companyId, period.start, period.end);
      if (view.filed) continue;
      const netOwing = view.result.lines['115'];
      if (netOwing > 0) {
        gstPeriods.push({
          periodStart: period.start,
          periodEnd: period.end,
          filingFrequency: registration.filingFrequency,
          netOwingCents: toCents(netOwing),
        });
      }
    }
  }

  const facts: CashflowFacts = {
    asOf,
    accounts: bankAccounts.map((a) => ({
      name: a.name,
      kind: a.kind,
      balanceCents: toCents(Number(a.currentBalance)),
    })),
    invoices: invoices
      .map((inv) => ({
        id: inv.id,
        customerName: inv.customer?.companyName || inv.customer?.name || 'Unknown customer',
        dueDate: dateToYmd(inv.dueDate),
        outstandingCents: toCents(Number(inv.totalHome ?? inv.total) - Number(inv.paidAmountHome)),
      }))
      .filter((i) => i.outstandingCents > 0),
    bills: bills
      .map((bill) => ({
        id: bill.id,
        vendorName: bill.vendor?.companyName || bill.vendor?.name || 'Unknown vendor',
        referenceNo: bill.referenceNo,
        dueDate: bill.dueDate ? dateToYmd(bill.dueDate) : null,
        outstandingCents: toCents(Number(bill.totalHome ?? bill.total) - Number(bill.paidAmountHome)),
      }))
      .filter((b) => b.outstandingCents > 0),
    loanPayments: loanPayments.map((p) => ({
      loanId: p.loanId,
      lenderName: p.loan.lenderName,
      purpose: p.loan.purpose,
      dueDate: dateToYmd(p.dueDate),
      amountCents: toCents(Number(p.paymentAmount)),
    })),
    recurring: templates
      .map((t) => {
        let bankAmountCents = 0;
        let hasBankLine = false;
        for (const line of t.lines) {
          if (!bankGlCodes.has(line.glAccountCode)) continue;
          hasBankLine = true;
          bankAmountCents += toCents(Number(line.debit)) - toCents(Number(line.credit));
        }
        return {
          templateId: t.id,
          name: t.name,
          frequency: t.frequency,
          nextPostDate: dateToYmd(t.nextPostDate),
          endDate: t.endDate ? dateToYmd(t.endDate) : null,
          bankAmountCents,
          hasBankLine,
        };
      })
      .filter((t) => t.hasBankLine && t.bankAmountCents !== 0)
      .map(({ hasBankLine: _hasBankLine, ...t }) => t),
    payrollRuns,
    remittancePaidMonths,
    gstRegistrationPresent: !!registration,
    gstPeriods,
  };

  return {
    companyName: company.legalName || company.name,
    outlook: buildCashflowOutlook(facts),
  };
}
