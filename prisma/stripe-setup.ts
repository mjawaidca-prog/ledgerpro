/**
 * Programmatic Stripe setup — creates Products & Prices via the Stripe API.
 * No need to manually configure anything in the Stripe Dashboard.
 * Called from seed-prod.ts (or can be run standalone: npx tsx prisma/stripe-setup.ts)
 */
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

interface PlanDef {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number; // in dollars
}

const PAID_PLANS: PlanDef[] = [
  {
    id: 'plan_basic',
    name: 'Basic',
    description: 'Essential accounting for solo entrepreneurs. 2 users, CSV + PDF export, full reports.',
    monthlyPrice: 29,
  },
  {
    id: 'plan_pro',
    name: 'Pro',
    description: 'Growing businesses — 10 users, 5 companies, bank feeds, custom reports, priority support.',
    monthlyPrice: 79,
  },
  {
    id: 'plan_enterprise',
    name: 'Enterprise',
    description: 'Scale without limits — 50 users, 25 companies, unlimited transactions, white label, API access.',
    monthlyPrice: 199,
  },
];

export async function setupStripeProducts() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.log('  ⏭  Stripe not configured — skipping product setup (set STRIPE_SECRET_KEY)');
    return;
  }

  const stripe = new Stripe(key);
  console.log('  🔗 Connected to Stripe — creating products & prices...\n');

  for (const plan of PAID_PLANS) {
    // Check if we already have a valid stripePriceId in DB
    const existingPlan = await db.plan.findUnique({ where: { id: plan.id } });
    const existingPriceId = existingPlan?.stripePriceId;

    // If the price ID looks real (starts with "price_"), verify it exists in Stripe
    if (existingPriceId && existingPriceId.startsWith('price_')) {
      try {
        const price = await stripe.prices.retrieve(existingPriceId);
        if (price && price.active) {
          console.log(`  ✓ ${plan.name}: price ${existingPriceId} already exists in Stripe`);
          continue;
        }
      } catch {
        console.log(`  ⚠ ${plan.name}: stored price ${existingPriceId} not found in Stripe — recreating...`);
      }
    }

    // Create or update the Stripe Product
    let product: Stripe.Product;
    const productName = `Ledger Pro — ${plan.name}`;

    // Search for existing product
    const existingProducts = await stripe.products.search({
      query: `name:"${productName}"`,
      limit: 1,
    });

    if (existingProducts.data.length > 0) {
      product = existingProducts.data[0];
      // Update description if needed
      product = await stripe.products.update(product.id, {
        description: plan.description,
      });
      console.log(`  📦 ${plan.name}: found existing product ${product.id}`);
    } else {
      product = await stripe.products.create({
        name: productName,
        description: plan.description,
      });
      console.log(`  📦 ${plan.name}: created product ${product.id}`);
    }

    // Create the monthly price
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(plan.monthlyPrice * 100), // Stripe uses cents
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: {
        planId: plan.id,
        planName: plan.name,
      },
    });

    console.log(`  💰 ${plan.name}: created price ${price.id} — $${plan.monthlyPrice}/mo`);

    // Update the Plan record with the real Stripe price ID
    await db.plan.update({
      where: { id: plan.id },
      data: { stripePriceId: price.id },
    });

    console.log(`  ✅ ${plan.name}: Plan.stripePriceId → ${price.id}\n`);
  }

  console.log('  🎉 Stripe setup complete.\n');
}

// Allow running standalone: npx tsx prisma/stripe-setup.ts
if (require.main === module) {
  setupStripeProducts()
    .catch(console.error)
    .finally(() => db.$disconnect());
}
