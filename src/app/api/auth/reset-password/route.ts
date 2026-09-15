import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createHash, timingSafeEqual } from 'node:crypto';
import { hashSync } from 'bcryptjs';
export const dynamic = 'force-dynamic';

// POST /api/auth/reset-password — consumes a reset token and sets a new
// password. The token is single-use (cleared on success), expires after 30
// minutes, and is compared in constant time.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!token || password.length < 8) {
    return NextResponse.json(
      { error: 'Enter a new password of at least 8 characters.' },
      { status: 400 }
    );
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const candidates = await db.user.findMany({
    where: { passwordResetTokenHash: { not: null } },
    select: { id: true, email: true, passwordResetTokenHash: true, passwordResetExpiresAt: true },
  });

  const user = candidates.find((u) => {
    if (!u.passwordResetTokenHash || !u.passwordResetExpiresAt) return false;
    if (u.passwordResetExpiresAt.getTime() < Date.now()) return false;
    const a = Buffer.from(u.passwordResetTokenHash);
    const b = Buffer.from(tokenHash);
    return a.length === b.length && timingSafeEqual(a, b);
  });

  if (!user) {
    return NextResponse.json(
      { error: 'This reset link is invalid or has expired. Request a new one.' },
      { status: 400 }
    );
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashSync(password, 10),
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    },
  });

  return NextResponse.json({ data: { reset: true } });
}
