import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import crypto from 'crypto';
export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  companyName: z.string().min(2, 'Company name must be at least 2 characters'),
});

// Default Chart of Accounts for new companies
const DEFAULT_COA = [
  { code: '1000', name: 'Bank Accounts', type: 'asset' as const, detailType: 'Bank' },
  { code: '1010', name: 'Business Checking', type: 'asset' as const, detailType: 'Bank', parentCode: '1000' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset' as const, detailType: 'Accounts receivable' },
  { code: '2000', name: 'Credit Cards', type: 'liability' as const, detailType: 'Credit card' },
  { code: '2200', name: 'Accounts Payable', type: 'liability' as const, detailType: 'Accounts payable' },
  { code: '2300', name: 'Sales Tax Payable', type: 'liability' as const, detailType: 'Sales tax payable' },
  { code: '3000', name: "Owner's Capital", type: 'equity' as const, detailType: "Owner's equity" },
  { code: '3100', name: 'Retained Earnings', type: 'equity' as const, detailType: 'Retained earnings' },
  { code: '4000', name: 'Product Sales', type: 'income' as const, detailType: 'Product sales' },
  { code: '4100', name: 'Service Revenue', type: 'income' as const, detailType: 'Service revenue' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense' as const, detailType: 'COGS' },
  { code: '6100', name: 'Software & Subscriptions', type: 'expense' as const, detailType: 'Dues & subscriptions' },
  { code: '6200', name: 'Professional Fees', type: 'expense' as const, detailType: 'Professional fees' },
  { code: '6300', name: 'Rent & Lease', type: 'expense' as const, detailType: 'Rent & lease' },
  { code: '6400', name: 'Marketing', type: 'expense' as const, detailType: 'Marketing' },
  { code: '6500', name: 'Travel', type: 'expense' as const, detailType: 'Travel' },
  { code: '6600', name: 'Utilities', type: 'expense' as const, detailType: 'Utilities' },
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const { name, email, password, companyName } = parsed.data;

    // Check if email already exists
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await hash(password, 12);

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Find free trial plan (outside transaction)
    const freePlan = await db.plan.findFirst({
      where: { name: 'Free Trial' },
    });
    if (!freePlan) throw new Error('No free trial plan found. Run seed first.');

    // Create everything in a transaction
    const result = await db.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: { name, email, passwordHash, emailVerificationToken: verificationToken },
      });

      // Create company
      const company = await tx.company.create({
        data: {
          name: companyName,
          fiscalYearStart: new Date(new Date().getFullYear().toString() + '-01-01'),
          currency: 'USD',
          locale: 'en-US',
          timezone: 'America/Edmonton',
        },
      });

      // Create membership (owner)
      await tx.membership.create({
        data: {
          userId: user.id,
          companyId: company.id,
          role: 'owner',
        },
      });

      // Create trial subscription (30 days)
      const now = new Date();
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + 30);
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      await tx.subscription.create({
        data: {
          companyId: company.id,
          planId: freePlan.id,
          status: 'trialing',
          trialEndsAt: trialEnd,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });

      // Create default Chart of Accounts
      for (const acct of DEFAULT_COA) {
        await tx.chartOfAccount.create({
          data: {
            companyId: company.id,
            code: acct.code,
            name: acct.name,
            type: acct.type,
            detailType: acct.detailType,
            parentCode: acct.parentCode || null,
            balance: 0,
          },
        });
      }

      return { user, company };
    });

    return NextResponse.json({
      data: {
        userId: result.user.id,
        companyId: result.company.id,
        companyName: result.company.name,
        verificationToken: process.env.NODE_ENV === 'development' ? verificationToken : undefined,
        message: 'Registration successful. You can now sign in.',
      },
    }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/auth/register error:', error);
    return NextResponse.json(
      { error: error.message || 'Registration failed' },
      { status: 500 }
    );
  }
}
