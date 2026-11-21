/**
 * Cash-flow outlook — 13-week lookahead (improvement plan Phase 3,
 * item 2). A PURE computation core: plain facts in, projection out.
 * No DB, no I/O, no LLM, and NO behavioural prediction — every figure
 * sits on a due date or a stated cadence assumption, and every bucket
 * figure drills down to the source items that compose it (invoice,
 * bill, loan payment, payroll date), because a forecast an accountant
 * cannot trace is worthless.
 *
 * Money is integer cents throughout. Dates are YMD strings handled in
 * UTC, the same convention as the loan engine and the health radar.
 *
 * What is projected, and on what basis:
 *  - Opening position: the company's actual current bank balances
 *    (server supplies them per account; the projection is combined —
 *    projected items are not tied to a specific account in the source
 *    data, so a per-account forecast would be invented precision).
 *  - Invoices: open (sent/overdue) at their due dates. Overdue items
 *    land in week 1 — they are already due.
 *  - Bills: open/overdue at their due dates; a bill with no due date
 *    lands in week 1, labelled as such.
 *  - Loans: the scheduled LoanPayment rows of active term loans — the
 *    real amortization schedule, on its real dates.
 *  - Recurring templates: projected on their saved cadence, only
 *    where the template's journal moves a bank account (the server
 *    pre-computes that net bank leg; a template that books Dr expense
 *    / Cr AP moves no cash when it posts).
 *  - Payroll: cadence inferred from the last 3 payroll journals
 *    (weekly / biweekly / semi-monthly / monthly / irregular), amounts
 *    = the average of those 3 runs, split by the server into the
 *    pay-date portion (net pay + anything else that leaves around pay
 *    day) and the source-deduction portion. CRA remittances follow
 *    the regular-remitter rule: a month's deductions are due on the
 *    15th of the following month. Remittance months the server has
 *    evidence were already paid are excluded before the facts arrive.
 *  - GST/HST: for each unfiled filing period the server supplies, the
 *    net amount owing (GST34 line 115, from the GST module's own
 *    computation) placed on its CRA due date — the last day of the
 *    month after the period ends for monthly/quarterly filers, three
 *    months after period end for annual filers. A refund position is
 *    never projected: CRA refund timing is not predictable.
 */

export const OUTLOOK_WEEKS = 13;

// ─── Date helpers (UTC, YMD strings) ────────────────────────────────

function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return toYmd(d);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86_400_000);
}

