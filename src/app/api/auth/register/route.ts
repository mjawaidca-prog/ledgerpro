import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import crypto from 'crypto';
import { createCompanyForUser } from '@/lib/create-company';
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

    // Create everything in a transaction
    const result = await db.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: { name, email, passwordHash, emailVerificationToken: verificationToken },
      });

      // Create company + owner membership + trial subscription + default COA
      // (shared with the "add another company" flow so both stay in sync)
      const company = await createCompanyForUser(tx, user.id, companyName);

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
