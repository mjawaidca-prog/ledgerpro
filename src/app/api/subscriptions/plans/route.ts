import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';

// GET /api/subscriptions/plans — list all available subscription plans
// Public endpoint (no auth required — needed for signup page)
export async function GET(_req: NextRequest) {
  try {
    const plans = await db.plan.findMany({
      orderBy: { monthlyPrice: 'asc' },
      select: {
        id: true,
        name: true,
        monthlyPrice: true,
        annualPrice: true,
        maxUsers: true,
        maxCompanies: true,
        maxTransactions: true,
        maxBankAccounts: true,
        csvExport: true,
        pdfReports: true,
        bankFeeds: true,
        customReports: true,
        prioritySupport: true,
        whiteLabel: true,
      },
    });

    return NextResponse.json({ data: plans });
  } catch (error) {
    console.error('GET /api/subscriptions/plans error:', error);
    return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 });
  }
}
