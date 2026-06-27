import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);

    // Fetch all asset, liability, and equity accounts
    const accounts = await db.chartOfAccount.findMany({
      where: {
        type: { in: ['asset', 'liability', 'equity'] },
        active: true,
        companyId,
      },
      orderBy: { code: 'asc' },
    });

    // Group by type
    const assets = accounts.filter((a) => a.type === 'asset');
    const liabilities = accounts.filter((a) => a.type === 'liability');
    const equity = accounts.filter((a) => a.type === 'equity');

    // Separate current vs non-current assets (simple heuristic: codes < 2000 are current)
    const currentAssets = assets.filter((a) => parseInt(a.code) < 2000);
    const nonCurrentAssets = assets.filter((a) => parseInt(a.code) >= 2000);

    const currentLiabilities = liabilities.filter((a) => parseInt(a.code) >= 2000 && parseInt(a.code) < 3000);
    const nonCurrentLiabilities = liabilities.filter((a) => parseInt(a.code) >= 3000);

    const totalCurrentAssets = currentAssets.reduce((s, a) => s + Number(a.balance), 0);
    const totalNonCurrentAssets = nonCurrentAssets.reduce((s, a) => s + Number(a.balance), 0);
    const totalAssets = totalCurrentAssets + totalNonCurrentAssets;

    const totalCurrentLiabilities = currentLiabilities.reduce((s, a) => s + Number(a.balance), 0);
    const totalNonCurrentLiabilities = nonCurrentLiabilities.reduce((s, a) => s + Number(a.balance), 0);
    const totalLiabilities = totalCurrentLiabilities + totalNonCurrentLiabilities;

    const totalEquity = equity.reduce((s, a) => s + Number(a.balance), 0);
    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

    // Verify the fundamental accounting equation
    const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;

    return NextResponse.json({
      data: {
        asOf,
        isBalanced,
        assets: {
          current: {
            accounts: currentAssets.map((a) => ({
              code: a.code,
              name: a.name,
              detailType: a.detailType,
              balance: Number(a.balance),
            })),
            total: totalCurrentAssets,
          },
          nonCurrent: {
            accounts: nonCurrentAssets.map((a) => ({
              code: a.code,
              name: a.name,
              detailType: a.detailType,
              balance: Number(a.balance),
            })),
            total: totalNonCurrentAssets,
          },
          total: totalAssets,
        },
        liabilities: {
          current: {
            accounts: currentLiabilities.map((a) => ({
              code: a.code,
              name: a.name,
              detailType: a.detailType,
              balance: Number(a.balance),
            })),
            total: totalCurrentLiabilities,
          },
          nonCurrent: {
            accounts: nonCurrentLiabilities.map((a) => ({
              code: a.code,
              name: a.name,
              detailType: a.detailType,
              balance: Number(a.balance),
            })),
            total: totalNonCurrentLiabilities,
          },
          total: totalLiabilities,
        },
        equity: {
          accounts: equity.map((a) => ({
            code: a.code,
            name: a.name,
            detailType: a.detailType,
            balance: Number(a.balance),
          })),
          total: totalEquity,
        },
        totalLiabilitiesAndEquity,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/balance-sheet error:', error);
    return NextResponse.json({ error: 'Failed to generate balance sheet' }, { status: 500 });
  }
}
