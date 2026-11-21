/**
 * Loan statement service — the DB-facing half of statement capture
 * (Phase 3, item 3). Mirrors the receipt service's conventions
 * (company-scoped, bytes in Postgres, best-effort AI read after
 * upload) with one hard rule the whole feature stands on:
 *
 *   A statement changes NOTHING until a reviewer applies it.
 *
 * Upload stores the document and runs the read. The check is a pure
 * computation. Only `applyStatementToLoan` writes — it sets the
 * loan's statement-balance leg (the balance proof's third leg, until
 * now typed by hand) and, when the reviewer accepts the proposed
 * correction, re-amortizes the unposted tail from the statement
 * balance. Posted payments are never touched.
 */
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { buildSchedule, toCents, toDollars } from './engine';
import { dateToYmd, loanToScheduleRows, ymdToDate } from './server';
import {
  buildLoanDraftPrefill,
  computeScheduleCheck,
  planTailCorrection,
  validateLoanStatementUpload,
  type ScheduleCheck,
} from './statement';
import { runLoanStatementExtraction } from './statement-pipeline';
import {
  accountNumberLast4,
  maskAccountNumber,
  type LoanStatementExtraction,
} from './statement-ocr';

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function extractionOf(r: any): LoanStatementExtraction | null {
  const f = r.extractionFields;
  if (!f || typeof f !== 'object') return null;
  return f as LoanStatementExtraction;
}

