import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { parseTrialBalanceCSV } from '@/lib/trial-balance-import';
export const dynamic = 'force-dynamic';

// POST — parse an uploaded trial balance CSV and match rows against the
// existing Chart of Accounts. Doesn't write anything — /confirm does that.
export async function POST(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const { csvText } = body as { csvText: string };
    if (!csvText || typeof csvText !== 'string') {
      return NextResponse.json({ error: 'No file content provided' }, { status: 400 });
    }

    let parsedRows;
    try {
      parsedRows = parseTrialBalanceCSV(csvText);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || 'Failed to parse file' }, { status: 400 });
    }

    if (parsedRows.length === 0) {
      return NextResponse.json({ error: 'No non-zero balance rows found in file' }, { status: 400 });
    }

    const codes = parsedRows.map((r) => r.code);
    const existingAccounts = await db.chartOfAccount.findMany({
      where: { companyId, code: { in: codes } },
      select: { code: true, name: true, type: true, active: true },
    });
    const existingByCode = new Map(existingAccounts.map((a) => [a.code, a]));

    const rows = parsedRows.map((r) => {
      const existing = existingByCode.get(r.code);
      return {
        code: r.code,
        name: r.name,
        debit: r.debit,
        credit: r.credit,
        matched: !!existing,
        existingName: existing?.name ?? null,
        existingType: existing?.type ?? null,
        existingActive: existing?.active ?? null,
      };
    });

    const totalDebit = Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100;
    const totalCredit = Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;
    const unmatchedCount = rows.filter((r) => !r.matched).length;

    return NextResponse.json({
      data: {
        rows,
        totalDebit,
        totalCredit,
        isBalanced: Math.abs(totalDebit - totalCredit) < 0.02,
        unmatchedCount,
      },
    });
  } catch (error: any) {
    console.error('POST /api/import/trial-balance/parse error:', error);
    return NextResponse.json({ error: error.message || 'Failed to parse trial balance' }, { status: 500 });
  }
}
