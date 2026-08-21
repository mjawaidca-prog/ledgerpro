import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/imports — recent imports for the accounts page table. */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const limit = Math.min(Number(searchParams.get('limit') ?? 25) || 25, 100);

    const where: any = { companyId };
    if (accountId) where.financialAccountId = accountId;

    const imports = await db.statementImport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { account: { select: { name: true, currency: true } } },
    });

    return NextResponse.json({
      data: imports.map((i) => ({
        id: i.id,
        date: i.createdAt.toISOString().slice(0, 10),
        fileName: i.fileName,
        accountName: i.account.name,
        rows: i.rowsTotal,
        skipped: i.rowsSkippedDuplicate + i.rowsSkippedLocked,
        status: i.status,
        reversibleUntil: i.reversibleUntil,
        reversedAt: i.reversedAt,
      })),
    });
  } catch (err) {
    console.error('GET /api/imports error:', err);
    return NextResponse.json({ error: 'Failed to load imports' }, { status: 500 });
  }
}