/** API-safe statement shape: metadata + the read, account number masked. */
export function serializeLoanStatement(r: any) {
  const fields = extractionOf(r);
  return {
    id: r.id,
    companyId: r.companyId,
    loanId: r.loanId ?? null,
    originalFileName: r.originalFileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    extractionStatus: r.extractionStatus ?? 'pending',
    extractionProvider: r.extractionProvider ?? null,
    extractionError: r.extractionError ?? null,
    fields: fields
      ? {
          lenderName: fields.lenderName,
          statementDate: fields.statementDate,
          currentBalance: fields.currentBalance,
          paymentAmount: fields.paymentAmount,
          annualRatePct: fields.annualRatePct,
          nextPaymentDate: fields.nextPaymentDate,
          // The full account number never crosses the API — last 4 only.
          accountNumber: {
            value: null,
            masked: maskAccountNumber(fields.accountNumber?.value),
            last4: accountNumberLast4(fields.accountNumber?.value),
            confidence: fields.accountNumber?.confidence ?? null,
          },
        }
      : null,
    // The new-loan draft this statement produces (statement values +
    // the engine-derived remaining term, provenance-marked) — present
    // only when there is a read to draft from.
    prefill:
      r.extractionStatus === 'extracted' && fields ? buildLoanDraftPrefill(fields) : null,
    check:
      r.checkStatementBalance !== null && r.checkStatementBalance !== undefined
        ? {
            statementDate: r.checkStatementDate ? dateToYmd(new Date(r.checkStatementDate)) : null,
            statementBalance: num(r.checkStatementBalance),
            scheduleBalance: num(r.checkScheduleBalance),
            difference: num(r.checkDifference),
          }
        : null,
    correctionApplied: r.correctionApplied ?? false,
    appliedAt: r.appliedAt ? new Date(r.appliedAt).toISOString() : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function createLoanStatementFromUpload(args: {
  companyId: string;
  userId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const validation = validateLoanStatementUpload({ mimeType: args.mimeType, sizeBytes: args.buffer.length });
  if (!validation.ok) throw new Error(validation.error);

  const sha256 = createHash('sha256').update(args.buffer).digest('hex');
  const statement = await (db as any).loanStatement.create({
    data: {
      companyId: args.companyId,
      originalFileName: args.fileName.slice(0, 200),
      mimeType: args.mimeType,
      sizeBytes: args.buffer.length,
      sha256,
      storageBackend: 'db',
      imageData: args.buffer,
      createdBy: args.userId,
    },
  });

  // Best-effort AI read — the pipeline records its own outcome on the
  // row (extracted | failed | unavailable) and an AI outage must
  // never fail an upload.
  try {
    await runLoanStatementExtraction({ companyId: args.companyId, statementId: statement.id });
    const refreshed = await (db as any).loanStatement.findFirst({
      where: { id: statement.id, companyId: args.companyId },
    });
    if (refreshed) return serializeLoanStatement(refreshed);
  } catch {
    // The stored statement is the source of truth; return it as-is.
  }
  return serializeLoanStatement(statement);
}

export async function listLoanStatements(companyId: string) {
  const rows = await (db as any).loanStatement.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map(serializeLoanStatement);
}

export async function getLoanStatement(companyId: string, id: string) {
  const row = await (db as any).loanStatement.findFirst({ where: { id, companyId } });
  return row ? serializeLoanStatement(row) : null;
}

export async function getLoanStatementImage(companyId: string, id: string) {
  const row = await (db as any).loanStatement.findFirst({
    where: { id, companyId },
    select: { mimeType: true, originalFileName: true, imageData: true, storageBackend: true, storageKey: true },
  });
  if (!row) return null;
  if (row.storageBackend !== 'db' || !row.imageData) return null;
  return {
    mimeType: row.mimeType as string,
    fileName: row.originalFileName as string,
    buffer: Buffer.from(row.imageData as Uint8Array),
  };
}

// ─── The schedule check ─────────────────────────────────────────────

export interface StatementCheckPreview {
  check: {
    statementDate: string;
    statementBalance: number;
    scheduleBalance: number;
    difference: number;
    drift: ScheduleCheck['drift'];
  };
  /** Whether a re-amortization correction can be offered, and its anchor. */
  correction: {
    available: boolean;
    firstTailDate: string | null;
    startPeriod: number | null;
  };
}

async function loadStatementAndLoan(companyId: string, statementId: string, loanId: string) {
  const statement = await (db as any).loanStatement.findFirst({
    where: { id: statementId, companyId },
  });
  if (!statement) throw new Error('Loan statement not found.');
  const fields = extractionOf(statement);
  if (statement.extractionStatus !== 'extracted' || !fields) {
    throw new Error('This statement has no AI read yet — run the read before checking it against a loan.');
  }
  if (fields.currentBalance.value === null || fields.statementDate.value === null) {
    throw new Error('This statement’s read has no balance or statement date — the check needs both.');
  }
  const loan = await db.loan.findFirst({
    where: { id: loanId, companyId },
    include: { payments: { orderBy: { periodNumber: 'asc' } } },
  });
  if (!loan) throw new Error('Loan not found.');
  if (loan.kind !== 'term') throw new Error('Statement checks apply to term loans with a schedule.');
  return { statement, fields, loan };
}

/** Compute the check WITHOUT persisting anything — the review preview. */
export async function computeStatementCheck(
  companyId: string,
  statementId: string,
  loanId: string,
): Promise<StatementCheckPreview> {
  const { fields, loan } = await loadStatementAndLoan(companyId, statementId, loanId);
  const rows = loanToScheduleRows(loan.payments);
  const check = computeScheduleCheck({
    rows,
    principalCents: toCents(Number(loan.principal)),
    statementDate: fields.statementDate.value!,
    statementBalanceCents: toCents(fields.currentBalance.value!),
  });
  const plan = planTailCorrection(rows, check.statementDate);
  return {
    check: {
      statementDate: check.statementDate,
      statementBalance: toDollars(check.statementBalanceCents),
      scheduleBalance: toDollars(check.scheduleBalanceCents),
      difference: toDollars(check.differenceCents),
      drift: check.drift,
    },
    correction: {
      available: check.differenceCents !== 0 && plan.firstTailDate !== null,
      firstTailDate: plan.firstTailDate,
      startPeriod: plan.startPeriod,
    },
  };
}

/**
 * Apply a statement to a loan — the reviewer-confirmed write. Sets the
 * loan's statement-balance leg from the statement and records the
 * check on the statement row. When the reviewer accepts the
 * correction, the unposted tail re-amortizes from the statement
 * balance at the loan's contractual payment (the engine's
 * differing-actuals pattern). Posted payments are never rewritten;
 * a posted payment dated after the statement date blocks the
 * correction (it must be reconciled first) but not the apply itself.
 */
export async function applyStatementToLoan(args: {
  companyId: string;
  statementId: string;
  loanId: string;
  acceptCorrection: boolean;
}): Promise<{ check: StatementCheckPreview['check']; correctionApplied: boolean }> {
  const { statement, fields, loan } = await loadStatementAndLoan(args.companyId, args.statementId, args.loanId);
  const statementDate = fields.statementDate.value!;
  const statementBalanceCents = toCents(fields.currentBalance.value!);

  const rows = loanToScheduleRows(loan.payments);
  const check = computeScheduleCheck({
    rows,
    principalCents: toCents(Number(loan.principal)),
    statementDate,
    statementBalanceCents,
  });
  const plan = planTailCorrection(rows, statementDate);

  let correctionApplied = false;
  await db.$transaction(async (tx) => {
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        statementBalance: toDollars(statementBalanceCents),
        statementBalanceDate: ymdToDate(statementDate),
      },
    });

    if (args.acceptCorrection && check.differenceCents !== 0) {
      const postedAfter = loan.payments.some(
        (p) => p.status === 'posted' && dateToYmd(p.dueDate) > statementDate,
      );
      if (postedAfter) {
        throw new Error(
          'A posted payment falls after the statement date — reconcile that payment before re-amortizing the schedule.',
        );
      }
      if (plan.firstTailDate !== null && plan.startPeriod !== null) {
        await tx.loanPayment.deleteMany({
          where: { loanId: loan.id, status: 'scheduled', periodNumber: { gt: plan.anchorPeriod } },
        });
        const balloonCents = loan.balloonAmount != null ? toCents(Number(loan.balloonAmount)) : 0;
        if (statementBalanceCents > balloonCents) {
          const paymentCents =
            loan.paymentAmount != null ? toCents(Number(loan.paymentAmount)) : plan.regularPaymentCents;
          if (paymentCents == null) {
            throw new Error('This loan has no regular payment to re-amortize the tail with.');
          }
          const result = buildSchedule({
            principalCents: statementBalanceCents,
            openingBalanceCents: statementBalanceCents,
            annualRatePct: Number(loan.annualRatePct),
            compoundingPerYear: loan.compoundingPerYear,
            frequency: loan.paymentFrequency,
            firstPaymentDate: plan.firstTailDate,
            paymentCents,
            numberOfPayments: null,
            balloonCents,
            startPeriod: plan.startPeriod,
          });
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
        correctionApplied = true;
      }
    }

    await (tx as any).loanStatement.update({
      where: { id: statement.id },
      data: {
        loanId: loan.id,
        checkStatementDate: ymdToDate(statementDate),
        checkStatementBalance: toDollars(check.statementBalanceCents),
        checkScheduleBalance: toDollars(check.scheduleBalanceCents),
        checkDifference: toDollars(check.differenceCents),
        correctionApplied,
        appliedAt: new Date(),
      },
    });
  });

  return {
    check: {
      statementDate: check.statementDate,
      statementBalance: toDollars(check.statementBalanceCents),
      scheduleBalance: toDollars(check.scheduleBalanceCents),
      difference: toDollars(check.differenceCents),
      drift: check.drift,
    },
    correctionApplied,
  };
}
