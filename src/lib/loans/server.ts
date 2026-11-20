/**
 * Loan tool — server side: chart hygiene, schedule persistence,
 * approval-gated payment posting, and the three-way balance proof.
 *
 * Posting rule (the app's standing pattern): a schedule row is a
 * PROPOSAL. Nothing reaches the ledger until a user approves a payment
 * through the posting route, which stamps the journal with
 * sourceType 'loan' and the payment's id, and links it back onto the
 * payment row. Shareholder advances are register records only — this
 * module never posts a journal for them.
 */

import { Prisma, type Loan, type LoanPayment } from '@prisma/client';
import { db } from '@/lib/db';
import { postJournalEntry } from '@/lib/journal';
import {
  buildSchedule,
  currentPortionCents,
  paymentDateAt,
  scheduleBalanceAtCents,
  toCents,
  toDollars,
  type ScheduleRow,
} from './engine';
import { buildSplitJournalLines, splitActualPayment } from './journal-lines';

type Tx = Prisma.TransactionClient;

// ─── Conversions ───

export function dateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function ymdToDate(ymd: string): Date {
  return new Date(`${ymd.slice(0, 10)}T00:00:00.000Z`);
}

function decToCents(v: Prisma.Decimal | number | string): number {
  return toCents(Number(v));
}

// ─── Chart hygiene ───
// Creating a loan creates its accounts properly, so a loan payment is
// never again booked to a mixed expense account. Interest expense is a
// single shared account (GIFI 8710); each term loan gets its own
// liability account under Loans Payable (GIFI 3140).

export const INTEREST_EXPENSE_CODE = '6950';
const LOAN_ACCOUNT_CODES = ['2510', '2520', '2530', '2540', '2550', '2560', '2570', '2580', '2590'];

export async function ensureInterestExpenseAccount(
  client: Tx | typeof db,
  companyId: string
): Promise<string> {
  const existing = await client.chartOfAccount.findFirst({
    where: { companyId, code: INTEREST_EXPENSE_CODE },
  });
  if (existing) return existing.code;
  await client.chartOfAccount.create({
    data: {
      companyId,
      code: INTEREST_EXPENSE_CODE,
      name: 'Interest Expense',
      type: 'expense',
      detailType: 'Interest expense',
      description: 'Interest on loans — posted by the Loan tool (GIFI 8710)',
      gifiCode: '8710',
    },
  });
  return INTEREST_EXPENSE_CODE;
}

export async function ensureTermLoanAccount(
  client: Tx | typeof db,
  companyId: string,
  lenderName: string
): Promise<string> {
  const used = await client.chartOfAccount.findMany({
    where: { companyId, code: { in: LOAN_ACCOUNT_CODES } },
    select: { code: true },
  });
  const usedCodes = new Set(used.map((a) => a.code));
  const free = LOAN_ACCOUNT_CODES.find((code) => !usedCodes.has(code));
  if (!free) {
    throw new Error(
      'No free loan account code (2510–2590 are all in use). Map this loan to an existing liability account instead.'
    );
  }
  const parent = await client.chartOfAccount.findFirst({
    where: { companyId, code: '2500' },
    select: { code: true },
  });
  await client.chartOfAccount.create({
    data: {
      companyId,
      code: free,
      name: `Loan — ${lenderName}`.slice(0, 80),
      type: 'liability',
      subType: 'long_term_liability',
      detailType: 'Loans payable',
      description: `Loan payable to ${lenderName} — controlled by the Loan tool`,
      gifiCode: '3140',
      parentCode: parent ? '2500' : undefined,
    },
  });
  return free;
}

/** Get-or-create the shareholder pair from the corporation template (1300 / 2600). */
export async function ensureShareholderAccount(
  client: Tx | typeof db,
  companyId: string,
  kind: 'shareholder_advance' | 'shareholder_funding'
): Promise<string> {
  const spec =
    kind === 'shareholder_advance'
      ? {
          code: '1300',
          name: 'Due from Shareholder',
          type: 'asset' as const,
          subType: 'current_asset' as const,
          gifiCode: '1301',
          description: 'Amounts owed by the shareholder to the corporation',
        }
      : {
          code: '2600',
          name: 'Due to Shareholder',
          type: 'liability' as const,
          subType: 'current_liability' as const,
          gifiCode: '2781',
          description: 'Amounts the corporation owes the shareholder',
        };
  const existing = await client.chartOfAccount.findFirst({
    where: { companyId, code: spec.code },
  });
  if (existing) return existing.code;
  await client.chartOfAccount.create({
    data: {
      companyId,
      code: spec.code,
      name: spec.name,
      type: spec.type,
      subType: spec.subType,
      detailType: 'Shareholder loan',
      description: spec.description,
      gifiCode: spec.gifiCode,
    },
  });
  return spec.code;
}

// ─── Schedule persistence ───

