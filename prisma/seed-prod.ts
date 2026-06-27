/**
 * Production seed — clean database with plans, tax rates, and starter COA template only.
 * No demo users or transactions.
 * Run: npx tsx prisma/seed-prod.ts
 */
import { PrismaClient } from '@prisma/client';
import { setupStripeProducts } from './stripe-setup';

const db = new PrismaClient();

async function main() {
  console.log('🌱 Production seed — plans, tax rates, Stripe setup\n');

  // ─── Plans ───
  const plans = await Promise.all([
    db.plan.upsert({ where: { id: 'plan_free' }, update: {}, create: { id: 'plan_free', name: 'Free Trial', monthlyPrice: 0, annualPrice: 0, maxUsers: 1, maxCompanies: 1, maxTransactions: 100, maxBankAccounts: 1, csvExport: true, pdfReports: false, bankFeeds: false, customReports: false, prioritySupport: false, whiteLabel: false } }),
    db.plan.upsert({ where: { id: 'plan_basic' }, update: {}, create: { id: 'plan_basic', name: 'Basic', monthlyPrice: 29, annualPrice: 290, maxUsers: 2, maxCompanies: 1, maxTransactions: 1000, maxBankAccounts: 3, csvExport: true, pdfReports: true, bankFeeds: false, customReports: false, prioritySupport: false, whiteLabel: false } }),
    db.plan.upsert({ where: { id: 'plan_pro' }, update: {}, create: { id: 'plan_pro', name: 'Pro', monthlyPrice: 79, annualPrice: 790, maxUsers: 10, maxCompanies: 5, maxTransactions: 10000, maxBankAccounts: 10, csvExport: true, pdfReports: true, bankFeeds: true, customReports: true, prioritySupport: true, whiteLabel: false } }),
    db.plan.upsert({ where: { id: 'plan_enterprise' }, update: {}, create: { id: 'plan_enterprise', name: 'Enterprise', monthlyPrice: 199, annualPrice: 1990, maxUsers: 50, maxCompanies: 25, maxTransactions: 100000, maxBankAccounts: 50, csvExport: true, pdfReports: true, bankFeeds: true, customReports: true, prioritySupport: true, whiteLabel: true } }),
  ]);
  console.log(`  ✓ ${plans.length} subscription plans`);

  // ─── Stripe Products & Prices (programmatic, no dashboard needed) ───
  await setupStripeProducts();

  // ─── Canadian Tax Rates ───
  const taxRates = [
    { province: 'AB' as const, provinceName: 'Alberta', gst: 5.0, hst: 0, pst: 0, totalSalesTax: 5.0, label: '5% GST' },
    { province: 'BC' as const, provinceName: 'British Columbia', gst: 5.0, hst: 0, pst: 7.0, totalSalesTax: 12.0, label: '5% GST + 7% PST' },
    { province: 'MB' as const, provinceName: 'Manitoba', gst: 5.0, hst: 0, pst: 7.0, totalSalesTax: 12.0, label: '5% GST + 7% PST' },
    { province: 'NB' as const, provinceName: 'New Brunswick', gst: 0, hst: 15, pst: 0, totalSalesTax: 15.0, label: '15% HST' },
    { province: 'NL' as const, provinceName: 'Newfoundland and Labrador', gst: 0, hst: 15, pst: 0, totalSalesTax: 15.0, label: '15% HST' },
    { province: 'NS' as const, provinceName: 'Nova Scotia', gst: 0, hst: 15, pst: 0, totalSalesTax: 15.0, label: '15% HST' },
    { province: 'NT' as const, provinceName: 'Northwest Territories', gst: 5.0, hst: 0, pst: 0, totalSalesTax: 5.0, label: '5% GST' },
    { province: 'NU' as const, provinceName: 'Nunavut', gst: 5.0, hst: 0, pst: 0, totalSalesTax: 5.0, label: '5% GST' },
    { province: 'ON' as const, provinceName: 'Ontario', gst: 0, hst: 13, pst: 0, totalSalesTax: 13.0, label: '13% HST' },
    { province: 'PE' as const, provinceName: 'Prince Edward Island', gst: 0, hst: 15, pst: 0, totalSalesTax: 15.0, label: '15% HST' },
    { province: 'QC' as const, provinceName: 'Quebec', gst: 5.0, hst: 0, pst: 9.975, totalSalesTax: 14.975, label: '5% GST + 9.975% QST' },
    { province: 'SK' as const, provinceName: 'Saskatchewan', gst: 5.0, hst: 0, pst: 6.0, totalSalesTax: 11.0, label: '5% GST + 6% PST' },
    { province: 'YT' as const, provinceName: 'Yukon', gst: 5.0, hst: 0, pst: 0, totalSalesTax: 5.0, label: '5% GST' },
  ];
  for (const tr of taxRates) {
    await db.taxRate.upsert({ where: { province: tr.province }, update: tr, create: tr });
  }
  console.log(`  ✓ ${taxRates.length} tax rates`);

  console.log('\n✅ Production seed complete.\n');
}

main().catch(console.error).finally(() => db.$disconnect());
