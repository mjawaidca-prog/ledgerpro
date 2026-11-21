/**
 * Phase 2 item 2 migration — additive-only, matching the repo's
 * migration-test pattern. The migration is applied by hand via the
 * PR #49 procedure; this test pins its shape so review catches any
 * destructive or drifting edit.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20261121110000_receipt_ocr/migration.sql'),
  'utf8',
);
const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');

describe('Receipt OCR (Phase 2 item 2) migration', () => {
  test('adds the extraction columns and the draft link to Receipt', () => {
    expect(migration).toMatch(/ALTER TABLE "Receipt" ADD COLUMN "extractionStatus" TEXT NOT NULL DEFAULT 'pending'/);
    expect(migration).toMatch(/ALTER TABLE "Receipt" ADD COLUMN "extractionProvider" TEXT/);
    expect(migration).toMatch(/ALTER TABLE "Receipt" ADD COLUMN "extractionFields" JSONB/);
    expect(migration).toMatch(/ALTER TABLE "Receipt" ADD COLUMN "extractionError" TEXT/);
    expect(migration).toMatch(/ALTER TABLE "Receipt" ADD COLUMN "draftBillId" TEXT/);
  });

  test('is purely additive — no drops, no rewrites of existing columns', () => {
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|RENAME)\b/i);
    expect(migration).not.toMatch(/ALTER\s+COLUMN/i);
  });

  test('the Prisma schema carries the matching fields on the Receipt model', () => {
    const receiptModel = schema.slice(schema.indexOf('model Receipt {'), schema.indexOf('model ReceiptUploadLink'));
    expect(receiptModel).toMatch(/extractionStatus\s+String\s+@default\("pending"\)/);
    expect(receiptModel).toMatch(/extractionProvider\s+String\?/);
    expect(receiptModel).toMatch(/extractionFields\s+Json\?/);
    expect(receiptModel).toMatch(/extractionError\s+String\?/);
    expect(receiptModel).toMatch(/draftBillId\s+String\?/);
  });
});
