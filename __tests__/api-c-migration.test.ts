import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260911180000_api_c_idempotency/migration.sql'),
  'utf8',
);

describe('API-C idempotency migration', () => {
  test('adds the ApiIdempotencyRecord table with the replay key', () => {
    expect(migration).toContain('CREATE TABLE "ApiIdempotencyRecord"');
    expect(migration).toContain('"requestKey" TEXT NOT NULL');
    expect(migration).toContain('"response" JSONB NOT NULL');
    expect(migration).toContain('CREATE UNIQUE INDEX "ApiIdempotencyRecord_apiKeyId_requestKey_key"');
  });

  test('links records to keys and companies with correct foreign keys', () => {
    expect(migration).toContain('REFERENCES "ApiKey"("id") ON DELETE CASCADE');
    expect(migration).toContain('"companyId" TEXT NOT NULL');
  });

  test('is purely additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
