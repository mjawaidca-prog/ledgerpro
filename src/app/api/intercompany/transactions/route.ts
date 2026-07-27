import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireCompany, auditLog, closedPeriodGuard } from '@/lib/api-helpers';
import { postInterCompany } from '@/lib/intercompany/post';
import { suggestMirror } from '@/lib/intercompany/detect';
export const dynamic = 'force-dynamic';

// POST — post source + mirror in one database transaction
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
    });
    if (error) return error;

    const body = await req.json();
    const {
      sourceCompanyId,
      targetCompanyId,
      kind,
      date,
      amount,
      sourceOffsetAccountCode,
      targetOffsetAccountCode,
      memo,
      fxRate,
    } = body as {
      sourceCompanyId: string;
      targetCompanyId: string;
      kind: 'FUND_TRANSFER' | 'EXPENSE_ON_BEHALF' | 'RECHARGE' | 'JOURNAL';
      date: string;
      amount: string;
      sourceOffsetAccountCode: string;
      targetOffsetAccountCode: string;
      memo?: string;
      fxRate?: string;
    };

    if (!sourceCompanyId || !targetCompanyId || !kind || !date || !amount) {
      return NextResponse.json(
        { error: 'sourceCompanyId, targetCompanyId, kind, date, and amount are required' },
        { status: 400 }
      );
    }

    const entryDate = new Date(date);
    const guardError = await closedPeriodGuard(companyId, entryDate);
    if (guardError) return guardError;

    const ic = await postInterCompany(userId!, {
      sourceCompanyId,
      targetCompanyId,
      kind,
      date: entryDate,
      amount: new Prisma.Decimal(amount),
      sourceOffsetAccountCode,
      targetOffsetAccountCode,
      memo,
      fxRate: fxRate ? new Prisma.Decimal(fxRate) : undefined,
    });

    await auditLog(companyId, userId, 'intercompany.post', 'InterCompanyTransaction', ic.id, {
      reference: ic.reference,
      kind,
      amount,
    } as any);

    return NextResponse.json({ data: ic }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/intercompany/transactions error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to post inter-company transaction' },
      { status: 500 }
    );
  }
}

// GET — list inter-company transactions
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '20');
    const statusFilter = searchParams.get('status') as string | null;

    // Get all companies the user belongs to
    const memberships = await db.membership.findMany({
      where: { userId: userId! },
      select: { companyId: true },
    });
    const companyIds = memberships.map((m) => m.companyId);

    const where: any = {
      OR: [
        { sourceCompanyId: { in: companyIds } },
        { targetCompanyId: { in: companyIds } },
      ],
    };
    if (statusFilter) where.status = statusFilter;

    const [transactions, total] = await Promise.all([
      db.interCompanyTransaction.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          link: {
            include: {
              companyA: { select: { id: true, name: true } },
              companyB: { select: { id: true, name: true } },
            },
          },
          sourceEntry: {
            select: {
              id: true,
              entryDate: true,
              description: true,
              lines: { select: { glAccountCode: true, debit: true, credit: true } },
            },
          },
          mirrorEntry: {
            select: {
              id: true,
              entryDate: true,
              description: true,
              lines: { select: { glAccountCode: true, debit: true, credit: true } },
            },
          },
        },
      }),
      db.interCompanyTransaction.count({ where }),
    ]);

    return NextResponse.json({
      data: transactions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    console.error('GET /api/intercompany/transactions error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}
