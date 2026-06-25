import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const status = searchParams.get('status');
    const categoryId = searchParams.get('categoryId');
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') ?? 'date';
    const dir = searchParams.get('dir') ?? 'desc';
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '50');
    const skip = (page - 1) * limit;

    const where: any = { companyId };
    if (accountId) where.financialAccountId = accountId;
    if (status) {
      if (status === 'needsreview') {
        where.status = { in: ['toreview', 'transfer'] };
      } else {
        where.status = status;
      }
    }
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { merchant: { contains: search, mode: 'insensitive' } },
        { rawStatementText: { contains: search, mode: 'insensitive' } },
      ];
    }

    const allowedSorts = ['date', 'amount', 'description', 'status'];
    const orderBy: any = {};
    orderBy[allowedSorts.includes(sort) ? sort : 'date'] = dir === 'asc' ? 'asc' : 'desc';

    const [transactions, total, reviewCount] = await Promise.all([
      db.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          account: { select: { id: true, name: true, mask: true, kind: true, displayColor: true } },
          category: { select: { id: true, code: true, name: true } },
          transferMatch: { select: { id: true, confirmed: true } },
        },
      }),
      db.transaction.count({ where }),
      db.transaction.count({ where: { ...where, status: 'toreview' } }),
    ]);

    return NextResponse.json({
      data: transactions,
      summary: { toReview: reviewCount },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('GET /api/transactions error:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}
