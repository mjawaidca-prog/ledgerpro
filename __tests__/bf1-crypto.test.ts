import { createHash } from 'node:crypto';

process.env.BANK_FEED_KEK = Buffer.alloc(32, 7).toString('base64');

import { encryptToken, decryptToken, generateKek } from '@/lib/bank-feed/crypto';

describe('BF-1 token envelope encryption', () => {
  test('round-trips and never stores the plaintext', async () => {
    const token = 'access-sandbox-abc123';
    const stored = encryptToken(token);
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain(token);
    expect(decryptToken(stored)).toBe(token);
  });

  test('every encryption uses a fresh data key', () => {
    const a = encryptToken('same-token');
    const b = encryptToken('same-token');
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(decryptToken(b));
  });

  test('tampered ciphertexts are rejected', () => {
    const stored = encryptToken('token');
    const [wrapped, payload] = stored.slice(3).split('.');
    const tamperedPayload = Buffer.from(payload, 'base64');
    tamperedPayload[tamperedPayload.length - 1] ^= 0xff;
    const tampered = `v1.${wrapped}.${tamperedPayload.toString('base64')}`;
    expect(() => decryptToken(tampered)).toThrow(/decryption failed/i);
  });

  test('a wrong KEK cannot decrypt', () => {
    const stored = encryptToken('token');
    process.env.BANK_FEED_KEK = Buffer.alloc(32, 9).toString('base64');
    expect(() => decryptToken(stored)).toThrow(/decryption failed/i);
    process.env.BANK_FEED_KEK = Buffer.alloc(32, 7).toString('base64');
  });

  test('malformed strings are rejected', () => {
    expect(() => decryptToken('garbage')).toThrow(/Malformed/);
    expect(() => decryptToken('v1.onlyonepart')).toThrow(/Malformed/);
  });

  test('generates 32-byte base64 KEKs for setup', () => {
    const kek = generateKek();
    expect(Buffer.from(kek, 'base64')).toHaveLength(32);
    expect(createHash('sha256').update(kek).digest('hex')).toMatch(/^[0-9a-f]{64}$/);
  });
});
