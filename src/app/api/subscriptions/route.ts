import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';

// GET /api/subscriptions — get current subscription for the company
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const subscription = await db.subscription.findFirst({
      where: { companyId, status: { in: ['trialing', 'active', 'past_due'] } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ data: subscription });
  } catch (error) {
    console.error('GET /api/subscriptions error:', error);
    return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 });
  }
}

// PUT /api/subscriptions — switch plan
export async function PUT(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true, roles: ['owner', 'admin'] });
    if (error) return error;

    const body = await req.json();
    const { planId } = body;

    if (!planId) {
      return NextResponse.json({ error: 'planId is required' }, { status: 400 });
    }

    // Verify plan exists
    const plan = await db.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    // Get current subscription
    const current = await db.subscription.findFirst({
      where: { companyId, status: { in: ['trialing', 'active', 'past_due', 'canceled'] } },
      orderBy: { createdAt: 'desc' },
    });

    if (!current) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    // Don't allow switching to same plan
    if (current.planId === planId) {
      return NextResponse.json({
        data: { ...current, plan },
        message: 'Already on this plan.',
      });
    }

    // Update subscription plan
    const updated = await db.subscription.update({
      where: { id: current.id },
      data: { planId },
      include: { plan: true },
    });

    await auditLog(companyId, userId, 'subscription.update', 'subscription', current.id, {
      previousPlan: current.planId,
      newPlan: planId,
      planName: plan.name,
    });

    return NextResponse.json({
      data: updated,
      message: `Switched to ${plan.name}.`,
    });
  } catch (error) {
    console.error('PUT /api/subscriptions error:', error);
    return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 });
  }
}
