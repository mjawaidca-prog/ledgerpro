import { SignJWT, exportJWK, generateKeyPair } from 'jose';

process.env.BANK_FEED_KEK = Buffer.alloc(32, 7).toString('base64');

const mockConnectionFindFirst = jest.fn();
jest.mock('@/lib/db', () => ({
  db: { bankConnection: { findFirst: (...a: unknown[]) => mockConnectionFindFirst(...a) } },
}));
jest.mock('@/lib/bank-feed/crypto', () => ({
  decryptToken: jest.fn().mockReturnValue('decrypted-token'),
}));

const mockGetKey = jest.fn();
jest.mock('@/lib/bank-feed/plaid-client', () => ({
  getWebhookVerificationKey: (...a: unknown[]) => mockGetKey(...a),
}));

import { verifyPlaidWebhook } from '@/lib/bank-feed/webhook';

describe('BF-2 webhook JWT verification', () => {
  test('verifies a valid ES384 JWT against the item key and rejects tampering', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES384');
    const jwk = await exportJWK(publicKey);
    mockGetKey.mockResolvedValue(jwk);
    mockConnectionFindFirst.mockResolvedValue({ id: 'conn-1', accessTokenEncrypted: 'v1.x' });

    const jwt = await new SignJWT({ webhook_type: 'TRANSACTIONS' })
      .setProtectedHeader({ alg: 'ES384', kid: 'key-1' })
      .sign(privateKey);

    const ok = await verifyPlaidWebhook({ verificationHeader: jwt, itemId: 'item-1' });
    expect(ok).toEqual({ connectionId: 'conn-1' });

    const tampered = jwt.slice(0, -4) + 'AAAA';
    const bad = await verifyPlaidWebhook({ verificationHeader: tampered, itemId: 'item-1' });
    expect(bad).toBeNull();
  });

  test('rejects missing headers and unknown items', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES384');
    const jwk = await exportJWK(publicKey);
    mockGetKey.mockResolvedValue(jwk);

    expect(await verifyPlaidWebhook({ verificationHeader: null, itemId: 'item-1' })).toBeNull();

    const jwt = await new SignJWT({}).setProtectedHeader({ alg: 'ES384', kid: 'key-1' }).sign(privateKey);
    mockConnectionFindFirst.mockResolvedValue(null);
    expect(await verifyPlaidWebhook({ verificationHeader: jwt, itemId: 'ghost-item' })).toBeNull();
  });
});
