import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/db';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured — set STRIPE_SECRET_KEY' }, { status: 500 });
  }

  const body = await req.text();
  const sig = req.headers.get('stripe-signature') || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error('[stripe] Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const subscriptionId = session.subscription as string;
        const companyId = session.metadata?.companyId || session.client_reference_id;
        // Plan ID from checkout metadata (we set this explicitly), fallback to price metadata
        const checkoutPlanId = session.metadata?.planId;

        if (companyId && subscriptionId) {
          const sub: any = await stripe.subscriptions.retrieve(subscriptionId);
          const planId = checkoutPlanId
            || (sub.items?.data?.[0]?.price?.metadata?.planId)
            || 'plan_pro';

          // Upsert: update existing trial subscription, or create if none exists
          const existing = await db.subscription.findFirst({
            where: { companyId, status: { in: ['trialing', 'active', 'past_due'] } },
            orderBy: { createdAt: 'desc' },
          });

          const subData = {
            planId,
            status: 'active' as const,
            stripeSubscriptionId: subscriptionId,
            stripeCustomerId: (session.customer as string) || existing?.stripeCustomerId || undefined,
            currentPeriodStart: new Date((sub.current_period_start || 0) * 1000),
            currentPeriodEnd: new Date((sub.current_period_end || 0) * 1000),
            trialEndsAt: null,
          };

          if (existing) {
            await db.subscription.update({
              where: { id: existing.id },
              data: subData,
            });
            console.log('[stripe] Subscription upgraded:', companyId, existing.id, '→', planId);
          } else {
            await db.subscription.create({
              data: { ...subData, companyId },
            });
            console.log('[stripe] Subscription created:', companyId, planId);
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub: any = event.data.object;
        const status: any = ['active', 'past_due', 'canceled'].includes(sub.status) ? sub.status : 'trialing';

        await db.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: {
            status,
            currentPeriodStart: new Date((sub.current_period_start || 0) * 1000),
            currentPeriodEnd: new Date((sub.current_period_end || 0) * 1000),
          },
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub: any = event.data.object;
        await db.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { status: 'canceled' },
        });
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[stripe] Webhook handler error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
