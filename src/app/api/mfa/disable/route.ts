import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerSession } from '@/lib/auth';
import { auditLog } from '@/lib/api-helpers';
import { verifyTotp } from '@/lib/mfa/totp';
import { decryptTotpSecret } from '@/lib/mfa/secret-crypto';
import { consumeBackupCode } from '@/lib/mfa/backup-codes';
import { compare } from 'bcryptjs';
export const dynamic = 'force-dynamic';

// POST /api/mfa/disable — requires the account password AND a valid TOTP or
// backup code, so a stolen session cannot silently remove the second factor.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    const userId = (session?.user as any)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, mfaEnabled: true, mfaSecretEncrypted: true, mfaBackupCodes: true },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (!user.mfaEnabled || !user.mfaSecretEncrypted) {
      return NextResponse.json({ error: 'MFA is not enabled.' }, { status: 409 });
    }

    const body = await req.json().catch(() => null);
    const password = typeof body?.password === 'string' ? body.password : '';
    const code = typeof body?.code === 'string' ? body.code : '';
    if (!password || !code) {
      return NextResponse.json({ error: 'Password and code are required.' }, { status: 400 });
    }
    if (!user.passwordHash || !(await compare(password, user.passwordHash))) {
      return NextResponse.json({ error: 'Password is incorrect.' }, { status: 400 });
    }

    const secret = decryptTotpSecret(user.mfaSecretEncrypted);
    let authorized = verifyTotp(secret, code) !== null;
    let remainingHashes = user.mfaBackupCodes;
    if (!authorized) {
      const consumed = consumeBackupCode(user.mfaBackupCodes, code);
      authorized = consumed.valid;
      remainingHashes = consumed.remainingHashes;
    }
    if (!authorized) {
      return NextResponse.json({ error: 'That code is not valid.' }, { status: 400 });
    }

    await db.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaEnabledAt: null, mfaSecretEncrypted: null, mfaBackupCodes: [] },
    });

    await auditLog('', userId, 'mfa.disable', 'user', userId);

    return NextResponse.json({ data: { enabled: false } });
  } catch (error: any) {
    if (error?.message?.includes('decryption failed')) {
      return NextResponse.json({ error: 'MFA data is invalid. Contact support to reset.' }, { status: 400 });
    }
    console.error('POST /api/mfa/disable error:', error);
    return NextResponse.json({ error: 'Failed to disable MFA' }, { status: 500 });
  }
}