export function loanToScheduleRows(payments: LoanPayment[]): ScheduleRow[] {
  return [...payments]
    .sort((a, b) => a.periodNumber - b.periodNumber)
    .map((p) => ({
      period: p.periodNumber,
      date: dateToYmd(p.dueDate),
      openingCents: decToCents(p.openingBalance),
      paymentCents: decToCents(p.paymentAmount),
      interestCents: decToCents(p.interestPortion),
      principalCents: decToCents(p.principalPortion),
      closingCents: decToCents(p.closingBalance),
    }));
}

function scheduleInputFromLoan(loan: Loan, overrides?: Partial<Parameters<typeof buildSchedule>[0]>) {
  return {
    principalCents: decToCents(loan.principal),
    annualRatePct: Number(loan.annualRatePct),
    compoundingPerYear: loan.compoundingPerYear,
    frequency: loan.paymentFrequency,
    firstPaymentDate: dateToYmd(loan.firstPaymentDate ?? loan.startDate),
    paymentCents: loan.paymentAmount != null ? decToCents(loan.paymentAmount) : null,
    numberOfPayments: loan.numberOfPayments,
    balloonCents: loan.balloonAmount != null ? decToCents(loan.balloonAmount) : 0,
    ...overrides,
  };
}

/** Generate and store the full schedule for a freshly created term loan. */
export async function persistSchedule(client: Tx | typeof db, loan: Loan): Promise<number> {
  const result = buildSchedule(scheduleInputFromLoan(loan));
  await client.loanPayment.createMany({
    data: result.rows.map((row) => ({
      loanId: loan.id,
      periodNumber: row.period,
      dueDate: ymdToDate(row.date),
      openingBalance: toDollars(row.openingCents),
      paymentAmount: toDollars(row.paymentCents),
      interestPortion: toDollars(row.interestCents),
      principalPortion: toDollars(row.principalCents),
      closingBalance: toDollars(row.closingCents),
    })),
  });
  return result.rows.length;
}

/**
 * Re-amortize the unposted tail from actuals: after a payment posts for
 * a different amount than scheduled, every still-scheduled row is
 * rebuilt from the true closing balance at the same contractual
 * payment, so the schedule can never drift silently away from the books.
 */
async function regenerateTail(
  tx: Tx,
  loan: Loan,
  afterPeriod: number,
  openingBalanceCents: number,
  nextDate: string,
  regularPaymentCents: number
): Promise<void> {
  await tx.loanPayment.deleteMany({
    where: { loanId: loan.id, status: 'scheduled', periodNumber: { gt: afterPeriod } },
  });
  const balloon = loan.balloonAmount != null ? decToCents(loan.balloonAmount) : 0;
  if (openingBalanceCents <= balloon) return;
  const result = buildSchedule(
    scheduleInputFromLoan(loan, {
      openingBalanceCents,
      startPeriod: afterPeriod + 1,
      firstPaymentDate: nextDate,
      paymentCents: regularPaymentCents,
      numberOfPayments: null,
    })
  );
  await tx.loanPayment.createMany({
    data: result.rows.map((row) => ({
      loanId: loan.id,
      periodNumber: row.period,
      dueDate: ymdToDate(row.date),
      openingBalance: toDollars(row.openingCents),
      paymentAmount: toDollars(row.paymentCents),
      interestPortion: toDollars(row.interestCents),
      principalPortion: toDollars(row.principalCents),
      closingBalance: toDollars(row.closingCents),
    })),
  });
}

// ─── Approval-gated posting ───

export interface PostLoanPaymentResult {
  journalEntryId: string;
  principalCents: number;
  interestCents: number;
  closingBalanceCents: number;
  paidOff: boolean;
}

/**
 * Post ONE scheduled payment as a balanced split journal. This is the
 * only path from the loan register to the ledger, and it runs only when
 * a user approves the payment (the route is the approval).
 */
