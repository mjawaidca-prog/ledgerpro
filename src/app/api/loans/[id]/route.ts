import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { z } from 'zod';
import { balanceProof, dateToYmd, persistSchedule, ymdToDate } from '@/lib/loans/server';
import { buildSchedule, paymentDateAt, toCents } from '@/lib/loans/engine';
import {
  advanceJson,
  fiscalContextOf,
  loanJson,
  paymentJson,
  shareholderSummary,
  termLoanSummary,
} from '@/lib/loans/present';

export const dynamic = 'force-dynamic';

async function loadLoan(companyId: string, id: string) {
  return db.loan.findFirst({
    where: { id, companyId },
    include: {
      payments: { orderBy: { periodNumber: 'asc' } },
      advances: { orderBy: { advanceDate: 'asc' } },
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const loan = await loadLoan(companyId, params.id);
    if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 });

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { fiscalYearStart: true, firstFiscalYearEnd: true },
    });
    const ctx = fiscalContextOf(company!);
    const today = new Date().toISOString().slice(0, 10);
    const proof = await balanceProof(loan, loan.payments, today);
    const accountCodes = [loan.loanAccountCode, loan.interestAccountCode, loan.paymentAccountCode, loan.assetAccountCode].filter(
      (c): c is string => !!c
    );
    const accounts = await db.chartOfAccount.findMany({
      where: { companyId, code: { in: accountCodes } },
      select: { code: true, name: true },
    });

    return NextResponse.json({
      data: {
        ...loanJson(loan),
        accounts,
        summary:
          loan.kind === 'term'
            ? termLoanSummary(loan, loan.payments, ctx, today)
            : shareholderSummary(loan, loan.advances, ctx, today),
        proof: {
          asOf: proof.asOf,
          scheduleBalance: proof.scheduleBalanceCents / 100,
          glBalance: proof.glBalanceCents != null ? proof.glBalanceCents / 100 : null,
          statementBalance: proof.statementBalanceCents != null ? proof.statementBalanceCents / 100 : null,
          statementBalanceDate: proof.statementBalanceDate,
          scheduleVsGl: proof.scheduleVsGlCents != null ? proof.scheduleVsGlCents / 100 : null,
          scheduleVsStatement: proof.scheduleVsStatementCents != null ? proof.scheduleVsStatementCents / 100 : null,
          currentPortion: proof.currentPortionCents / 100,
          tiesOut: proof.tiesOut,
        },
        payments: loan.payments.map(paymentJson),
        advances: loan.advances.map(advanceJson),
      },
    });
  } catch (error) {
    console.error('GET /api/loans/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch loan' }, { status: 500 });
  }
}

