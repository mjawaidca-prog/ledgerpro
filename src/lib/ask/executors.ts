/**
 * Ask-your-books — executors (Phase 3 item 4, server).
 *
 * One executor per library intent. Every figure an executor returns
 * comes from the module that already owns that computation:
 *
 *  - spend / revenue: getGLActivity + normalBalance + netEarnings
 *    from src/lib/reporting.ts — the exact primitives the Profit &
 *    Loss report is built from (its per-period assembly is route-
 *    local; this is the same composition over the same primitives);
 *  - receivables: the AR aging report's own population and bucketing
 *    rule (open invoices, remaining = total − paid, days past due);
 *  - top customers / vendors: the invoice and bill subledgers the
 *    aging reports read;
 *  - GST/HST: computeGstReturn (the tax engine) and its worksheet —
 *    figures are read off the worksheet lines, never recomputed;
 *  - loans: termLoanSummary / shareholderSummary from the loan tool's
 *    presentation module — the same summaries the Loans pages show;
 *  - CCA: assembleCcaRegisterExport — the cca-register/1 assembly.
 *    Its figures are BOOK figures (capital cost, book depreciation,
 *    net book value). LedgerPro deliberately keeps no shadow tax
 *    UCC — that lives in Nexvar Tax — and the answer says so;
 *  - cash: the FinancialAccount balances the Banking pages show;
 *  - payroll: the payroll journal aggregation the year-end package
 *    performs (sourceType 'payroll' entries posted from Nexvar Pay).
 *
 * An executor may throw AskUnavailableError when the books cannot
 * answer yet (e.g. the CCA export needs a business number on file):
 * the service renders the reason as the answer — a fact about the
 * books, never a guessed figure.
 */

import { db } from '@/lib/db';
import { endOfDay, getGLActivity, netEarnings, normalBalance, parseLocalDate } from '@/lib/reporting';
import { N } from '@/lib/fx-format';
import { computeGstReturn } from '@/lib/tax/gst-return-service';
import { assembleCcaRegisterExport } from '@/lib/cca/server';
import { fiscalContextOf, shareholderSummary, termLoanSummary, type FiscalContext } from '@/lib/loans/present';
import { anchorMonthDay, firstFiscalYearOf } from '@/lib/fiscal-year';
import { comparisonPeriodOf, formatPeriodLabel, type PeriodContext, type ResolvedPeriod } from './periods';
import { intentById, type ValidatedParams } from './intents';

// ── Answer shape ─────────────────────────────────────────────────────

export interface AskFigure {
  label: string;
  amount: number;
}

export interface AskRow {
  label: string;
  detail?: string | null;
  amount: number;
}

export interface AskAnswer {
  intentId: string;
  title: string;
  headline: string;
  figures: AskFigure[];
  rows: AskRow[];
  /** How the figures were produced: report, period, filters. */
  workings: string;
  sourceReport: { label: string; href: string };
}

export class AskUnavailableError extends Error {}

export interface AskContext {
  companyId: string;
  today: string; // YYYY-MM-DD
  currency: string;
  periodCtx: PeriodContext;
}

export interface AskExecutorDeps {
  computeGstReturn: typeof computeGstReturn;
  assembleCcaRegisterExport: typeof assembleCcaRegisterExport;
}

export const defaultAskExecutorDeps: AskExecutorDeps = {
  computeGstReturn,
  assembleCcaRegisterExport,
};

export type AskExecutor = (
  ctx: AskContext,
  params: ValidatedParams,
  deps: AskExecutorDeps,
) => Promise<AskAnswer>;

// ── Helpers ──────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

export function money(amount: number, currency: string): string {
  const sign = amount < 0 ? '-' : '';
  const abs = N(Math.abs(amount));
  return currency === 'CAD' || currency === 'USD' ? `${sign}$${abs}` : `${sign}${currency} ${abs}`;
}

function baseAnswer(intentId: string): Pick<AskAnswer, 'intentId' | 'title' | 'sourceReport'> {
  const intent = intentById(intentId);
  return {
    intentId,
    title: intent?.title ?? intentId,
    sourceReport: intent?.sourceReport ?? { label: 'Reports', href: '/reports' },
  };
}

