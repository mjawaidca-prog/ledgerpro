// MFA-1: TOTP secrets are encrypted at rest with a deployment key
// (MFA_SECRET, base64 32-byte). Same AES-256-GCM discipline as the bank-feed
// token envelope, but single-key because TOTP secrets rotate with the user.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'mfa1.';

function key(): Buffer {
  const raw = process.env.MFA_SECRET;
  if (!raw) throw new Error('MFA_SECRET is not configured in this environment.');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('MFA_SECRET must be a base64-encoded 32-byte key.');
  return k;
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptTotpSecret(stored: string): string {
  const parts = stored.startsWith(PREFIX) ? stored.slice(PREFIX.length).split('.') : [];
  if (parts.length !== 3) throw new Error('Malformed encrypted TOTP secret.');
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('TOTP secret decryption failed — wrong key or tampered ciphertext.');
  }
}

export function generateMfaSecretKey(): string {
  return randomBytes(32).toString('base64');
}
