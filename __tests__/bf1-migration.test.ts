import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260913100000_bf1_bank_connections/migration.sql'),
  'utf8',
);

describe('BF-1 bank feed migration', () => {
  test('adds the connection, account and sync-run tables', () => {
    expect(migration).toContain('CREATE TABLE "BankConnection"');
    expect(migration).toContain('CREATE TABLE "BankFeedAccount"');
    expect(migration).toContain('CREATE TABLE "BankSyncRun"');
    expect(migration).toContain('"accessTokenEncrypted" TEXT NOT NULL');
  });

  test('scopes connections to companies and accounts to connections', () => {
    expect(migration).toContain('REFERENCES "Company"("id") ON DELETE CASCADE');
    expect(migration).toContain('REFERENCES "BankConnection"("id") ON DELETE CASCADE');
    expect(migration).toContain('REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT');
    expect(migration).toContain('CREATE UNIQUE INDEX "BankConnection_itemId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "BankFeedAccount_connectionId_providerAccountId_key"');
  });

  test('is purely additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