function periodOf(params: ValidatedParams): ResolvedPeriod {
  if (!params.period) throw new Error('ask: period parameter missing after validation');
  return params.period;
}

// ── Profit & Loss composition (spend / revenue) ─────────────────────

interface PeriodTotals {
  income: { code: string; name: string; amount: number }[];
  expense: { code: string; name: string; amount: number }[];
  netIncome: number;
}

/** The P&L route's per-period composition over reporting.ts primitives. */
async function periodTotals(companyId: string, period: ResolvedPeriod): Promise<PeriodTotals> {
  const [incomeAccounts, expenseAccounts, activity] = await Promise.all([
    db.chartOfAccount.findMany({ where: { type: 'income', active: true, companyId }, orderBy: { code: 'asc' } }),
    db.chartOfAccount.findMany({ where: { type: 'expense', active: true, companyId }, orderBy: { code: 'asc' } }),
    getGLActivity(companyId, { from: parseLocalDate(period.start), to: endOfDay(parseLocalDate(period.end)) }),
  ]);
  const income = incomeAccounts.map((a) => ({ code: a.code, name: a.name, amount: normalBalance(a.type, activity[a.code]) }));
  const expense = expenseAccounts.map((a) => ({ code: a.code, name: a.name, amount: normalBalance(a.type, activity[a.code]) }));
  const netIncome = netEarnings(activity, [
    ...incomeAccounts.map((a) => ({ code: a.code, type: a.type as string })),
    ...expenseAccounts.map((a) => ({ code: a.code, type: a.type as string })),
  ]);
  return { income, expense, netIncome };
}

const spendByCategory: AskExecutor = async (ctx, params) => {
  const period = periodOf(params);
  const compare = params.compare !== false;
  const category = params.category?.toLowerCase();

  const current = await periodTotals(ctx.companyId, period);
  let rows = current.expense.filter((e) => e.amount !== 0);
  if (category) {
    rows = rows.filter((e) => e.name.toLowerCase().includes(category) || e.code.toLowerCase() === category);
    if (rows.length === 0) {
      return {
        ...baseAnswer('spend_by_category'),
        headline: `No expense account in the chart of accounts matches "${params.category}" — so there is no recorded spending under that name for ${period.label}.`,
        figures: [],
        rows: [],
        workings:
          `I matched "${params.category}" against the expense account names on the Profit & Loss report. ` +
          'Try the exact account name (for example "Vehicle Fuel") or ask for all spending in the period.',
      };
    }
  }
  rows.sort((a, b) => b.amount - a.amount);
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));

  let priorTotal: number | null = null;
  let priorLabel: string | null = null;
  const priorByCode = new Map<string, number>();
  if (compare) {
    const priorPeriod = comparisonPeriodOf(period, ctx.periodCtx);
    priorLabel = priorPeriod.label;
    const prior = await periodTotals(ctx.companyId, priorPeriod);
    for (const e of prior.expense) priorByCode.set(e.code, e.amount);
    priorTotal = round2(
      rows.reduce((s, r) => s + (priorByCode.get(r.code) ?? 0), 0),
    );
  }

  const scope = category ? ` on ${rows.map((r) => r.name).join(', ')}` : '';
  return {
    ...baseAnswer('spend_by_category'),
    headline: `Spending${scope} for ${period.label} was ${money(total, ctx.currency)}${priorTotal !== null ? `, vs. ${money(priorTotal, ctx.currency)} in the prior period (${priorLabel})` : ''}.`,
    figures: [
      { label: category ? 'Matching spending' : 'Total spending', amount: total },
      ...(priorTotal !== null ? [{ label: `Prior period (${priorLabel})`, amount: priorTotal }] : []),
    ],
    rows: rows.map((r) => ({
      label: `${r.code} ${r.name}`,
      amount: round2(r.amount),
      detail: priorTotal !== null ? `Prior period: ${money(priorByCode.get(r.code) ?? 0, ctx.currency)}` : null,
    })),
    workings:
      `From the Profit & Loss report: expense-account activity in the general ledger between ${period.start} and ${period.end}, each account in its normal-balance direction.` +
      (priorTotal !== null
        ? ` The comparison is ${priorLabel} — the period the Profit & Loss report's prior-period comparison would use.`
        : ''),
  };
};