export async function postLoanPayment(
  companyId: string,
  paymentId: string,
  userId: string | undefined,
  opts?: { actualAmountCents?: number; actualDate?: string }
): Promise<PostLoanPaymentResult> {
  return db.$transaction(async (tx) => {
    const payment = await tx.loanPayment.findFirst({
      where: { id: paymentId, loan: { companyId } },
      include: { loan: true },
    });
    if (!payment) throw new Error('Loan payment not found.');
    const loan = payment.loan;
    if (loan.kind !== 'term') throw new Error('Only term-loan payments post journals.');
    if (payment.status !== 'scheduled') {
      throw new Error(`This payment is already ${payment.status} — it cannot be posted again.`);
    }
    if (!loan.paymentAccountCode) {
      throw new Error('This loan has no bank account mapped — set the account payments come from first.');
    }

    const scheduledPaymentCents = decToCents(payment.paymentAmount);
    const actualAmountCents = opts?.actualAmountCents ?? scheduledPaymentCents;
    const actualDate = opts?.actualDate ?? dateToYmd(payment.dueDate);
    const split = splitActualPayment(decToCents(payment.interestPortion), actualAmountCents);

    const description = `Loan payment — ${loan.lenderName} (payment ${payment.periodNumber})`;
    const lines = buildSplitJournalLines({
      loanAccountCode: loan.loanAccountCode,
      interestAccountCode: loan.interestAccountCode,
      paymentAccountCode: loan.paymentAccountCode,
      principalCents: split.principalCents,
      interestCents: split.interestCents,
      description,
    });

    const entry = await postJournalEntry(
      {
        entryDate: ymdToDate(actualDate),
        description,
        sourceType: 'loan',
        sourceId: payment.id,
        createdBy: userId,
        lines,
      },
      companyId,
      tx
    );

    const openingCents = decToCents(payment.openingBalance);
    const closingCents = openingCents - split.principalCents;
    const balloon = loan.balloonAmount != null ? decToCents(loan.balloonAmount) : 0;
    const paidOff = closingCents <= balloon;

    await tx.loanPayment.update({
      where: { id: payment.id },
      data: {
        status: 'posted',
        actualAmount: toDollars(actualAmountCents),
        actualDate: ymdToDate(actualDate),
        journalEntryId: entry.id,
        interestPortion: toDollars(split.interestCents),
        principalPortion: toDollars(split.principalCents),
        closingBalance: toDollars(closingCents),
      },
    });

    if (paidOff) {
      await tx.loanPayment.deleteMany({
        where: { loanId: loan.id, status: 'scheduled', periodNumber: { gt: payment.periodNumber } },
      });
      await tx.loan.update({ where: { id: loan.id }, data: { status: 'paid_off' } });
    } else if (actualAmountCents !== scheduledPaymentCents) {
      // The actual differed — re-amortize the tail from the true balance.
      const nextDate = paymentDateAt(dateToYmd(payment.dueDate), loan.paymentFrequency, 1);
      await regenerateTail(tx, loan, payment.periodNumber, closingCents, nextDate, scheduledPaymentCents);
    }

    return {
      journalEntryId: entry.id,
      principalCents: split.principalCents,
      interestCents: split.interestCents,
      closingBalanceCents: closingCents,
      paidOff,
    };
  });
}

/**
 * Mark a scheduled payment skipped (missed). The obligation does not
 * disappear: the tail re-amortizes from the same opening balance one
 * period later, so the missed period's interest stays in the schedule
 * instead of drifting silently.
 */
export async function skipLoanPayment(companyId: string, paymentId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const payment = await tx.loanPayment.findFirst({
      where: { id: paymentId, loan: { companyId } },
      include: { loan: true },
    });
    if (!payment) throw new Error('Loan payment not found.');
    if (payment.status !== 'scheduled') {
      throw new Error(`This payment is already ${payment.status} — it cannot be skipped.`);
    }
    await tx.loanPayment.update({ where: { id: payment.id }, data: { status: 'skipped' } });
    const nextDate = paymentDateAt(dateToYmd(payment.dueDate), payment.loan.paymentFrequency, 1);
    await regenerateTail(
      tx,
      payment.loan,
      payment.periodNumber,
      decToCents(payment.openingBalance),
      nextDate,
      decToCents(payment.paymentAmount)
    );
  });
}

// ─── Three-way balance proof ───

export interface BalanceProof {
  asOf: string;
  scheduleBalanceCents: number;
  glBalanceCents: number | null; // null when the mapped account is missing
  statementBalanceCents: number | null;
  statementBalanceDate: string | null;
  scheduleVsGlCents: number | null;
  scheduleVsStatementCents: number | null;
  currentPortionCents: number;
  tiesOut: boolean;
}

/**
 * Schedule balance vs GL loan-account balance vs lender statement
 * balance, at a date. Differences are returned as numbers, never hidden:
 * a non-zero difference is the finding, and `tiesOut` is true only when
 * every available leg agrees to the cent.
 */
export async function balanceProof(
  loan: Loan,
  payments: LoanPayment[],
  asOfYmd: string
): Promise<BalanceProof> {
  const rows = loanToScheduleRows(payments);
  const scheduleBalanceCents = scheduleBalanceAtCents(rows, decToCents(loan.principal), asOfYmd);

  const account = await db.chartOfAccount.findFirst({
    where: { companyId: loan.companyId, code: loan.loanAccountCode },
    select: { balance: true },
  });
  const glBalanceCents = account ? decToCents(account.balance) : null;
  const statementBalanceCents =
    loan.statementBalance != null ? decToCents(loan.statementBalance) : null;

  const scheduleVsGlCents = glBalanceCents != null ? scheduleBalanceCents - glBalanceCents : null;
  const scheduleVsStatementCents =
    statementBalanceCents != null ? scheduleBalanceCents - statementBalanceCents : null;

  return {
    asOf: asOfYmd,
    scheduleBalanceCents,
    glBalanceCents,
    statementBalanceCents,
    statementBalanceDate: loan.statementBalanceDate ? dateToYmd(loan.statementBalanceDate) : null,
    scheduleVsGlCents,
    scheduleVsStatementCents,
    currentPortionCents: currentPortionCents(rows, asOfYmd),
    tiesOut:
      (scheduleVsGlCents == null || scheduleVsGlCents === 0) &&
      (scheduleVsStatementCents == null || scheduleVsStatementCents === 0),
  };
}
