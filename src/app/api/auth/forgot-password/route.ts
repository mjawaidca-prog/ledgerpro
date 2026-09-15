import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { randomBytes, createHash } from 'node:crypto';
import { sendPasswordReset } from '@/lib/email';
export const dynamic = 'force-dynamic';

// POST /api/auth/forgot-password — mints a single-use, 30-minute reset token
// (stored as a SHA-256 hash) and emails the link. The response is identical
// for known and unknown emails so account enumeration is not possible.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (email) {
    try {
      const user = await db.user.findUnique({ where: { email } });
      if (user) {
        const token = randomBytes(32).toString('hex');
        await db.user.update({
          where: { id: user.id },
          data: {
            passwordResetTokenHash: createHash('sha256').update(token).digest('hex'),
            passwordResetExpiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
        const base = process.env.NEXTAUTH_URL ?? 'https://ledger.nexvarlab.com';
        await sendPasswordReset(user.email, `${base}/reset-password?token=${token}`);
      }
    } catch (error) {
      console.error('POST /api/auth/forgot-password error:', error);
    }
  }

  // Identical response either way.
  return NextResponse.json({ data: { sent: true } });
}
