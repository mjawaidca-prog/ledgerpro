import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260908230000_p1c_tax_posting/migration.sql'),
  'utf8',
);
const recoveryMigration = readFileSync(
  resolve('prisma/migrations/20260908233000_p1c_tax_recovery_review/migration.sql'),
  'utf8',
);

describe('P1-C additive tax-posting migration', () => {
  test('adds an idempotent journal/snapshot audit link without enabling tax', () => {
    expect(migration).toContain('CREATE TABLE "TaxPosting"');
    expect(migration).toContain('TaxPosting_companyId_sourceKey_key');
    expect(migration).toContain('TaxPosting_journalEntryId_key');
    expect(migration).toContain('"requestHash" TEXT NOT NULL');
    expect(migration).not.toMatch(/UPDATE\s+"CompanyTaxConfiguration"[\s\S]*"enabled"/i);
  });

  test('stores exact home-currency component splits and reversal links', () => {
    expect(migration).toContain('"taxHome" DECIMAL(14,2) NOT NULL DEFAULT 0');
    expect(migration).toContain('DocumentLineTaxComponent_home_amounts_balance_check');
    expect(migration).toContain('DocumentLineTaxSnapshot_reversalOfId_key');
    expect(migration).toContain('DocumentLineTaxSnapshot_source_or_reversal_check');
  });

  test('preserves independent component treatment and protects server-only data', () => {
    expect(migration).toContain('ADD COLUMN "treatment" "TaxTreatment"');
    expect(migration).toContain('TaxCodeComponent_treatment_rate_check');
    expect(migration).toContain('ALTER TABLE "TaxPosting" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE "TaxPosting"');
  });

  test('contains no destructive table, column, data, schema, or database operation', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
    expect(recoveryMigration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
