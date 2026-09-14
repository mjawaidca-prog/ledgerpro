import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerSession } from '@/lib/auth';
import { auditLog } from '@/lib/api-helpers';
import { generateTotpSecret, otpauthUri } from '@/lib/mfa/totp';
import { encryptTotpSecret } from '@/lib/mfa/secret-crypto';
import QRCode from 'qrcode';
export const dynamic = 'force-dynamic';

// GET /api/mfa — current MFA status for the signed-in user (no secrets).
export async function GET() {
  const session = await getServerSession();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { mfaEnabled: true, mfaEnabledAt: true },
  });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  return NextResponse.json({ data: { enabled: user.mfaEnabled, enabledAt: user.mfaEnabledAt } });
}

// POST /api/mfa/setup — begin enabling MFA: generates a secret, stores it
// ENCRYPTED with mfaEnabled still false, and returns the otpauth URI plus
// the plaintext secret (shown exactly once). The enable completes only
// after /api/mfa/verify accepts a code.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    const userId = (session?.user as any)?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, mfaEnabled: true } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.mfaEnabled) {
      return NextResponse.json({ error: 'MFA is already enabled. Disable it first to set it up again.' }, { status: 409 });
    }

    const secret = generateTotpSecret();
    await db.user.update({
      where: { id: userId },
      data: { mfaSecretEncrypted: encryptTotpSecret(secret) },
    });

    await auditLog('', userId, 'mfa.setup', 'user', userId);

    const uri = otpauthUri(secret, user.email);
    // QR generated server-side — the secret never leaves this machine.
    const qrDataUrl = await QRCode.toDataURL(uri);

    return NextResponse.json({
      data: {
        secret, // shown once
        otpauthUri: uri,
        qrDataUrl,
      },
    });
  } catch (error) {
    console.error('POST /api/mfa/setup error:', error);
    return NextResponse.json({ error: 'Failed to start MFA setup' }, { status: 500 });
  }
}
