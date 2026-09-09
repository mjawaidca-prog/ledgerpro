import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260909201645_p1f_payment_reversal_trace/migration.sql'),
  'utf8',
);

describe('P1-F payment reversal trace migration', () => {
  test('adds an optional tenant-scoped payment-account link', () => {
    expect(migration).toContain('ADD COLUMN "paymentAccountId" TEXT');
    expect(migration).toContain('FinancialAccount_companyId_id_key');
    expect(migration).toContain('JournalEntry_companyId_paymentAccountId_fkey');
    expect(migration).toContain('FOREIGN KEY ("companyId", "paymentAccountId")');
  });

  test('is additive and does not activate company tax', () => {
    expect(migration).not.toMatch(/UPDATE\s+"CompanyTaxConfiguration"[\s\S]*"enabled"/i);
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
