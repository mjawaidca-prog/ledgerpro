import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('API reliability migration', () => {
  test('adds a nullable request fingerprint without destructive SQL', () => {
    const migration = readFileSync(
      resolve('prisma/migrations/20260916050000_api_idempotency_request_hash/migration.sql'),
      'utf8'
    );

    expect(migration).toMatch(/ALTER TABLE\s+"ApiIdempotencyRecord"\s+ADD COLUMN\s+"requestHash"\s+TEXT/);
    expect(migration).not.toMatch(/"requestHash"\s+TEXT\s+NOT NULL/i);
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
