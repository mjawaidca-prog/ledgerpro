// MFA-1: TOTP correctness pinned to RFC 6238 test vectors (SHA-1, 8-digit
// variants are exercised by the vectors; the app uses 6 digits and the
// vectors verify the underlying HOTP math).

import {
  base32Decode,
  generateTotpSecret,
  otpauthUri,
  totpAt,
  verifyTotp,
} from '@/lib/mfa/totp';
import { consumeBackupCode, generateBackupCodes } from '@/lib/mfa/backup-codes';

process.env.MFA_SECRET = Buffer.alloc(32, 7).toString('base64');
const { encryptTotpSecret, decryptTotpSecret } = require('@/lib/mfa/secret-crypto');

describe('MFA-1 TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B: seed "12345678901234567890" base32 =
  // "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  const RFC_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const RFC_T8 = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ] as const;

  test('matches the RFC 6238 8-digit vectors', () => {
    for (const [t, expected] of RFC_T8) {
      expect(totpAt(RFC_SEED, t, 8)).toBe(expected);
    }
  });

  test('generates valid base32 secrets and decodes them', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const decoded = base32Decode(secret);
    expect(decoded).toHaveLength(20);
  });

  test('verifies within the tolerance window and rejects outside it', () => {
    const secret = generateTotpSecret();
    const nowMs = 1_726_000_000_000;
    const current = totpAt(secret, nowMs / 1000);
    expect(verifyTotp(secret, current, nowMs)).toBe(0);
    expect(verifyTotp(secret, totpAt(secret, nowMs / 1000 + 30), nowMs)).toBe(1);
    expect(verifyTotp(secret, totpAt(secret, nowMs / 1000 - 30), nowMs)).toBe(-1);
    expect(verifyTotp(secret, '000000', nowMs)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, nowMs / 1000 + 90), nowMs)).toBeNull();
  });

  test('otpauth URIs carry the standard parameters', () => {
    const uri = otpauthUri('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 'rosa@example.com');
    expect(uri).toContain('otpauth://totp/LedgerPro:rosa%40example.com');
    expect(uri).toContain('secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('MFA-1 secret encryption', () => {
  test('round-trips and never stores plaintext', () => {
    const secret = generateTotpSecret();
    const stored = encryptTotpSecret(secret);
    expect(stored.startsWith('mfa1.')).toBe(true);
    expect(stored).not.toContain(secret);
    expect(decryptTotpSecret(stored)).toBe(secret);
  });

  test('rejects tampering and wrong keys', () => {
    const stored = encryptTotpSecret('SECRET');
    const parts = stored.slice(5).split('.');
    const payload = Buffer.from(parts[2], 'base64');
    payload[payload.length - 1] ^= 0xff;
    const tampered = `mfa1.${parts[0]}.${parts[1]}.${payload.toString('base64')}`;
    expect(() => decryptTotpSecret(tampered)).toThrow(/decryption failed/i);

    const originalKey = process.env.MFA_SECRET;
    process.env.MFA_SECRET = Buffer.alloc(32, 9).toString('base64');
    expect(() => decryptTotpSecret(stored)).toThrow(/decryption failed/i);
    process.env.MFA_SECRET = originalKey;
  });
});

describe('MFA-1 backup codes', () => {
  test('generates the configured count of unique codes', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
  });

  test('each code works exactly once and is removed on use', () => {
    const codes = generateBackupCodes(3);
    const hashes = codes.map((c) => require('node:crypto').createHash('sha256').update(c.trim().toLowerCase()).digest('hex'));

    const first = consumeBackupCode(hashes, codes[0]);
    expect(first.valid).toBe(true);
    expect(first.remainingHashes).toHaveLength(2);

    const replay = consumeBackupCode(first.remainingHashes, codes[0]);
    expect(replay.valid).toBe(false);
    expect(replay.remainingHashes).toHaveLength(2);

    const second = consumeBackupCode(first.remainingHashes, ` ${codes[1]} `.toUpperCase());
    expect(second.valid).toBe(true);
    expect(second.remainingHashes).toHaveLength(1);
  });
});
