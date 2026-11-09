import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePlatformAdmin } from '@/lib/platform/auth';
import { isOwnerPlan } from '@/lib/plans';
export const dynamic = 'force-dynamic';

// GET /api/subscriptions/plans — list all available subscription plans
// Public endpoint (no auth required — needed for signup page).
// The internal Owner plan is platform-only: it is filtered out for everyone
// except platform admins, so public/ordinary callers never see it.
export async function GET(_req: NextRequest) {
  try {
    const allPlans = await db.plan.findMany({
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

    // Optional admin check: never errors the public path — non-admins and
    // anonymous callers simply get the public catalogue.
    const { ctx: admin } = await requirePlatformAdmin();
    const plans = admin ? allPlans : allPlans.filter((p) => !isOwnerPlan(p));

    return NextResponse.json({ data: plans });
  } catch (error) {
    console.error('GET /api/subscriptions/plans error:', error);
    return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 });
  }
}