const revenueForPeriod: AskExecutor = async (ctx, params) => {
  const period = periodOf(params);
  const compare = params.compare !== false;
  const current = await periodTotals(ctx.companyId, period);
  const rows = current.income.filter((e) => e.amount !== 0).sort((a, b) => b.amount - a.amount);
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));

  let priorTotal: number | null = null;
  let priorLabel: string | null = null;
  if (compare) {
    const priorPeriod = comparisonPeriodOf(period, ctx.periodCtx);
    priorLabel = priorPeriod.label;
    const prior = await periodTotals(ctx.companyId, priorPeriod);
    priorTotal = round2(prior.income.reduce((s, r) => s + r.amount, 0));
  }

  return {
    ...baseAnswer('revenue_for_period'),
    headline: `Revenue for ${period.label} was ${money(total, ctx.currency)}${priorTotal !== null ? `, vs. ${money(priorTotal, ctx.currency)} in the prior period (${priorLabel})` : ''}. Net income for the period was ${money(current.netIncome, ctx.currency)}.`,
    figures: [
      { label: 'Total revenue', amount: total },
      { label: 'Net income', amount: round2(current.netIncome) },
      ...(priorTotal !== null ? [{ label: `Prior-period revenue (${priorLabel})`, amount: priorTotal }] : []),
    ],
    rows: rows.map((r) => ({ label: `${r.code} ${r.name}`, amount: round2(r.amount) })),
    workings:
      `From the Profit & Loss report: income-account activity in the general ledger between ${period.start} and ${period.end}. ` +
      'Net income is the shared reporting definition (income less expenses over the same activity).',
  };
};

// ── Receivables ──────────────────────────────────────────────────────

