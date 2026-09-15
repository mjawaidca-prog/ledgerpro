import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260915120000_auth_password_reset/migration.sql'),
  'utf8',
);

describe('password reset migration', () => {
  test('adds the hashed token and expiry fields', () => {
    expect(migration).toMatch(/ADD COLUMN\s+"passwordResetTokenHash" TEXT/);
    expect(migration).toMatch(/ADD COLUMN\s+"passwordResetExpiresAt" TIMESTAMP\(3\)/);
  });

  test('is purely additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
