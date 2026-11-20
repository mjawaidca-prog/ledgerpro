import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { z } from 'zod';
import { ymdToDate } from '@/lib/loans/server';
import { advanceJson } from '@/lib/loans/present';

export const dynamic = 'force-dynamic';

const advanceSchema = z.object({
  kind: z.enum(['advance', 'repayment']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date'),
  amount: z.number().positive(),
  notes: z.string().max(500).optional().nullable(),
});

/**
 * Record one movement on a shareholder loan. Register only — recording
 * an advance never posts a journal. Advances are individual records
 * because s.15(2) attaches its deadline to each one.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const loan = await db.loan.findFirst({ where: { id: params.id, companyId } });
    if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 });
    if (loan.kind === 'term') {
      return NextResponse.json(
        { error: 'Advances belong to shareholder loans. Term loans move through their payment schedule.' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const parsed = advanceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const v = parsed.data;

    const advance = await db.$transaction(async (tx) => {
      const created = await tx.loanAdvance.create({
        data: {
          loanId: loan.id,
          kind: v.kind,
          advanceDate: ymdToDate(v.date),
          amount: v.amount,
          notes: v.notes ?? null,
          createdBy: userId,
        },
      });
      // The loan's principal mirrors its first advance (the register's
      // headline figure); later advances live in the advance rows.
      if (v.kind === 'advance' && Number(loan.principal) === 0) {
        await tx.loan.update({ where: { id: loan.id }, data: { principal: v.amount } });
      }
      return created;
    });

    await auditLog(companyId, userId, 'loan.advance.create', 'loan_advance', advance.id, {
      loanId: loan.id,
      kind: v.kind,
      amount: v.amount,
      date: v.date,
    });

    return NextResponse.json({ data: advanceJson(advance) }, { status: 201 });
  } catch (error) {
    console.error('POST /api/loans/[id]/advances error:', error);
    return NextResponse.json({ error: 'Failed to record advance' }, { status: 500 });
  }
}
