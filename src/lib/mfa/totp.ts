// MFA-1: TOTP (RFC 6238) with the SHA-1 HMAC, 6-digit codes, 30-second
// steps, and a ±1-step tolerance window. Implemented directly on node:crypto
// so the behavior is fully owned and pinned by RFC 6238 test vectors in the
// unit suite. Secrets are base32 (RFC 4648, no padding).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1; // accept previous, current and next step

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of buf) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(acc >> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

export function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    acc = (acc << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

/** The 6-digit TOTP code at a Unix timestamp (seconds). */
export function totpAt(secret: string, timestampSeconds: number, digits = TOTP_DIGITS): string {
  const counter = Math.floor(timestampSeconds / TOTP_STEP_SECONDS);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a.padStart(TOTP_DIGITS, '0'));
  const bb = Buffer.from(b.padStart(TOTP_DIGITS, '0'));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Verifies a code against the secret within the tolerance window. Returns
 * the step delta when valid (0 = current, -1 = previous, 1 = next), null
 * otherwise.
 */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs = Date.now(),
  window = TOTP_WINDOW
): number | null {
  const now = Math.floor(nowMs / 1000);
  for (let delta = -window; delta <= window; delta++) {
    if (safeEqual(totpAt(secret, now + delta * TOTP_STEP_SECONDS), code.trim())) {
      return delta;
    }
  }
  return null;
}

/** otpauth:// URI for authenticator-app QR codes. */
export function otpauthUri(secret: string, accountEmail: string, issuer = 'LedgerPro'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
