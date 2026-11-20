import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { z } from 'zod';
import { buildSchedule, toCents } from '@/lib/loans/engine';
import {
  ensureInterestExpenseAccount,
  ensureShareholderAccount,
  ensureTermLoanAccount,
  persistSchedule,
  ymdToDate,
} from '@/lib/loans/server';
import {
  fiscalContextOf,
  loanJson,
  shareholderSummary,
  termLoanSummary,
} from '@/lib/loans/present';

export const dynamic = 'force-dynamic';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

const loanCreateSchema = z
  .object({
    kind: z.enum(['term', 'shareholder_advance', 'shareholder_funding']),
    lenderName: z.string().min(1).max(120),
    purpose: z.string().max(200).optional().nullable(),
    assetAccountCode: z.string().max(20).optional().nullable(),
    principal: z.number().min(0),
    annualRatePct: z.number().min(0).max(100).default(0),
    rateType: z.enum(['fixed', 'variable']).default('fixed'),
    compoundingPerYear: z.number().int().min(1).max(365).optional().nullable(),
    startDate: ymd,
    firstPaymentDate: ymd.optional().nullable(),
    paymentFrequency: z.enum(['monthly', 'biweekly', 'weekly']).default('monthly'),
    paymentAmount: z.number().positive().optional().nullable(),
    numberOfPayments: z.number().int().positive().max(1200).optional().nullable(),
    balloonAmount: z.number().min(0).optional().nullable(),
    loanAccountCode: z.string().max(20).optional().nullable(),
    interestAccountCode: z.string().max(20).optional().nullable(),
    paymentAccountCode: z.string().max(20).optional().nullable(),
    prescribedRatePct: z.number().min(0).max(100).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    // Shareholder loans may open with their first advance recorded.
    initialAdvance: z
      .object({ date: ymd, amount: z.number().positive(), notes: z.string().max(500).optional().nullable() })
      .optional()
      .nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'term') {
      if (v.principal <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['principal'], message: 'A term loan needs a principal amount.' });
      }
      if (v.paymentAmount == null && v.numberOfPayments == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentAmount'],
          message: 'Give either the payment amount (the schedule solves the term) or the number of payments (it solves the payment).',
        });
      }
      if (!v.paymentAccountCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentAccountCode'],
          message: 'Choose the bank account the payments come from.',
        });
      }
    }
  });

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { fiscalYearStart: true, firstFiscalYearEnd: true },
    });
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    const ctx = fiscalContextOf(company);
    const today = new Date().toISOString().slice(0, 10);

    const loans = await db.loan.findMany({
      where: { companyId },
      include: { payments: true, advances: true },
      orderBy: { createdAt: 'desc' },
    });

    const data = loans.map((loan) => ({
      ...loanJson(loan),
      summary:
        loan.kind === 'term'
          ? termLoanSummary(loan, loan.payments, ctx, today)
          : shareholderSummary(loan, loan.advances, ctx, today),
    }));

    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/loans error:', error);
    return NextResponse.json({ error: 'Failed to fetch loans' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const body = await req.json();
    const parsed = loanCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const v = parsed.data;

    // Fail fast on an unsolvable schedule before anything is written.
    if (v.kind === 'term') {
      try {
        buildSchedule({
          principalCents: toCents(v.principal),
          annualRatePct: v.annualRatePct,
          compoundingPerYear: v.compoundingPerYear,
          frequency: v.paymentFrequency,
          firstPaymentDate: v.firstPaymentDate ?? v.startDate,
          paymentCents: v.paymentAmount != null ? toCents(v.paymentAmount) : null,
          numberOfPayments: v.numberOfPayments,
          balloonCents: v.balloonAmount != null ? toCents(v.balloonAmount) : 0,
        });
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid loan terms' }, { status: 400 });
      }
    }

    // Any GL account the user named must exist in this company's chart.
    const namedCodes = [v.loanAccountCode, v.interestAccountCode, v.paymentAccountCode, v.assetAccountCode].filter(
      (c): c is string => !!c
    );
    if (namedCodes.length > 0) {
      const found = await db.chartOfAccount.findMany({
        where: { companyId, code: { in: namedCodes } },
        select: { code: true },
      });
      const foundCodes = new Set(found.map((a) => a.code));
      const missing = namedCodes.filter((c) => !foundCodes.has(c));
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `GL account(s) not found in this company's chart: ${missing.join(', ')}` },
          { status: 400 }
        );
      }
    }

    const loan = await db.$transaction(async (tx) => {
      // Chart hygiene: a loan creates its accounts properly rather than
      // borrowing a mixed expense account.
      let loanAccountCode = v.loanAccountCode ?? null;
      let interestAccountCode = v.interestAccountCode ?? null;
      if (v.kind === 'term') {
        if (!loanAccountCode) loanAccountCode = await ensureTermLoanAccount(tx, companyId, v.lenderName);
        if (!interestAccountCode) interestAccountCode = await ensureInterestExpenseAccount(tx, companyId);
      } else if (!loanAccountCode) {
        loanAccountCode = await ensureShareholderAccount(tx, companyId, v.kind);
      }

      const created = await tx.loan.create({
        data: {
          companyId,
          kind: v.kind,
          lenderName: v.lenderName,
          purpose: v.purpose ?? null,
          assetAccountCode: v.assetAccountCode ?? null,
          principal: v.kind === 'term' ? v.principal : (v.initialAdvance?.amount ?? v.principal),
          annualRatePct: v.annualRatePct,
          rateType: v.rateType,
          compoundingPerYear: v.compoundingPerYear ?? null,
          startDate: ymdToDate(v.startDate),
          firstPaymentDate: v.firstPaymentDate ? ymdToDate(v.firstPaymentDate) : null,
          paymentFrequency: v.paymentFrequency,
          paymentAmount: v.paymentAmount ?? null,
          numberOfPayments: v.numberOfPayments ?? null,
          balloonAmount: v.balloonAmount ?? null,
          loanAccountCode,
          interestAccountCode,
          paymentAccountCode: v.paymentAccountCode ?? null,
          prescribedRatePct: v.prescribedRatePct ?? null,
          notes: v.notes ?? null,
          createdBy: userId,
        },
      });

      if (created.kind === 'term') {
        await persistSchedule(tx, created);
      } else if (v.initialAdvance) {
        await tx.loanAdvance.create({
          data: {
            loanId: created.id,
            kind: 'advance',
            advanceDate: ymdToDate(v.initialAdvance.date),
            amount: v.initialAdvance.amount,
            notes: v.initialAdvance.notes ?? null,
            createdBy: userId,
          },
        });
      }
      return created;
    });

    await auditLog(companyId, userId, 'loan.create', 'loan', loan.id, {
      kind: loan.kind,
      lenderName: loan.lenderName,
      principal: Number(loan.principal),
    });

    const full = await db.loan.findUnique({
      where: { id: loan.id },
      include: { payments: true, advances: true },
    });
    return NextResponse.json({ data: { ...loanJson(full!), paymentCount: full!.payments.length } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/loans error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create loan' },
      { status: 500 }
    );
  }
}
