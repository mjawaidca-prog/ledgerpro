import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import crypto from 'crypto';
import { DEFAULT_CHART_OF_ACCOUNTS } from '@/lib/default-coa';
export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  companyName: z.string().min(2, 'Company name must be at least 2 characters'),
});

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
      for (const acct of DEFAULT_CHART_OF_ACCOUNTS) {
        await tx.chartOfAccount.create({
          data: {
            companyId: company.id,
            code: acct.code,
            name: acct.name,
            type: acct.type,
            detailType: acct.detailType,
            parentCode: acct.parentCode || null,
            description: acct.description || null,
            active: acct.active ?? true,
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
