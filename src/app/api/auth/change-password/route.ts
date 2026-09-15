import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerSession } from '@/lib/auth';
import { auditLog } from '@/lib/api-helpers';
import { compare, hashSync } from 'bcryptjs';
export const dynamic = 'force-dynamic';

// POST /api/auth/change-password — signed-in users change their password
// after proving the current one.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    const userId = (session?.user as any)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const current = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    const next = typeof body?.newPassword === 'string' ? body.newPassword : '';
    if (!current || next.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true } });
    if (!user?.passwordHash || !(await compare(current, user.passwordHash))) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
    }

    await db.user.update({
      where: { id: userId },
      data: { passwordHash: hashSync(next, 10) },
    });
    await auditLog('', userId, 'auth.password_change', 'user', userId);

    return NextResponse.json({ data: { changed: true } });
  } catch (error) {
    console.error('POST /api/auth/change-password error:', error);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
