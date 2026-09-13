import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260913130000_bf2_feed_transactions/migration.sql'),
  'utf8',
);

describe('BF-2 feed transactions migration', () => {
  test('adds the provider link table and the sync cursor', () => {
    expect(migration).toContain('CREATE TABLE "BankFeedTransaction"');
    expect(migration).toContain('"providerTransactionId" TEXT NOT NULL');
    expect(migration).toContain('"removedByProviderAt" TIMESTAMP(3)');
    expect(migration).toMatch(/ADD COLUMN\s+"transactionsCursor" TEXT/);
  });

  test('links provider rows to review-queue transactions without deleting them', () => {
    expect(migration).toContain('REFERENCES "Transaction"("id") ON DELETE SET NULL');
    expect(migration).toContain('CREATE UNIQUE INDEX "BankFeedTransaction_providerAccountId_providerTransactionId_key"');
  });

  test('is purely additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
