/**
 * Phase 3 item 1 migration — additive-only, matching the repo's
 * migration-test pattern. The migration is applied by hand via the
 * PR #49 procedure; this test pins its shape so review catches any
 * destructive or drifting edit.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20261121150000_recon_assistant/migration.sql'),
  'utf8'
);
const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');

describe('Reconciliation assistant (Phase 3 item 1) migration', () => {
  test('creates the ReconRejectedPairing table with its pairing key', () => {
    expect(migration).toMatch(/CREATE TABLE "ReconRejectedPairing"/);
    expect(migration).toMatch(/"transactionId" TEXT NOT NULL/);
    expect(migration).toMatch(/"targetType" TEXT NOT NULL/);
    expect(migration).toMatch(/"targetId" TEXT NOT NULL/);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "ReconRejectedPairing_transactionId_targetType_targetId_key"/
    );
    expect(migration).toMatch(
      /ALTER TABLE "ReconRejectedPairing" ADD CONSTRAINT "ReconRejectedPairing_transactionId_fkey"/
    );
  });

  test('is purely additive — no drops, no rewrites of existing columns', () => {
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|RENAME)\b/i);
    expect(migration).not.toMatch(/ALTER\s+COLUMN/i);
  });

  test('the Prisma schema carries the matching model', () => {
    expect(schema).toMatch(/model ReconRejectedPairing \{/);
    expect(schema).toMatch(/@@unique\(\[transactionId, targetType, targetId\]\)/);
  });
});
