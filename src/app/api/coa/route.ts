import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const search = searchParams.get('search');
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    const where: any = { companyId };
    if (type && ['asset', 'liability', 'equity', 'income', 'expense'].includes(type)) {
      where.type = type;
    }
    if (activeOnly) where.active = true;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { detailType: { contains: search, mode: 'insensitive' } },
      ];
    }

    const accounts = await db.chartOfAccount.findMany({
      where,
      orderBy: { code: 'asc' },
    });

    // Group by type for display
    const grouped: Record<string, typeof accounts> = {};
    for (const acct of accounts) {
      const t = acct.type;
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(acct);
    }

    // Roll up parent balances
    const parents: Record<string, number> = {};
    for (const acct of accounts) {
      if (acct.parentCode) {
        parents[acct.parentCode] = (parents[acct.parentCode] || 0) + Number(acct.balance);
      }
    }

    // Summary totals
    const summary = {
      assets: accounts.filter(a => a.type === 'asset').reduce((s, a) => s + (a.parentCode ? 0 : Number(a.balance) + (parents[a.code] || 0)), 0),
      liabilities: accounts.filter(a => a.type === 'liability').reduce((s, a) => s + (a.parentCode ? 0 : Number(a.balance) + (parents[a.code] || 0)), 0),
      equity: accounts.filter(a => a.type === 'equity').reduce((s, a) => s + (a.parentCode ? 0 : Number(a.balance) + (parents[a.code] || 0)), 0),
      income: accounts.filter(a => a.type === 'income').reduce((s, a) => s + (a.parentCode ? 0 : Number(a.balance) + (parents[a.code] || 0)), 0),
      expenses: accounts.filter(a => a.type === 'expense').reduce((s, a) => s + (a.parentCode ? 0 : Number(a.balance) + (parents[a.code] || 0)), 0),
    };

    return NextResponse.json({
      data: accounts,
      grouped,
      summary,
      totalAccounts: accounts.length,
    });
  } catch (error) {
    console.error('GET /api/coa error:', error);
    return NextResponse.json({ error: 'Failed to fetch chart of accounts' }, { status: 500 });
  }
}
