import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { ensureDefaultChartOfAccounts } from '@/lib/default-coa';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;
    await ensureDefaultChartOfAccounts(companyId);

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

// POST — create a new chart of account
export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const { code, name, type, detailType, parentCode, description } = body;

    if (!code || !name || !type) {
      return NextResponse.json({ error: 'Code, name, and type are required' }, { status: 400 });
    }

    if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(type)) {
      return NextResponse.json({ error: 'Invalid account type' }, { status: 400 });
    }

    // Check for duplicate code
    const existing = await db.chartOfAccount.findFirst({ where: { code, companyId } });
    if (existing) {
      return NextResponse.json({ error: `Account code ${code} already exists` }, { status: 409 });
    }

    // Verify parent exists if provided
    if (parentCode) {
      const parent = await db.chartOfAccount.findFirst({ where: { code: parentCode, companyId } });
      if (!parent) {
        return NextResponse.json({ error: `Parent account ${parentCode} not found` }, { status: 400 });
      }
    }

    const acct = await db.chartOfAccount.create({
      data: {
        companyId,
        code,
        name,
        type,
        detailType: detailType || null,
        parentCode: parentCode || null,
        description: description || null,
        balance: 0,
        active: true,
      },
    });

    return NextResponse.json({ data: acct }, { status: 201 });
  } catch (error) {
    console.error('POST /api/coa error:', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
