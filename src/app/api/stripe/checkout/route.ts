import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripe not configured — set STRIPE_SECRET_KEY' },
      { status: 500 }
    );
  }

  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json();
    const { planId, successUrl, cancelUrl } = body;

    if (!planId) {
      return NextResponse.json({ error: 'planId is required' }, { status: 400 });
    }

    // Look up the plan
    const plan = await db.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    if (!plan.stripePriceId) {
      return NextResponse.json(
        { error: `No Stripe price configured for plan "${plan.name}". Set stripePriceId in the Plan record.` },
        { status: 400 }
      );
    }

    // Get or create Stripe Customer for this company
    const subscription = await db.subscription.findFirst({
      where: { companyId, status: { in: ['trialing', 'active', 'past_due'] } },
      orderBy: { createdAt: 'desc' },
    });

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });

    // Get user email for Stripe customer
    const membership = await db.membership.findFirst({
      where: { companyId, role: 'owner' },
      include: { user: { select: { email: true } } },
    });

    let stripeCustomerId = subscription?.stripeCustomerId || null;

    if (!stripeCustomerId) {
      // Create a new Stripe Customer
      const customer = await stripe.customers.create({
        email: membership?.user?.email || undefined,
        name: company?.name || undefined,
        metadata: { companyId },
      });
      stripeCustomerId = customer.id;
    }

    // Build checkout session
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      client_reference_id: companyId,
      metadata: {
        companyId,
        planId: plan.id,
        userId: userId || '',
      },
      success_url: successUrl || `${process.env.NEXTAUTH_URL || 'http://localhost:3003'}/settings/billing?checkout=success`,
      cancel_url: cancelUrl || `${process.env.NEXTAUTH_URL || 'http://localhost:3003'}/settings/billing?checkout=canceled`,
    };

    const session = await stripe.checkout.sessions.create(sessionConfig);

    // Store the stripeCustomerId back if this was a new customer
    if (!subscription?.stripeCustomerId && subscription) {
      await db.subscription.update({
        where: { id: subscription.id },
        data: { stripeCustomerId },
      });
    }

    return NextResponse.json({ data: { url: session.url } });
  } catch (error: any) {
    console.error('[stripe] Checkout session error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