const receivablesOverdue: AskExecutor = async (ctx, params) => {
  const days = params.days ?? 60;
  const limit = params.limit ?? 10;
  const asOf = parseLocalDate(ctx.today);

  const invoices = await db.invoice.findMany({
    where: { companyId: ctx.companyId, status: { in: ['sent', 'overdue'] } },
    include: { customer: { select: { name: true, companyName: true } } },
    orderBy: { dueDate: 'asc' },
  });

  let totalOutstanding = 0;
  const overdue: { name: string; remaining: number; daysOverdue: number; dueDate: Date }[] = [];
  for (const inv of invoices) {
    const remaining = round2(Number(inv.total) - Number(inv.paidAmount));
    if (remaining <= 0) continue;
    totalOutstanding += remaining;
    const daysOverdue = Math.floor((asOf.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
    if (daysOverdue > days) {
      overdue.push({
        name: inv.customer?.companyName || inv.customer?.name || 'Unknown customer',
        remaining,
        daysOverdue,
        dueDate: new Date(inv.dueDate),
      });
    }
  }
  const total = round2(overdue.reduce((s, r) => s + r.remaining, 0));
  const shown = [...overdue].sort((a, b) => b.remaining - a.remaining).slice(0, limit);

  return {
    ...baseAnswer('receivables_overdue'),
    headline:
      overdue.length === 0
        ? `Nobody is more than ${days} days overdue. Total outstanding receivables are ${money(round2(totalOutstanding), ctx.currency)}.`
        : `${overdue.length} invoice${overdue.length === 1 ? '' : 's'} totalling ${money(total, ctx.currency)} are more than ${days} days past due.`,
    figures: [{ label: `Over ${days} days past due`, amount: total }],
    rows: shown.map((r) => ({
      label: r.name,
      amount: r.remaining,
      detail: `Due ${formatPeriodLabel(r.dueDate.toISOString().slice(0, 10), r.dueDate.toISOString().slice(0, 10))} · ${r.daysOverdue} days overdue`,
    })),
    workings:
      `From the Accounts Receivable Aging report's population: invoices still open (sent or overdue) as of ${ctx.today}, ` +
      `remaining balance = invoice total − payments applied, filtered to more than ${days} days past the due date. ` +
      (overdue.length > shown.length ? `Showing the ${shown.length} largest of ${overdue.length}; the total covers all of them. ` : '') +
      `Total outstanding across all open invoices: ${money(round2(totalOutstanding), ctx.currency)}.`,
  };
};

// ── Top customers / vendors ──────────────────────────────────────────

const topCustomers: AskExecutor = async (ctx, params) => {
  const period = periodOf(params);
  const limit = params.limit ?? 5;
  const invoices = await db.invoice.findMany({
    where: {
      companyId: ctx.companyId,
      status: { in: ['sent', 'paid', 'overdue'] },
      issueDate: { gte: parseLocalDate(period.start), lte: endOfDay(parseLocalDate(period.end)) },
    },
    include: { customer: { select: { name: true, companyName: true } } },
  });
  const byCustomer = new Map<string, { name: string; total: number; count: number }>();
  for (const inv of invoices) {
    const name = inv.customer?.companyName || inv.customer?.name || 'Unknown customer';
    const entry = byCustomer.get(inv.customerId) ?? { name, total: 0, count: 0 };
    entry.total += Number(inv.total);
    entry.count += 1;
    byCustomer.set(inv.customerId, entry);
  }
  const ranked = [...byCustomer.values()].sort((a, b) => b.total - a.total);
  const grandTotal = round2(ranked.reduce((s, r) => s + r.total, 0));
  const shown = ranked.slice(0, limit);

  return {
    ...baseAnswer('top_customers'),
    headline:
      ranked.length === 0
        ? `No invoices were issued in ${period.label}.`
        : `The top ${shown.length} of ${ranked.length} customers account for ${money(round2(shown.reduce((s, r) => s + r.total, 0)), ctx.currency)} of ${money(grandTotal, ctx.currency)} invoiced in ${period.label}.`,
    figures: [{ label: 'Total invoiced in period', amount: grandTotal }],
    rows: shown.map((r) => ({
      label: r.name,
      amount: round2(r.total),
      detail: `${r.count} invoice${r.count === 1 ? '' : 's'}`,
    })),
    workings:
      `From the invoice subledger behind the Accounts Receivable Aging report: invoices dated between ${period.start} and ${period.end}, ` +
      'drafts and voided invoices excluded, grouped by customer at their issued totals.',
  };
};

const topVendors: AskExecutor = async (ctx, params) => {
  const period = periodOf(params);
  const limit = params.limit ?? 5;
  const bills = await db.bill.findMany({
    where: {
      companyId: ctx.companyId,
      status: { in: ['open', 'paid', 'overdue'] },
      billDate: { gte: parseLocalDate(period.start), lte: endOfDay(parseLocalDate(period.end)) },
    },
    include: { vendor: { select: { name: true, companyName: true } } },
  });
  const byVendor = new Map<string, { name: string; total: number; count: number }>();
  for (const bill of bills) {
    const name = bill.vendor?.companyName || bill.vendor?.name || 'Unknown vendor';
    const entry = byVendor.get(bill.vendorId) ?? { name, total: 0, count: 0 };
    entry.total += Number(bill.total);
    entry.count += 1;
    byVendor.set(bill.vendorId, entry);
  }
  const ranked = [...byVendor.values()].sort((a, b) => b.total - a.total);
  const grandTotal = round2(ranked.reduce((s, r) => s + r.total, 0));
  const shown = ranked.slice(0, limit);

  return {
    ...baseAnswer('top_vendors'),
    headline:
      ranked.length === 0
        ? `No bills or expenses were recorded in ${period.label}.`
        : `The top ${shown.length} of ${ranked.length} vendors account for ${money(round2(shown.reduce((s, r) => s + r.total, 0)), ctx.currency)} of ${money(grandTotal, ctx.currency)} billed in ${period.label}.`,
    figures: [{ label: 'Total billed in period', amount: grandTotal }],
    rows: shown.map((r) => ({
      label: r.name,
      amount: round2(r.total),
      detail: `${r.count} bill${r.count === 1 ? '' : 's'}`,
    })),
    workings:
      `From the bill subledger behind the Accounts Payable Aging report: bills and expenses dated between ${period.start} and ${period.end}, ` +
      'drafts and voided bills excluded, grouped by vendor at their recorded totals.',
  };
};

// ── GST/HST position ─────────────────────────────────────────────────

const gstPosition: AskExecutor = async (ctx, params, deps) => {
  const period = periodOf(params);
  let view;
  try {
    view = await deps.computeGstReturn(ctx.companyId, period.start, period.end);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'The GST/HST return could not be computed for that period.';
    throw new AskUnavailableError(`The GST/HST position for ${period.label} can't be computed yet: ${message}`);
  }
  const line = (id: string) => view.worksheet.lines.find((l) => l.line === id);
  const line101 = line('101');
  const line103 = line('103');
  const line106 = line('106');
  const line109 = line('109');
  const keyed115 = view.worksheet.netfile.keyedNumbers.find((k) => k.line === '115');
  const outcome = view.worksheet.netfile.outcome;

  const figures: AskFigure[] = [];
  if (line101) figures.push({ label: 'Line 101 — Total sales and other revenue', amount: round2(line101.amount) });
  if (line103) figures.push({ label: 'Line 103 — GST/HST collected', amount: round2(line103.amount) });
  if (line106) figures.push({ label: 'Line 106 — Input tax credits', amount: round2(line106.amount) });
  if (line109) figures.push({ label: 'Line 109 — Net tax', amount: round2(line109.amount) });
  if (keyed115) figures.push({ label: `Line 115 — ${keyed115.label}`, amount: round2(keyed115.amount) });

  const netTaxTxt = line109 ? money(line109.amount, ctx.currency) : 'nil';
  const headline =
    outcome === 'refund'
      ? `For ${period.label}, the GST/HST position is a refund of ${keyed115 ? money(keyed115.amount, ctx.currency) : netTaxTxt} (net tax, line 109: ${netTaxTxt}).`
      : outcome === 'payment'
        ? `For ${period.label}, GST/HST net tax (line 109) is ${netTaxTxt}, with ${keyed115 ? money(keyed115.amount, ctx.currency) : netTaxTxt} owing (line 115).`
        : `For ${period.label}, the GST/HST return is nil — net tax (line 109) is ${netTaxTxt}.`;

  return {
    ...baseAnswer('gst_position'),
    headline,
    figures,
    rows: [],
    workings:
      `From the GST/HST Return report: the tax engine's GST34 worksheet for ${period.start} to ${period.end}, lines as computed — nothing re-derived here. ` +
      (view.filed
        ? `This period is recorded as filed${view.filed.filingConfirmation ? ` (confirmation ${view.filed.filingConfirmation})` : ''}.`
        : 'This period is not yet recorded as filed.'),
  };
};

/** The loan module's fiscal context, from the ask period context
 *  (whose stored values may be Dates from Prisma or strings). */
function fiscalCtxOf(periodCtx: PeriodContext): FiscalContext {
  const start = periodCtx.fiscalYearStart;
  if (typeof start === 'string') {
    return { anchor: anchorMonthDay(start), firstYear: firstFiscalYearOf(start, periodCtx.firstFiscalYearEnd) };
  }
  return fiscalContextOf({
    fiscalYearStart: start ?? new Date(Date.UTC(2000, 0, 1)),
    firstFiscalYearEnd: periodCtx.firstFiscalYearEnd instanceof Date ? periodCtx.firstFiscalYearEnd : null,
  });
}

// ── Loans ────────────────────────────────────────────────────────────

const loanBalances: AskExecutor = async (ctx) => {
  const loans = await db.loan.findMany({
    where: { companyId: ctx.companyId, status: 'active' },
    include: { payments: true, advances: true },
    orderBy: { lenderName: 'asc' },
  });
  if (loans.length === 0) {
    return {
      ...baseAnswer('loan_balances'),
      headline: 'There are no active loans on the loan register.',
      figures: [],
      rows: [],
      workings: 'From the Loans register: no loans with status "active". Add a loan there and its schedule balance will appear here.',
    };
  }
  const fctx = fiscalCtxOf(ctx.periodCtx);

  const rows: AskRow[] = [];
  let termTotal = 0;
  let dueFromShareholder = 0;
  let dueToShareholder = 0;
  let nextPaymentNote: string | null = null;
  let earliestNext: string | null = null;

  for (const loan of loans) {
    const label = `${loan.lenderName}${loan.purpose ? ` — ${loan.purpose}` : ''}`;
    if (loan.kind === 'term') {
      const summary = termLoanSummary(loan, loan.payments, fctx, ctx.today);
      termTotal += summary.balanceToday;
      rows.push({
        label,
        amount: round2(summary.balanceToday),
        detail: summary.nextPayment
          ? `Next payment ${money(summary.nextPayment.amount, ctx.currency)} on ${summary.nextPayment.date}`
          : 'No scheduled payments remain',
      });
      if (summary.nextPayment && (earliestNext === null || summary.nextPayment.date < earliestNext)) {
        earliestNext = summary.nextPayment.date;
        nextPaymentNote = `The next payment overall is ${money(summary.nextPayment.amount, ctx.currency)} to ${loan.lenderName} on ${summary.nextPayment.date}.`;
      }
    } else {
      const summary = shareholderSummary(loan, loan.advances, fctx, ctx.today);
      if (loan.kind === 'shareholder_advance') dueFromShareholder += summary.balanceToday;
      else dueToShareholder += summary.balanceToday;
      rows.push({
        label,
        amount: round2(summary.balanceToday),
        detail: loan.kind === 'shareholder_advance' ? 'Shareholder loan — owed to the company' : 'Shareholder funding — owed to the shareholder',
      });
    }
  }

  const figures: AskFigure[] = [];
  if (termTotal !== 0) figures.push({ label: 'Term-loan balances', amount: round2(termTotal) });
  if (dueFromShareholder !== 0) figures.push({ label: 'Due from shareholder', amount: round2(dueFromShareholder) });
  if (dueToShareholder !== 0) figures.push({ label: 'Due to shareholder', amount: round2(dueToShareholder) });

  return {
    ...baseAnswer('loan_balances'),
    headline: `${loans.length} active loan${loans.length === 1 ? '' : 's'}: ${figures.map((f) => `${f.label.toLowerCase()} ${money(f.amount, ctx.currency)}`).join('; ')}.${nextPaymentNote ? ` ${nextPaymentNote}` : ''}`,
    figures,
    rows,
    workings:
      `From the Loans register as of ${ctx.today}: balances are the loan tool's own schedule balances (the same summaries the Loans pages show), ` +
      'shareholder amounts kept separate from term debt because they run the other direction.',
  };
};

// ── CCA register ─────────────────────────────────────────────────────

const ccaByClass: AskExecutor = async (ctx, _params, deps) => {
  let assembled;
  try {
    assembled = await deps.assembleCcaRegisterExport(ctx.companyId, ctx.today);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'The CCA register could not be assembled.';
    if (/business number|fiscal year start/i.test(message)) throw new AskUnavailableError(message);
    throw e;
  }
  const payload = assembled.result.payload as {
    classes?: {
      ccaClass: string;
      label: string;
      ratePct: number | null;
      closingCapitalCost: string;
      book: { accumulatedDepreciation: string; netBookValue: string; depreciationExpenseForYear: string };
    }[];
  };
  const classes = payload.classes ?? [];
  const rows: AskRow[] = classes.map((c) => ({
    label: `Class ${c.ccaClass} — ${c.label}`,
    amount: round2(Number(c.book.netBookValue)),
    detail: `Capital cost ${money(Number(c.closingCapitalCost), ctx.currency)} · accumulated book depreciation ${money(Number(c.book.accumulatedDepreciation), ctx.currency)}`,
  }));
  const totalNbv = round2(rows.reduce((s, r) => s + r.amount, 0));

  return {
    ...baseAnswer('cca_by_class'),
    headline:
      classes.length === 0
        ? `The CCA register has no classes with assets for ${assembled.fiscalYear.label}.`
        : `Across ${classes.length} CCA classes, the register's net book value is ${money(totalNbv, ctx.currency)} for ${assembled.fiscalYear.label}.`,
    figures: [{ label: 'Total net book value (book)', amount: totalNbv }],
    rows,
    workings:
      `From the CCA Register (the cca-register/1 assembly) for ${assembled.fiscalYear.label}: closing capital cost less accumulated BOOK depreciation, per class. ` +
      'These are book figures — LedgerPro keeps no shadow tax UCC; the UCC as filed lives on the T2 in Nexvar Tax.',
  };
};

// ── Cash by account ──────────────────────────────────────────────────

const cashByAccount: AskExecutor = async (ctx) => {
  const accounts = await db.financialAccount.findMany({
    where: { companyId: ctx.companyId, isActive: true },
    orderBy: { name: 'asc' },
  });
  const totalsByCurrency = new Map<string, number>();
  for (const a of accounts) {
    totalsByCurrency.set(a.currency, (totalsByCurrency.get(a.currency) ?? 0) + Number(a.currentBalance));
  }
  const totals = [...totalsByCurrency.entries()].map(([currency, amount]) => ({ currency, amount: round2(amount) }));
  const figures: AskFigure[] = totals.map((t) => ({ label: `Total (${t.currency})`, amount: t.amount }));

  return {
    ...baseAnswer('cash_by_account'),
    headline:
      accounts.length === 0
        ? 'No active bank accounts are set up yet.'
        : totals.length === 1
          ? `Bank balances total ${money(totals[0].amount, totals[0].currency)} across ${accounts.length} account${accounts.length === 1 ? '' : 's'}.`
          : `Balances across ${accounts.length} accounts: ${totals.map((t) => `${money(t.amount, t.currency)} (${t.currency})`).join('; ')}.`,
    figures,
    rows: accounts.map((a) => ({
      label: `${a.name}${a.mask ? ` ••${a.mask}` : ''}`,
      amount: round2(Number(a.currentBalance)),
      detail: `${a.currency}${a.glAccountCode ? ` · GL ${a.glAccountCode}` : ''}`,
    })),
    workings:
      'From the Banking pages: the recorded balance of each active bank account (updated at its last import, sync, or manual entry). ' +
      'Totals are grouped by currency — amounts in different currencies are never added together.',
  };
};

// ── Payroll cost ─────────────────────────────────────────────────────

const payrollCost: AskExecutor = async (ctx, params) => {
  const period = periodOf(params);
  const entries = await db.journalEntry.findMany({
    where: {
      companyId: ctx.companyId,
      sourceType: 'payroll',
      entryDate: { gte: parseLocalDate(period.start), lte: endOfDay(parseLocalDate(period.end)) },
    },
    include: { lines: true },
    orderBy: { entryDate: 'asc' },
  });
  if (entries.length === 0) {
    return {
      ...baseAnswer('payroll_cost'),
      headline: `No payroll journals were posted into these books for ${period.label}.`,
      figures: [],
      rows: [],
      workings:
        'Payroll runs in Nexvar Pay post a journal here when a run is finalized — the same payroll section the Year-End Package reports. ' +
        'No entries with source "payroll" are dated in this period, so there is no posted payroll cost to report.',
    };
  }
  const accounts = await db.chartOfAccount.findMany({
    where: { companyId: ctx.companyId },
    select: { code: true, name: true, type: true },
  });
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const perAccount = new Map<string, number>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const account = byCode.get(line.glAccountCode);
      if (!account || account.type !== 'expense') continue;
      perAccount.set(line.glAccountCode, (perAccount.get(line.glAccountCode) ?? 0) + Number(line.debit) - Number(line.credit));
    }
  }
  const rows: AskRow[] = [...perAccount.entries()]
    .map(([code, amount]) => ({ label: `${code} ${byCode.get(code)?.name ?? ''}`.trim(), amount: round2(amount) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));

  return {
    ...baseAnswer('payroll_cost'),
    headline: `Payroll cost for ${period.label} was ${money(total, ctx.currency)} across ${entries.length} posted payroll journal${entries.length === 1 ? '' : 's'}.`,
    figures: [{ label: 'Total payroll cost', amount: total }],
    rows,
    workings:
      `From the payroll journals posted into the General Ledger (source: Nexvar Pay) between ${period.start} and ${period.end}: ` +
      'cost is the net debits to expense accounts — wages and employer amounts — the same aggregation the Year-End Package reports.',
  };
};

// ── Registry ─────────────────────────────────────────────────────────

export const ASK_EXECUTORS: Record<string, AskExecutor> = {
  spend_by_category: spendByCategory,
  revenue_for_period: revenueForPeriod,
  receivables_overdue: receivablesOverdue,
  top_customers: topCustomers,
  top_vendors: topVendors,
  gst_position: gstPosition,
  loan_balances: loanBalances,
  cca_by_class: ccaByClass,
  cash_by_account: cashByAccount,
  payroll_cost: payrollCost,
};
