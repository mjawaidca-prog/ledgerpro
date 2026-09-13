// Envelope encryption for provider access tokens (BF-1).
//
// Each token is encrypted with a fresh random data key (AES-256-GCM); the
// data key is itself wrapped with a key-encryption key held in the
// deployment environment (BANK_FEED_KEK). Ciphertexts are stored with the
// `v1.` prefix and carry the wrapped key, IV and auth tag — rotating the KEK
// later only requires re-wrapping data keys, not re-encrypting tokens.
//
// The token must never appear in a response body, a log line, or an error
// report; every route returns only a boolean "has token" or nothing.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'v1.';

function kek(): Buffer {
  const raw = process.env.BANK_FEED_KEK;
  if (!raw) {
    throw new Error('BANK_FEED_KEK is not configured in this environment.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('BANK_FEED_KEK must be a base64-encoded 32-byte key.');
  }
  return key;
}

function gcmEncrypt(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv (12) || tag (16) || ciphertext
  return Buffer.concat([iv, tag, ciphertext]);
}

function gcmDecrypt(key: Buffer, payload: Buffer): Buffer {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Encrypts a provider access token for storage. */
export function encryptToken(token: string): string {
  const dataKey = randomBytes(32);
  const wrappedKey = gcmEncrypt(kek(), dataKey);
  const payload = gcmEncrypt(dataKey, Buffer.from(token, 'utf8'));
  return `${PREFIX}${wrappedKey.toString('base64')}.${payload.toString('base64')}`;
}

/** Decrypts a stored token. Throws on tampering, truncation, or a wrong KEK. */
export function decryptToken(stored: string): string {
  const parts = stored.startsWith(PREFIX) ? stored.slice(PREFIX.length).split('.') : [];
  if (parts.length !== 2) {
    throw new Error('Malformed encrypted token.');
  }
  try {
    const wrappedKey = Buffer.from(parts[0], 'base64');
    const payload = Buffer.from(parts[1], 'base64');
    const dataKey = gcmDecrypt(kek(), wrappedKey);
    return gcmDecrypt(dataKey, payload).toString('utf8');
  } catch {
    throw new Error('Token decryption failed — wrong key or tampered ciphertext.');
  }
}

/** Generates a fresh base64 KEK, for .env setup and documentation only. */
export function generateKek(): string {
  return randomBytes(32).toString('base64');
}
