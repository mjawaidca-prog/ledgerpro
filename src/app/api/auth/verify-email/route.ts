import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/auth/verify-email — verify a user's email address using token
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token } = body;

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Verification token is required' },
        { status: 400 }
      );
    }

    // Find user with matching token
    const user = await db.user.findFirst({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid or expired verification token.' },
        { status: 400 }
      );
    }

    // Mark email as verified
    await db.user.update({
      where: { id: user.id },
      data: {
        emailVerified: new Date(),
        emailVerificationToken: null, // clear token after use
      },
    });

    return NextResponse.json({
      data: { verified: true, message: 'Email verified successfully. You can now sign in.' },
    });
  } catch (error) {
    console.error('POST /api/auth/verify-email error:', error);
    return NextResponse.json(
      { error: 'Email verification failed' },
      { status: 500 }
    );
  }
}
