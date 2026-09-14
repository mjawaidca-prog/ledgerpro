import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260914100000_mfa1_totp/migration.sql'),
  'utf8',
);

describe('MFA-1 migration', () => {
  test('adds the TOTP fields, off by default', () => {
    expect(migration).toMatch(/ADD COLUMN\s+"mfaSecretEncrypted" TEXT/);
    expect(migration).toMatch(/ADD COLUMN\s+"mfaEnabled" BOOLEAN NOT NULL DEFAULT false/);
    expect(migration).toMatch(/ADD COLUMN\s+"mfaEnabledAt" TIMESTAMP\(3\)/);
    expect(migration).toMatch(/ADD COLUMN\s+"mfaBackupCodes" TEXT\[\] DEFAULT ARRAY\[\]::TEXT\[\]/);
  });

  test('is purely additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
