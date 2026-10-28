/**
 * Receipt Capture v1 migration — additive-only, matching the repo's
 * migration-test pattern (bf3 et al). The migration is applied by hand via
 * the PR #49 procedure; this test pins its shape so review catches any
 * destructive or drifting edit.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20261027180000_receipt_capture_v1/migration.sql'),
  'utf8',
);
const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');

describe('Receipt capture v1 migration', () => {
  test('creates the ReceiptStatus enum and the Receipt table', () => {
    expect(migration).toMatch(/CREATE TYPE "ReceiptStatus" AS ENUM \('inbox', 'attached', 'discarded'\)/);
    expect(migration).toMatch(/CREATE TABLE "Receipt"/);
    expect(migration).toMatch(/"imageData" BYTEA/);
    expect(migration).toMatch(/"storageBackend" TEXT NOT NULL DEFAULT 'db'/);
    expect(migration).toMatch(/"ocrTotal" DECIMAL\(14,2\)/);
  });

  test('indexes company/status and transaction lookups', () => {
    expect(migration).toMatch(/CREATE INDEX "Receipt_companyId_status_idx" ON "Receipt"\("companyId", "status"\)/);
    expect(migration).toMatch(/CREATE INDEX "Receipt_transactionId_idx" ON "Receipt"\("transactionId"\)/);
  });

  test('foreign keys: company cascades, transaction and category SET NULL (evidence survives)', () => {
    expect(migration).toMatch(/"Receipt_companyId_fkey" FOREIGN KEY \("companyId"\) REFERENCES "Company"\("id"\) ON DELETE CASCADE/);
    expect(migration).toMatch(/"Receipt_transactionId_fkey" FOREIGN KEY \("transactionId"\) REFERENCES "Transaction"\("id"\) ON DELETE SET NULL/);
    expect(migration).toMatch(/"Receipt_suggestedCategoryId_fkey" FOREIGN KEY \("suggestedCategoryId"\) REFERENCES "ChartOfAccount"\("id"\) ON DELETE SET NULL/);
  });

  test('is purely additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE|TYPE)|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+"(?!Receipt))/i);
  });

  test('the Prisma schema carries the matching model and relations', () => {
    expect(schema).toMatch(/model Receipt \{/);
    expect(schema).toMatch(/enum ReceiptStatus \{/);
    expect(schema).toMatch(/receipts\s+Receipt\[\]/);
    expect(schema).toMatch(/suggestedReceipts\s+Receipt\[\]\s+@relation\("ReceiptSuggestedCategory"\)/);
  });
});
