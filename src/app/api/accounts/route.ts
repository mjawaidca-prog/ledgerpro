import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import {
  ensureDefaultChartOfAccounts,
  getDefaultFinancialAccountGlCode,
  isFinancialAccountKind,
} from '@/lib/default-coa';
import { getFinancialAccountBalances } from '@/lib/accounts';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;
    await ensureDefaultChartOfAccounts(companyId);

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

    const balances = await getFinancialAccountBalances(companyId, accounts);

    const enriched = accounts.map((a) => ({
      ...a,
      currentBalance: balances[a.id] ?? 0,
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
    if (!isFinancialAccountKind(kind)) {
      return NextResponse.json({ error: 'Account kind is invalid' }, { status: 400 });
    }

    await ensureDefaultChartOfAccounts(companyId);
    const resolvedGlAccountCode = glAccountCode || await getDefaultFinancialAccountGlCode(companyId, kind);

    if (resolvedGlAccountCode) {
      const linkedAccount = await db.chartOfAccount.findFirst({
        where: { companyId, code: resolvedGlAccountCode, active: true },
        select: { code: true },
      });
      if (!linkedAccount) {
        return NextResponse.json({ error: 'Selected GL account was not found' }, { status: 400 });
      }
    }

    const account = await db.financialAccount.create({
      data: {
        name,
        kind,
        mask: mask || null,
        glAccountCode: resolvedGlAccountCode || null,
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
