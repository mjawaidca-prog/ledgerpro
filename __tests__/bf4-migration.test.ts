import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260913170000_bf4_sync_settings/migration.sql'),
  'utf8',
);

describe('BF-4 sync settings migration', () => {
  test('adds cadence, autoCategorize and notifyOnFailure with safe defaults', () => {
    expect(migration).toMatch(/ADD COLUMN\s+"cadence" TEXT NOT NULL DEFAULT 'daily'/);
    expect(migration).toMatch(/ADD COLUMN\s+"autoCategorize" BOOLEAN NOT NULL DEFAULT true/);
    expect(migration).toMatch(/ADD COLUMN\s+"notifyOnFailure" BOOLEAN NOT NULL DEFAULT true/);
  });

  test('is purely additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