const loanPatchSchema = z.object({
  lenderName: z.string().min(1).max(120).optional(),
  purpose: z.string().max(200).optional().nullable(),
  status: z.enum(['active', 'paid_off', 'closed']).optional(),
  annualRatePct: z.number().min(0).max(100).optional(),
  rateType: z.enum(['fixed', 'variable']).optional(),
  paymentAmount: z.number().positive().optional().nullable(),
  numberOfPayments: z.number().int().positive().max(1200).optional().nullable(),
  paymentAccountCode: z.string().max(20).optional().nullable(),
  interestAccountCode: z.string().max(20).optional().nullable(),
  statementBalance: z.number().min(0).optional().nullable(),
  statementBalanceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  prescribedRatePct: z.number().min(0).max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // When terms change on a term loan, the unposted schedule is rebuilt
  // from the current balance (posted payments are never rewritten).
  regenerateSchedule: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const loan = await loadLoan(companyId, params.id);
    if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 });

    const body = await req.json();
    const parsed = loanPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const v = parsed.data;

    const namedCodes = [v.paymentAccountCode, v.interestAccountCode].filter((c): c is string => !!c);
    if (namedCodes.length > 0) {
      const found = await db.chartOfAccount.findMany({
        where: { companyId, code: { in: namedCodes } },
        select: { code: true },
      });
      if (found.length !== namedCodes.length) {
        return NextResponse.json({ error: 'A named GL account was not found in this company.' }, { status: 400 });
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const next = await tx.loan.update({
        where: { id: loan.id },
        data: {
          lenderName: v.lenderName ?? undefined,
          purpose: v.purpose === undefined ? undefined : v.purpose,
          status: v.status ?? undefined,
          annualRatePct: v.annualRatePct ?? undefined,
          rateType: v.rateType ?? undefined,
          paymentAmount: v.paymentAmount === undefined ? undefined : v.paymentAmount,
          numberOfPayments: v.numberOfPayments === undefined ? undefined : v.numberOfPayments,
          paymentAccountCode: v.paymentAccountCode === undefined ? undefined : v.paymentAccountCode,
          interestAccountCode: v.interestAccountCode === undefined ? undefined : v.interestAccountCode,
          statementBalance: v.statementBalance === undefined ? undefined : v.statementBalance,
          statementBalanceDate:
            v.statementBalanceDate === undefined
              ? undefined
              : v.statementBalanceDate
                ? ymdToDate(v.statementBalanceDate)
                : null,
          prescribedRatePct: v.prescribedRatePct === undefined ? undefined : v.prescribedRatePct,
          notes: v.notes === undefined ? undefined : v.notes,
        },
      });

      if (v.regenerateSchedule && next.kind === 'term') {
        const posted = await tx.loanPayment.findMany({
          where: { loanId: next.id, status: 'posted' },
          orderBy: { periodNumber: 'asc' },
        });
        if (posted.length === 0) {
          // Nothing posted yet: rebuild the whole schedule from the new terms.
          await tx.loanPayment.deleteMany({ where: { loanId: next.id } });
          await persistSchedule(tx, next);
        } else {
          // Posted history is immutable: rebuild only the unposted tail
          // from the last posted closing balance.
          const last = posted[posted.length - 1];
          await tx.loanPayment.deleteMany({
            where: { loanId: next.id, status: 'scheduled' },
          });
          const nextDate = paymentDateAt(dateToYmd(last.dueDate), next.paymentFrequency, 1);
          // Solve from whichever the loan carries: a stated payment, or
          // the payments remaining under the original term.
          const remainingPayments =
            next.paymentAmount == null && next.numberOfPayments != null
              ? Math.max(1, next.numberOfPayments - posted.length)
              : null;
          const result = buildSchedule({
            principalCents: toCents(Number(last.closingBalance)),
            annualRatePct: Number(next.annualRatePct),
            compoundingPerYear: next.compoundingPerYear,
            frequency: next.paymentFrequency,
            firstPaymentDate: nextDate,
            paymentCents: next.paymentAmount != null ? toCents(Number(next.paymentAmount)) : null,
            numberOfPayments: remainingPayments,
            balloonCents: next.balloonAmount != null ? toCents(Number(next.balloonAmount)) : 0,
            openingBalanceCents: toCents(Number(last.closingBalance)),
            startPeriod: last.periodNumber + 1,
          });
          await tx.loanPayment.createMany({
            data: result.rows.map((row) => ({
              loanId: next.id,
              periodNumber: row.period,
              dueDate: ymdToDate(row.date),
              openingBalance: row.openingCents / 100,
              paymentAmount: row.paymentCents / 100,
              interestPortion: row.interestCents / 100,
              principalPortion: row.principalCents / 100,
              closingBalance: row.closingCents / 100,
            })),
          });
        }
      }
      return next;
    });

    await auditLog(companyId, userId, 'loan.update', 'loan', loan.id, { fields: Object.keys(v) });
    return NextResponse.json({ data: loanJson(updated) });
  } catch (error) {
    console.error('PATCH /api/loans/[id] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update loan' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin'],
    });
    if (error) return error;

    const loan = await loadLoan(companyId, params.id);
    if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 });

    const postedCount = loan.payments.filter((p) => p.status === 'posted').length;
    if (postedCount > 0) {
      return NextResponse.json(
        {
          error:
            'This loan has posted payments linked to journal entries, so it cannot be deleted. Close it instead (status: closed).',
        },
        { status: 400 }
      );
    }

    await db.loan.delete({ where: { id: loan.id } });
    await auditLog(companyId, userId, 'loan.delete', 'loan', loan.id, { lenderName: loan.lenderName });
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    console.error('DELETE /api/loans/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete loan' }, { status: 500 });
  }
}
