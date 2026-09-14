import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerSession } from '@/lib/auth';
import { auditLog } from '@/lib/api-helpers';
import { verifyTotp } from '@/lib/mfa/totp';
import { decryptTotpSecret } from '@/lib/mfa/secret-crypto';
import { generateBackupCodes, BACKUP_CODE_COUNT } from '@/lib/mfa/backup-codes';
import { createHash } from 'node:crypto';
export const dynamic = 'force-dynamic';

// POST /api/mfa/verify — completes MFA enablement: accepts one valid TOTP
// code, flips mfaEnabled, and returns backup codes EXACTLY ONCE (stored as
// hashes). The pending encrypted secret is consumed on success.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    const userId = (session?.user as any)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, mfaSecretEncrypted: true, mfaEnabled: true },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.mfaEnabled) return NextResponse.json({ error: 'MFA is already enabled.' }, { status: 409 });
    if (!user.mfaSecretEncrypted) {
      return NextResponse.json({ error: 'Start setup first (/api/mfa/setup).' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const code = typeof body?.code === 'string' ? body.code : '';
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: 'Enter the 6-digit code from your authenticator app.' }, { status: 400 });
    }

    const secret = decryptTotpSecret(user.mfaSecretEncrypted);
    const valid = verifyTotp(secret, code);
    if (valid === null) {
      return NextResponse.json({ error: 'That code is not valid. Check your device clock and try again.' }, { status: 400 });
    }

    const codes = generateBackupCodes();
    const hashes = codes.map((c) => createHash('sha256').update(c.trim().toLowerCase()).digest('hex'));
    await db.user.update({
      where: { id: userId },
      data: { mfaEnabled: true, mfaEnabledAt: new Date(), mfaBackupCodes: hashes },
    });

    await auditLog('', userId, 'mfa.enable', 'user', userId);

    return NextResponse.json({ data: { enabled: true, backupCodes: codes } });
  } catch (error: any) {
    if (error?.message?.includes('decryption failed')) {
      return NextResponse.json({ error: 'MFA setup data is invalid. Start setup again.' }, { status: 400 });
    }
    console.error('POST /api/mfa/verify error:', error);
    return NextResponse.json({ error: 'Failed to verify MFA code' }, { status: 500 });
  }
}
