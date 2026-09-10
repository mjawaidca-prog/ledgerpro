import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260910120000_api_a_keys/migration.sql'),
  'utf8',
);

describe('API-A keys migration', () => {
  test('adds the ApiKey and ApiRateCounter tables with the permission enum', () => {
    expect(migration).toContain(`CREATE TYPE "ApiKeyPermission" AS ENUM ('read', 'write_draft', 'write_posting')`);
    expect(migration).toContain('CREATE TABLE "ApiKey"');
    expect(migration).toContain('CREATE TABLE "ApiRateCounter"');
    expect(migration).toContain('"keyHash" TEXT NOT NULL');
    expect(migration).toContain('"permissions" "ApiKeyPermission"[]');
    expect(migration).toContain('"revokedAt" TIMESTAMP(3)');
  });

  test('adds the company-level switch, off by default', () => {
    expect(migration).toMatch(/ADD COLUMN\s+"apiAccessEnabled" BOOLEAN NOT NULL DEFAULT false/);
  });

  test('scopes keys to companies and users with correct foreign keys', () => {
    expect(migration).toContain('REFERENCES "Company"("id") ON DELETE CASCADE');
    expect(migration).toContain('REFERENCES "User"("id") ON DELETE SET NULL');
    expect(migration).toContain('CREATE UNIQUE INDEX "ApiKey_keyHash_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "ApiRateCounter_apiKeyId_scope_windowStart_key"');
  });

  test('is purely additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
    expect(migration).not.toMatch(/UPDATE\s+"Company"/i);
  });
});
