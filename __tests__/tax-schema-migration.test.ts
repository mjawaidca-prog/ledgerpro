import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260907230000_p1b_tax_schema/migration.sql'),
  'utf8',
);

describe('P1-B additive tax migration', () => {
  test.each([
    'CompanyTaxConfiguration',
    'CompanyTaxRegistration',
    'TaxCode',
    'TaxCodeVersion',
    'TaxCodeComponent',
    'DocumentLineTaxSnapshot',
    'DocumentLineTaxComponent',
  ])('creates and protects %s', table => {
    expect(migration).toContain(`CREATE TABLE "${table}"`);
    expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
  });

  test('keeps company tax activation disabled by default', () => {
    expect(migration).toContain('"enabled" BOOLEAN NOT NULL DEFAULT false');
    expect(migration).toContain('CompanyTaxConfiguration_enabled_reviewed_check');
  });

  test('enforces source, balance, recovery, FX, and tenant invariants', () => {
    expect(migration).toContain('DocumentLineTaxSnapshot_one_source_line_check');
    expect(migration).toContain('DocumentLineTaxSnapshot_amounts_balance_check');
    expect(migration).toContain('DocumentLineTaxSnapshot_home_amounts_balance_check');
    expect(migration).toContain('DocumentLineTaxSnapshot_fx_check');
    expect(migration).toContain('DocumentLineTaxComponent_provincial_recovery_check');
    expect(migration).toContain('CompanyTaxConfiguration_companyId_gstHstOutputAccountId_fkey');
  });

  test('does not contain destructive data or schema operations', () => {
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
