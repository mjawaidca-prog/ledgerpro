import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260913150000_bf3_overlap_flag/migration.sql'),
  'utf8',
);

describe('BF-3 overlap flag migration', () => {
  test('adds the overlap candidate flag, off by default', () => {
    expect(migration).toMatch(/ADD COLUMN\s+"overlapCandidate" BOOLEAN NOT NULL DEFAULT false/);
  });

  test('is purely additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
