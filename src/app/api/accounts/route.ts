import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const accounts = await db.financialAccount.findMany({
      where: { companyId, isActive: true },
      orderBy: { kind: 'asc' },
      include: {
        _count: { select: { transactions: true } },
        transactions: {
          where: { status: 'toreview' },
          select: { id: true },
        },
      },
    });

    const enriched = accounts.map((a) => ({
      ...a,
      pendingReviewCount: a.transactions.length,
    }));

    return NextResponse.json({ data: enriched });
  } catch (error) {
    console.error('GET /api/accounts error:', error);
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const { name, kind, mask, glAccountCode, displayColor, logoInitials } = body;

    if (!name || !kind) {
      return NextResponse.json({ error: 'Name and kind are required' }, { status: 400 });
    }

    const account = await db.financialAccount.create({
      data: {
        name,
        kind,
        mask: mask || null,
        glAccountCode: glAccountCode || null,
        displayColor: displayColor || '#1f6feb',
        logoInitials: logoInitials || name.slice(0, 2).toUpperCase(),
        companyId,
      },
    });

    return NextResponse.json({ data: account }, { status: 201 });
  } catch (error) {
    console.error('POST /api/accounts error:', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