/** Monday (UTC) of the week containing `ymd`. */
export function mondayOf(ymd: string): string {
  const dow = parseYmd(ymd).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Resolve a day-of-month that may be 31 ("last day") against a real month. */
function resolveDay(year: number, month1: number, day: number): string {
  const clamped = Math.min(day, daysInMonth(year, month1));
  return `${year}-${String(month1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

/** A run on the last day of its month normalizes to 31, so "15th and
 *  month-end" reads as the day set {15, 31} across months of any length. */
function normalizedDayOfMonth(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return d === daysInMonth(y, m) ? 31 : d;
}

function monthKey(ymd: string): string {
  return ymd.slice(0, 7); // YYYY-MM
}

function monthLabel(ymd: string): string {
  return parseYmd(`${ymd.slice(0, 7)}-01`).toLocaleDateString('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Step a date by whole months, keeping the day-of-month (clamped). */
function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const idx = y * 12 + (m - 1) + months;
  return resolveDay(Math.floor(idx / 12), (idx % 12) + 1, d);
}

// ─── Facts (assembled by src/lib/cashflow/server.ts) ────────────────

export interface CashflowAccountFact {
  name: string;
  kind: string;
  balanceCents: number;
}

export interface CashflowInvoiceFact {
  id: string;
  customerName: string;
  dueDate: string;
  outstandingCents: number;
}

export interface CashflowBillFact {
  id: string;
  vendorName: string;
  referenceNo: string | null;
  dueDate: string | null;
  outstandingCents: number;
}

export interface CashflowLoanPaymentFact {
  loanId: string;
  lenderName: string;
  purpose: string | null;
  dueDate: string;
  amountCents: number;
}

export interface CashflowRecurringFact {
  templateId: string;
  name: string;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'annual';
  nextPostDate: string;
  endDate: string | null;
  /** Net movement on the template's bank lines, signed cents
   *  (positive = cash in). Zero-bank-leg templates never arrive here. */
  bankAmountCents: number;
}

/** One actual payroll journal, decomposed by the server into the part
 *  that leaves around pay day and the source-deduction part CRA is
 *  owed (CPP/EI/income tax payable credits). */
export interface CashflowPayrollRunFact {
  date: string;
  payAmountCents: number;
  remittanceAmountCents: number;
}

export interface CashflowGstPeriodFact {
  periodStart: string;
  periodEnd: string;
  filingFrequency: string; // 'monthly' | 'quarterly' | 'annual' | …
  netOwingCents: number; // GST34 line 115 from the GST module; > 0 only
}

export interface CashflowFacts {
  asOf: string;
  accounts: CashflowAccountFact[];
  invoices: CashflowInvoiceFact[];
  bills: CashflowBillFact[];
  loanPayments: CashflowLoanPaymentFact[];
  recurring: CashflowRecurringFact[];
  payrollRuns: CashflowPayrollRunFact[]; // ascending by date
  /** YYYY-MM months whose CRA remittance the server found paid. */
  remittancePaidMonths: string[];
  gstRegistrationPresent: boolean;
  gstPeriods: CashflowGstPeriodFact[];
}

// ─── Output ─────────────────────────────────────────────────────────

export type CashflowItemKind =
  | 'invoice'
  | 'bill'
  | 'loan'
  | 'recurring'
  | 'payroll'
  | 'remittance'
  | 'gst';

export interface CashflowItem {
  date: string;
  kind: CashflowItemKind;
  direction: 'in' | 'out';
  amountCents: number; // positive
  label: string;
  detail: string | null;
  /** Dated before the window opened — shown in week 1 because the
   *  amount is already due. */
  pastDue: boolean;
  /** Projected from a pattern (payroll), not a booked fact. */
  projected: boolean;
}

export interface CashflowWeek {
  index: number;
  start: string;
  end: string;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  closingCents: number;
  items: CashflowItem[];
}

export type PayrollCadence = 'weekly' | 'biweekly' | 'semi-monthly' | 'monthly' | 'irregular';

export interface PayrollPattern {
  cadence: PayrollCadence;
  description: string;
  basedOnRuns: number;
  lastRunDate: string;
  avgPayCents: number;
  avgRemittanceCents: number;
}

export interface CashflowOutlook {
  asOf: string;
  windowStart: string;
  windowEnd: string;
  openingCents: number;
  accounts: CashflowAccountFact[];
  weeks: CashflowWeek[];
  /** The first dip below zero: the week containing it, the date it
   *  happens, and the running balance on that date. */
  firstNegative: { weekIndex: number; date: string; closingCents: number } | null;
  totalInflowCents: number;
  totalOutflowCents: number;
  payrollPattern: PayrollPattern | null;
  /** Known items dated after the window (e.g. the last projected
   *  month's CRA remittance) — real, just beyond the 13 weeks. */
  afterWindow: CashflowItem[];
  assumptions: string[];
}

// ─── Payroll cadence inference ──────────────────────────────────────

const CADENCE_LABEL: Record<PayrollCadence, string> = {
  weekly: 'weekly',
  biweekly: 'every two weeks',
  'semi-monthly': 'twice a month',
  monthly: 'monthly',
  irregular: 'on a repeating interval',
};

interface InferredCadence {
  cadence: PayrollCadence;
  stepDays: number | null; // fixed-step cadences
  daysOfMonth: number[] | null; // calendar cadences (31 = last day)
}

function inferCadence(last3: CashflowPayrollRunFact[]): InferredCadence {
  const gaps = [diffDays(last3[0].date, last3[1].date), diffDays(last3[1].date, last3[2].date)];
  const days = [...new Set(last3.map((r) => normalizedDayOfMonth(r.date)))].sort((a, b) => a - b);
  const allIn = (lo: number, hi: number) => gaps.every((g) => g >= lo && g <= hi);

  if (allIn(6, 9)) return { cadence: 'weekly', stepDays: 7, daysOfMonth: null };
  // Semi-monthly: runs land on at most two fixed days of the month.
  // Gaps run ~15 days, but a run missing from the journals stretches
  // one gap to ~a month — the day set still gives it away.
  if (days.length <= 2 && gaps.every((g) => g >= 12 && g <= 35) && gaps.some((g) => g <= 17)) {
    return { cadence: 'semi-monthly', stepDays: null, daysOfMonth: days };
  }
  if (allIn(12, 17)) return { cadence: 'biweekly', stepDays: 14, daysOfMonth: null };
  if (allIn(25, 35)) {
    return { cadence: 'monthly', stepDays: null, daysOfMonth: [normalizedDayOfMonth(last3[2].date)] };
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  return { cadence: 'irregular', stepDays: Math.max(1, Math.round((sorted[0] + sorted[1]) / 2)), daysOfMonth: null };
}

/** Future run dates on the inferred cadence, after `lastRunDate` and
 *  no later than `through`. Calendar cadences iterate month by month. */
function projectRunDates(inf: InferredCadence, lastRunDate: string, through: string): string[] {
  const dates: string[] = [];
  if (inf.stepDays != null) {
    let d = lastRunDate;
    for (let i = 0; i < 40; i++) {
      d = addDays(d, inf.stepDays);
      if (d > through) break;
      dates.push(d);
    }
    return dates;
  }
  const days = inf.daysOfMonth ?? [];
  let cursor = `${lastRunDate.slice(0, 7)}-01`;
  for (let i = 0; i < 16 && dates.length < 40; i++) {
    const [y, m] = cursor.split('-').map(Number);
    for (const day of days) {
      const candidate = resolveDay(y, m, day);
      if (candidate > lastRunDate && candidate <= through) dates.push(candidate);
    }
    cursor = addMonths(cursor, 1);
    if (cursor > through && dates.length > 0) break;
  }
  return dates.sort();
}

/** The 15th of the month following `ymd`'s month (regular remitter). */
function remittanceDueDate(runMonthYmd: string): string {
  const next = addMonths(`${runMonthYmd.slice(0, 7)}-01`, 1);
  return `${next.slice(0, 7)}-15`;
}

/** CRA due date for a GST/HST period's net remittance. */
export function gstDueDate(period: CashflowGstPeriodFact): string {
  if (period.filingFrequency === 'annual') return addMonths(period.periodEnd, 3);
  // Monthly / quarterly (and anything else): last day of the month
  // after the period ends.
  const [y, m] = period.periodEnd.split('-').map(Number);
  const idx = y * 12 + (m - 1) + 1;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return resolveDay(ny, nm, 31);
}

// ─── The projection ─────────────────────────────────────────────────

export function buildCashflowOutlook(facts: CashflowFacts): CashflowOutlook {
  const windowStart = mondayOf(facts.asOf);
  const windowEnd = addDays(windowStart, OUTLOOK_WEEKS * 7 - 1);
  const openingCents = facts.accounts.reduce((s, a) => s + a.balanceCents, 0);

  const assumptions: string[] = [];
  const items: CashflowItem[] = [];
  const afterWindow: CashflowItem[] = [];

  const place = (item: CashflowItem) => {
    if (item.date > windowEnd) {
      afterWindow.push(item);
      return;
    }
    items.push(item);
  };

  assumptions.push(
    `Opening position is the current balance of ${facts.accounts.length} bank and cash ` +
      `account${facts.accounts.length === 1 ? '' : 's'} — the projection is combined across ` +
      `accounts, because invoices, bills and payroll are not tied to one account in the books.`
  );
  assumptions.push(
    'Everything is placed on its due date. This outlook does not predict when customers ' +
      'will actually pay or when you will choose to pay a bill early or late.'
  );

  // ── Invoices ──
  if (facts.invoices.length > 0) {
    assumptions.push('Open invoices are receipts expected on their due dates; invoices already overdue are shown in the first week.');
  }
  for (const inv of facts.invoices) {
    place({
      date: inv.dueDate,
      kind: 'invoice',
      direction: 'in',
      amountCents: inv.outstandingCents,
      label: `Invoice — ${inv.customerName}`,
      detail: `Due ${inv.dueDate}`,
      pastDue: inv.dueDate < windowStart,
      projected: false,
    });
  }

  // ── Bills ──
  if (facts.bills.length > 0) {
    assumptions.push('Open bills are payments on their due dates; bills already overdue, and bills with no due date, are shown in the first week.');
  }
  for (const bill of facts.bills) {
    const date = bill.dueDate ?? windowStart;
    place({
      date,
      kind: 'bill',
      direction: 'out',
      amountCents: bill.outstandingCents,
      label: bill.referenceNo ? `Bill ${bill.referenceNo} — ${bill.vendorName}` : `Bill — ${bill.vendorName}`,
      detail: bill.dueDate ? `Due ${bill.dueDate}` : 'No due date set',
      pastDue: date < windowStart || bill.dueDate == null,
      projected: false,
    });
  }

  // ── Loan payments (the real amortization schedules) ──
  if (facts.loanPayments.length > 0) {
    assumptions.push("Loan payments come from each loan's own amortization schedule, on the scheduled dates.");
  }
  for (const p of facts.loanPayments) {
    place({
      date: p.dueDate,
      kind: 'loan',
      direction: 'out',
      amountCents: p.amountCents,
      label: p.purpose ? `Loan payment — ${p.lenderName} (${p.purpose})` : `Loan payment — ${p.lenderName}`,
      detail: `Scheduled ${p.dueDate}`,
      pastDue: p.dueDate < windowStart,
      projected: false,
    });
  }

  // ── Recurring templates (bank-leg only, on cadence) ──
  if (facts.recurring.length > 0) {
    assumptions.push(
      'Recurring entries are projected on their saved cadence, only where the entry moves a bank ' +
        'account — an entry that books an expense against payables moves no cash when it posts.'
    );
  }
  for (const t of facts.recurring) {
    let date = t.nextPostDate;
    // A next date in the past steps forward on cadence — missed
    // occurrences are not piled into week 1 as if all due at once.
    for (let i = 0; i < 60 && date < windowStart; i++) date = stepRecurring(date, t.frequency);
    for (let i = 0; i < 60 && date <= windowEnd; i++) {
      if (t.endDate && date > t.endDate) break;
      place({
        date,
        kind: 'recurring',
        direction: t.bankAmountCents >= 0 ? 'in' : 'out',
        amountCents: Math.abs(t.bankAmountCents),
        label: `Recurring — ${t.name}`,
        detail: `${t.frequency}, next ${t.nextPostDate}`,
        pastDue: false,
        projected: true,
      });
      date = stepRecurring(date, t.frequency);
    }
  }

  // ── Payroll + CRA remittances ──
  const payrollPattern = buildPayroll(facts, windowStart, windowEnd, place, assumptions);

  // ── GST/HST remittances ──
  if (facts.gstRegistrationPresent && facts.gstPeriods.length > 0) {
    assumptions.push(
      'GST/HST: the net amount owing for each unfiled filing period (the GST module\u2019s own ' +
        'line 115) is placed on its CRA due date — the last day of the month after the period ' +
        'ends, or three months after period end for annual filers. A refund position is not ' +
        'projected; CRA refund timing is not predictable.'
    );
  }
  for (const period of facts.gstPeriods) {
    const due = gstDueDate(period);
    place({
      date: due,
      kind: 'gst',
      direction: 'out',
      amountCents: period.netOwingCents,
      label: `GST/HST remittance — period ${period.periodStart} to ${period.periodEnd}`,
      detail: `CRA due ${due}`,
      pastDue: due < windowStart,
      projected: false,
    });
  }

  // ── Bucket into weeks ──
  const weeks: CashflowWeek[] = [];
  let running = openingCents;
  for (let w = 0; w < OUTLOOK_WEEKS; w++) {
    const start = addDays(windowStart, w * 7);
    const end = addDays(start, 6);
    const weekItems = items
      .filter((it) => {
        const effective = it.date < windowStart ? windowStart : it.date;
        return effective >= start && effective <= end;
      })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.label.localeCompare(b.label)));
    let inflow = 0;
    let outflow = 0;
    for (const it of weekItems) {
      if (it.direction === 'in') inflow += it.amountCents;
      else outflow += it.amountCents;
    }
    running += inflow - outflow;
    weeks.push({
      index: w,
      start,
      end,
      inflowCents: inflow,
      outflowCents: outflow,
      netCents: inflow - outflow,
      closingCents: running,
      items: weekItems,
    });
  }

  // First dip below zero, walked day by day over the whole window —
  // a balance can go negative mid-week even in a week that closes
  // positive, and the warning should name that date.
  let firstNegative: CashflowOutlook['firstNegative'] = null;
  {
    const byDate = new Map<string, number>();
    for (const it of items) {
      const effective = it.date < windowStart ? windowStart : it.date;
      byDate.set(effective, (byDate.get(effective) ?? 0) + (it.direction === 'in' ? it.amountCents : -it.amountCents));
    }
    let dayRunning = openingCents;
    for (const date of [...byDate.keys()].sort()) {
      dayRunning += byDate.get(date)!;
      if (dayRunning < 0) {
        firstNegative = {
          weekIndex: Math.floor(diffDays(windowStart, date) / 7),
          date,
          closingCents: dayRunning,
        };
        break;
      }
    }
  }

  afterWindow.sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    asOf: facts.asOf,
    windowStart,
    windowEnd,
    openingCents,
    accounts: facts.accounts,
    weeks,
    firstNegative,
    totalInflowCents: weeks.reduce((s, w) => s + w.inflowCents, 0),
    totalOutflowCents: weeks.reduce((s, w) => s + w.outflowCents, 0),
    payrollPattern,
    afterWindow,
    assumptions,
  };
}

function stepRecurring(ymd: string, frequency: CashflowRecurringFact['frequency']): string {
  switch (frequency) {
    case 'weekly':
      return addDays(ymd, 7);
    case 'monthly':
      return addMonths(ymd, 1);
    case 'quarterly':
      return addMonths(ymd, 3);
    case 'annual':
      return addMonths(ymd, 12);
  }
}

/**
 * Payroll projection + CRA remittance placement. Returns the pattern
 * summary for the page (or null when payroll cannot be projected) and
 * pushes items through `place`.
 */
function buildPayroll(
  facts: CashflowFacts,
  windowStart: string,
  windowEnd: string,
  place: (item: CashflowItem) => void,
  assumptions: string[]
): PayrollPattern | null {
  const runs = [...facts.payrollRuns].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (runs.length < 3) {
    if (runs.length > 0) {
      assumptions.push(
        'Payroll is not projected: fewer than three payroll journals have posted, so there is no cadence to infer.'
      );
    }
    return null;
  }
  const last3 = runs.slice(-3);
  const lastRun = last3[last3.length - 1];
  if (diffDays(lastRun.date, facts.asOf) > 62) {
    assumptions.push(
      `Payroll is not projected: the most recent payroll journal is dated ${lastRun.date}, ` +
        'so the pattern looks stopped rather than current.'
    );
    return null;
  }

  const avg = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
  const avgPay = avg(last3.map((r) => r.payAmountCents));
  const avgRemittance = avg(last3.map((r) => r.remittanceAmountCents));
  const inf = inferCadence(last3);
  const projectedDates = projectRunDates(inf, lastRun.date, windowEnd);

  const pattern: PayrollPattern = {
    cadence: inf.cadence,
    description:
      inf.cadence === 'irregular'
        ? `Payroll runs ${CADENCE_LABEL.irregular} — about every ${inf.stepDays} days, inferred from the last 3 payroll journals.`
        : `Payroll runs ${CADENCE_LABEL[inf.cadence]}, inferred from the last 3 payroll journals.`,
    basedOnRuns: last3.length,
    lastRunDate: lastRun.date,
    avgPayCents: avgPay,
    avgRemittanceCents: avgRemittance,
  };

  assumptions.push(
    `Payroll: a ${CADENCE_LABEL[inf.cadence]} pattern was inferred from the last ${last3.length} payroll ` +
      `journals (most recent ${lastRun.date}); each projected run uses the average of those runs.`
  );

  // Pay-date items: projected runs inside the window only. A projected
  // run dated before the window opened is not re-shown as pay — it is
  // in the past — but it still counts toward its month's remittance.
  for (const date of projectedDates) {
    if (date < windowStart) continue;
    place({
      date,
      kind: 'payroll',
      direction: 'out',
      amountCents: avgPay,
      label: 'Payroll — pay date (projected)',
      detail: `Average of the last ${last3.length} runs`,
      pastDue: false,
      projected: true,
    });
  }

  // CRA remittances: group actual + projected runs by run month; a
  // month's deductions are due on the 15th of the following month.
  // Only last month onward can still be owing — older months are
  // assumed remitted, and months the server marked paid never arrive.
  if (avgRemittance > 0 || runs.some((r) => r.remittanceAmountCents > 0)) {
    const earliestMonth = monthKey(addMonths(`${windowStart.slice(0, 7)}-01`, -1));
    const byMonth = new Map<string, number>();
    for (const r of runs) {
      const mk = monthKey(r.date);
      if (mk < earliestMonth) continue;
      byMonth.set(mk, (byMonth.get(mk) ?? 0) + r.remittanceAmountCents);
    }
    for (const date of projectedDates) {
      const mk = monthKey(date);
      byMonth.set(mk, (byMonth.get(mk) ?? 0) + avgRemittance);
    }
    const paid = new Set(facts.remittancePaidMonths);
    for (const [mk, amount] of [...byMonth.entries()].sort()) {
      if (amount <= 0 || paid.has(mk)) continue;
      const due = remittanceDueDate(`${mk}-01`);
      place({
        date: due,
        kind: 'remittance',
        direction: 'out',
        amountCents: amount,
        label: `CRA payroll remittance — ${monthLabel(`${mk}-01`)} source deductions`,
        detail: `Due ${due} (regular remitter)`,
        pastDue: due < windowStart,
        projected: true,
      });
    }
    assumptions.push(
      'CRA payroll remittances follow the regular-remitter schedule: each month\u2019s source ' +
        'deductions are due on the 15th of the following month. Months before last month are ' +
        'assumed already remitted.'
    );
  } else {
    assumptions.push(
      'The payroll journals do not separate source deductions into their own liability ' +
        'accounts, so no separate CRA remittance is projected — the full run amount is shown ' +
        'on the pay date.'
    );
  }

  return pattern;
}
