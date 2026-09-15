// BF-2: Plaid webhook verification. Every payload must carry a valid
// `Plaid-Verification` JWT signed with the item's webhook verification key —
// unverified payloads are rejected with 400 before anything touches the
// database beyond the token lookup needed to fetch the key.

import { importJWK, jwtVerify } from 'jose';
import { createHash, timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { decryptToken } from '@/lib/bank-feed/crypto';
import { getWebhookVerificationKey } from '@/lib/bank-feed/plaid-client';

function decodeJwtHeader(token: string): { kid?: string; alg?: string } | null {
  try {
    const [header] = token.split('.');
    return JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Verifies a Plaid webhook request. Returns the connection for the item on
 * success, or null when the signature is invalid. The caller rejects null
 * with 400 and never processes the payload.
 */
export async function verifyPlaidWebhook(opts: {
  verificationHeader: string | null;
  itemId: string;
  rawBody: string;
}): Promise<{ connectionId: string } | null> {
  if (!opts.verificationHeader || !opts.itemId) return null;

  const header = decodeJwtHeader(opts.verificationHeader);
  const kid = header?.kid;
  if (!kid || header?.alg !== 'ES256') return null;

  const connection = await db.bankConnection.findFirst({
    where: { itemId: opts.itemId },
    select: { id: true, accessTokenEncrypted: true },
  });
  if (!connection) return null;

  try {
    const key = await getWebhookVerificationKey(decryptToken(connection.accessTokenEncrypted), kid);
    const jwk = key as unknown as Parameters<typeof importJWK>[0];
    if ((key as any).expired_at != null) return null;
    const { payload } = await jwtVerify(opts.verificationHeader, await importJWK(jwk, 'ES256'), { algorithms: ['ES256'], maxTokenAge: '5 min', clockTolerance: 0 });
    if (typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now() / 1000)) return null;
    const expected = payload.request_body_sha256;
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return null;
    const actual = createHash('sha256').update(opts.rawBody, 'utf8').digest();
    if (!timingSafeEqual(actual, Buffer.from(expected, 'hex'))) return null;
    return { connectionId: connection.id };
  } catch {
    return null;
  }
}
