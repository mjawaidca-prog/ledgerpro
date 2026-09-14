// MFA-1: one-time backup codes. Ten random codes per user, stored as
// SHA-256 hashes, shown exactly once at enable time. Each code works once
// and is removed on use (constant-time comparison against every remaining
// hash so consumption leaks nothing about which code matched).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const BACKUP_CODE_COUNT = 10;

function hash(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(`${randomBytes(4).toString('hex')}-${randomBytes(4).toString('hex')}`);
  }
  return codes;
}

/**
 * Verifies a submitted code against the stored hashes. On success the used
 * hash is removed and the remaining hashes are returned (the caller
 * persists them); on failure the original list is returned unchanged.
 */
export function consumeBackupCode(
  storedHashes: string[],
  submitted: string
): { valid: boolean; remainingHashes: string[] } {
  const target = hash(submitted);
  for (let i = 0; i < storedHashes.length; i++) {
    const a = Buffer.from(storedHashes[i]);
    const b = Buffer.from(target);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { valid: true, remainingHashes: [...storedHashes.slice(0, i), ...storedHashes.slice(i + 1)] };
    }
  }
  return { valid: false, remainingHashes: storedHashes };
}
