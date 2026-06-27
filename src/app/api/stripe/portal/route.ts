import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';

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
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json();
    const returnUrl = body.returnUrl || `${process.env.NEXTAUTH_URL || 'http://localhost:3003'}/settings/billing`;

    // Get the subscription with stripeCustomerId
    const subscription = await db.subscription.findFirst({
      where: { companyId, status: { in: ['trialing', 'active', 'past_due'] } },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription?.stripeCustomerId) {
      return NextResponse.json(
        { error: 'No Stripe customer found. Please upgrade to a paid plan first.' },
        { status: 400 }
      );
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: returnUrl,
    });

    return NextResponse.json({ data: { url: portalSession.url } });
  } catch (error: any) {
    console.error('[stripe] Portal session error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create portal session' },
      { status: 500 }
    );
  }
}
