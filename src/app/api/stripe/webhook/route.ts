import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/db';

// Stripe client — runtime only, types vary by installed version
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') || '';

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
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = session.subscription as string;
        const companyId = session.client_reference_id;

        if (companyId && subscriptionId) {
          const subscription: any = await stripe.subscriptions.retrieve(subscriptionId);
          const planId = (subscription.items?.data?.[0]?.price?.metadata?.planId) || 'plan_pro';

          await db.subscription.create({
            data: {
              companyId,
              planId,
              status: 'active',
              stripeSubscriptionId: subscriptionId,
              stripeCustomerId: (session as any).customer as string,
              currentPeriodStart: new Date((subscription.current_period_start || 0) * 1000),
              currentPeriodEnd: new Date((subscription.current_period_end || 0) * 1000),
            },
          });

          console.log('[stripe] Subscription activated:', companyId, planId);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub: any = event.data.object;
        const status: any = sub.status === 'active' ? 'active'
          : sub.status === 'past_due' ? 'past_due'
          : sub.status === 'canceled' ? 'canceled' : 'trialing';

        await db.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: {
            status,
            currentPeriodStart: new Date((sub.current_period_start || 0) * 1000),
            currentPeriodEnd: new Date((sub.current_period_end || 0) * 1000),
          },
        });

        console.log('[stripe] Subscription updated:', sub.id, status);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub: any = event.data.object;

        await db.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { status: 'canceled' },
        });

        console.log('[stripe] Subscription canceled:', sub.id);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[stripe] Webhook handler error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
