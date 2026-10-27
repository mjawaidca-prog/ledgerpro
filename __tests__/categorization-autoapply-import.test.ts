/**
 * Categorization rules auto-apply on import.
 *
 * When a statement import commits with rules enabled, the company's
 * active Settings → Categorization rules run over the newly imported
 * rows (shared engine with the manual Apply endpoint), so rows arrive
 * categorized — tax splits stamped — without a manual Apply. Banking
 * rules keep first claim on a row; the dry-run previews the same counts
 * the commit produces; a tax stamp that would land in a filed GST/HST
 * period is skipped, never thrown; the flag off (or no rules) changes
 * nothing anywhere.
 */
class DecimalStub {
  v: number;
  constructor(value: unknown) { this.v = value instanceof DecimalStub ? value.v : Number(value as never); }
  toNumber() { return this.v; }
  valueOf() { return this.v; }
  toString() { return String(this.v); }
}

interface StoreTx {
  id: string;
  companyId: string;
  financialAccountId?: string;
  statementImportId?: string | null;
  date: Date;
  description: string;
  merchant: string | null;
  rawStatementText: string | null;
  amount: number;
  categoryId: string | null;
  status: string;
  splits?: unknown;
  appliedRuleId?: string | null;
}

const store: StoreTx[] = [];
let txCounter = 0;
let bankRules: any[] = [];
let catRules: any[] = [];
let filedPeriods: any[] = [];

const mockDb: Record<string, any> = {
  $transaction: jest.fn(async (cb: any) => cb(mockDb)),
  financialAccount: {
    findUniqueOrThrow: jest.fn(async () => ({ id: 'acct-1', companyId: 'co-1', currency: 'CAD', lockedThrough: null })),
    update: jest.fn(async () => ({})),
  },
  statementImport: {
    create: jest.fn(async () => ({ id: 'imp-1' })),
    update: jest.fn(async () => ({})),
  },
  transaction: {
    findMany: jest.fn(async ({ where }: any) => {
      if (where?.statementImportId) {
        return store.filter((t) =>
          t.statementImportId === where.statementImportId &&
          (where.status === undefined || t.status === where.status) &&
          (where.categoryId === undefined || t.categoryId === where.categoryId));
      }
      if (where?.financialAccountId) return []; // no pre-existing rows on the account
      if (where?.companyId && where?.status) {
        return store.filter((t) => t.companyId === where.companyId && t.status === where.status && t.categoryId === null);
      }
      return [];
    }),
    count: jest.fn(async ({ where }: any) =>
      store.filter((t) => t.companyId === where.companyId && t.status === where.status && t.categoryId === null).length),
    createMany: jest.fn(async ({ data }: any) => {
      for (const row of data) store.push({ merchant: null, ...row, id: `tx-${++txCounter}` });
      return { count: data.length };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((t) => t.id === where.id);
      if (row) Object.assign(row, data);
      return row ?? {};
    }),
  },
  bankRule: {
    findMany: jest.fn(async () => bankRules),
    update: jest.fn(async () => ({})),
  },
  categorizationRule: {
    findMany: jest.fn(async () => catRules),
    update: jest.fn(async () => ({})),
  },
  chartOfAccount: {
    findFirst: jest.fn(async ({ where }: any) => (where.code ? { id: `coa-${where.code}` } : null)),
  },
  taxReturnWorkpaper: { findMany: jest.fn(async () => filedPeriods) },
  companyTaxConfiguration: { findUnique: jest.fn(async () => null) },
};
jest.mock('@/lib/db', () => ({ db: mockDb }));
jest.mock('@prisma/client', () => ({ Prisma: { Decimal: DecimalStub } }));
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: jest.fn(async () => ({ companyId: 'co-1', userId: 'u-1', error: null })),
  auditLog: jest.fn(async () => undefined),
}));

import { commitImport, dryRunImport, type NormalizedRow } from '@/lib/banking/import-service';
import { POST as applyPOST } from '@/app/api/categorization-rules/apply/route';
import { NextRequest } from 'next/server';

const row = (rowIndex: number, date: string, description: string, amount: number): NormalizedRow => ({
  rowIndex, date, description, memo: null, reference: null, amount,
  statementBalance: null, payeeGuess: null, dedupeHash: `h-${rowIndex}-${description}`,
});

const commitInput = (normalized: NormalizedRow[], applyRulesOnImport = true) => ({
  companyId: 'co-1',
  userId: 'u-1',
  accountId: 'acct-1',
  fileName: 'td.csv',
  fileSize: 100,
  fileType: 'csv' as const,
  presetId: null,
  mappingJson: {},
  normalized,
  skipDuplicates: true,
  applyRulesOnImport,
  autoPostExactMatches: false,
  skipRowIndexes: [],
});

const catRule = (over: Record<string, unknown>) => ({
  id: 'cr-1',
  name: 'Rule',
  pattern: '',
  patternType: 'description_contains',
  minAmount: null,
  maxAmount: null,
  categoryId: 'coa-4000',
  category: { code: '4000' },
  taxEnabled: false,
  taxProvince: null,
  taxInclusive: true,
  taxRecoverable: true,
  taxRecoveryPercent: null,
  priority: 0,
  active: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  store.length = 0;
  txCounter = 0;
  bankRules = [];
  catRules = [];
  filedPeriods = [];
  mockDb.$transaction.mockImplementation(async (cb: any) => cb(mockDb));
});

describe('commit: categorization rules auto-apply to the new rows', () => {
  it('categorizes a matching row and stamps its tax split (incl. recovery %) — no manual apply', async () => {
    catRules = [catRule({
      name: 'TEKsystems revenue',
      pattern: 'teksystems',
      taxEnabled: true, taxProvince: 'AB', taxInclusive: true, taxRecoverable: true, taxRecoveryPercent: 50,
    })];
    const result = await commitImport(commitInput([
      row(0, '2026-10-05', 'TEKsystems', 2520),
      row(1, '2026-10-06', 'MYSTERY SHOP', -20),
    ]));
    expect(result.newCount).toBe(2);
    expect(result.categorization.matched).toBe(1);
    expect(result.categorization.ruleNames).toEqual(['TEKsystems revenue']);
    expect(result.categorization.skippedLocked).toBe(0);

    const hit = store.find((t) => t.description === 'TEKsystems')!;
    expect(hit.status).toBe('categorized');
    expect(hit.categoryId).toBe('coa-4000');
    expect(hit.splits).toEqual([
      expect.objectContaining({ categoryCode: '4000', amount: 2520, taxProvince: 'AB', taxRecoveryPercent: 50 }),
    ]);
    const miss = store.find((t) => t.description === 'MYSTERY SHOP')!;
    expect(miss.status).toBe('toreview');
    expect(miss.categoryId).toBeNull();
    // The winning rule's bookkeeping was bumped, as the manual apply does.
    expect(mockDb.categorizationRule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cr-1' }, data: expect.objectContaining({ matchCount: { increment: 1 } }) }),
    );
  });

  it('never sweeps pre-existing unreviewed rows — only this import’s', async () => {
    store.push({
      id: 'tx-old', companyId: 'co-1', statementImportId: 'imp-older', date: new Date('2026-09-01'),
      description: 'TEKsystems', merchant: null, rawStatementText: 'TEKsystems', amount: 900,
      categoryId: null, status: 'toreview',
    });
    catRules = [catRule({ pattern: 'teksystems' })];
    const result = await commitImport(commitInput([row(0, '2026-10-05', 'TEKsystems', 100)]));
    expect(result.categorization.matched).toBe(1);
    const old = store.find((t) => t.id === 'tx-old')!;
    expect(old.status).toBe('toreview');
    expect(old.categoryId).toBeNull();
  });

  it('a Banking-rule categorization is not overridden by the categorization pass', async () => {
    bankRules = [{
      id: 'br-1', name: 'Bank TEK', order: 1, op: 'contains', value: 'TEKsystems', anyOf: [],
      scope: { accountIds: 'all', direction: 'both' }, setCategoryCode: '4000', setTaxCode: null,
      setTaxRate: null, setTaxInclusive: false, setContactId: null, autoPost: false, enabled: true,
    }];
    catRules = [catRule({ name: 'Cat TEK', pattern: 'teksystems', categoryId: 'coa-6100', category: { code: '6100' } })];
    const result = await commitImport(commitInput([row(0, '2026-10-05', 'TEKsystems', 2520)]));
    expect(result.rulesApplied).toBe(1);
    expect(result.categorization.matched).toBe(0);
    const hit = store[0];
    expect(hit.categoryId).toBe('coa-4000');
    expect(hit.appliedRuleId).toBe('br-1');
  });

  it('flag off: nothing auto-applies anywhere', async () => {
    catRules = [catRule({ pattern: 'teksystems' })];
    const result = await commitImport(commitInput([row(0, '2026-10-05', 'TEKsystems', 2520)], false));
    expect(result.categorization).toEqual({ matched: 0, activeRuleCount: 0, ruleNames: [], skippedLocked: 0 });
    expect(store[0].status).toBe('toreview');
    expect(mockDb.categorizationRule.update).not.toHaveBeenCalled();
  });

  it('no active categorization rules: a clean no-op', async () => {
    const result = await commitImport(commitInput([row(0, '2026-10-05', 'TEKsystems', 2520)]));
    expect(result.newCount).toBe(1);
    expect(result.categorization.matched).toBe(0);
    expect(result.categorization.activeRuleCount).toBe(0);
    expect(store[0].status).toBe('toreview');
  });
});

describe('Muja-shaped regression — TD rows categorize on import', () => {
  it('TEKsystems deposit → revenue; FORD CREDIT payment → vehicle, via Description-1 rules', async () => {
    catRules = [
      catRule({ id: 'cr-tek', name: 'TEKsystems → Contract Revenue', pattern: 'TEKsystems', categoryId: 'coa-4000', category: { code: '4000' } }),
      catRule({ id: 'cr-ford', name: 'Ford Credit → Motor Vehicle', pattern: 'FORD CREDIT', categoryId: 'coa-5600', category: { code: '5600' } }),
    ];
    const result = await commitImport(commitInput([
      row(0, '2025-10-23', 'TEKsystems', 2520.0),
      row(1, '2025-11-02', 'FORD CREDIT', -499.79),
      row(2, '2025-11-03', 'Intercast', 6762.0),
    ]));
    expect(result.categorization.matched).toBe(2);
    expect(result.categorization.ruleNames).toEqual(expect.arrayContaining(['TEKsystems → Contract Revenue', 'Ford Credit → Motor Vehicle']));
    expect(store.find((t) => t.description === 'TEKsystems')!.categoryId).toBe('coa-4000');
    expect(store.find((t) => t.description === 'FORD CREDIT')!.categoryId).toBe('coa-5600');
    expect(store.find((t) => t.description === 'Intercast')!.status).toBe('toreview');
  });
});

describe('filed-period lock interaction', () => {
  const FILED = {
    id: 'wp-filed-1',
    periodStart: new Date('2025-10-02T00:00:00Z'),
    periodEnd: new Date('2026-10-01T00:00:00Z'),
    filedAt: new Date('2026-10-20T00:00:00Z'),
    filingConfirmation: 'NETFILE-123',
  };

  it('a tax-stamped match dated inside a filed period is skipped and counted — the import still succeeds', async () => {
    filedPeriods = [FILED];
    catRules = [
      catRule({ id: 'cr-tax', name: 'Taxed supplies', pattern: 'ACME', taxEnabled: true, taxProvince: 'AB' }),
      catRule({ id: 'cr-plain', name: 'Plain fees', pattern: 'BANK FEE', categoryId: 'coa-5900', category: { code: '5900' } }),
    ];
    const result = await commitImport(commitInput([
      row(0, '2026-03-15', 'ACME SUPPLIES', -105), // inside the filed period, tax-stamped → skipped
      row(1, '2026-03-16', 'BANK FEE', -12),       // inside the filed period, no tax stamp → categorized
      row(2, '2026-11-15', 'ACME SUPPLIES', -105), // after the filed period → categorized + stamped
    ]));
    expect(result.newCount).toBe(3);
    expect(result.categorization.skippedLocked).toBe(1);
    expect(result.categorization.matched).toBe(2);
    const skipped = store.find((t) => t.description === 'ACME SUPPLIES' && t.date.toISOString().startsWith('2026-03'))!;
    expect(skipped.status).toBe('toreview');
    expect(skipped.categoryId).toBeNull();
    const after = store.find((t) => t.description === 'ACME SUPPLIES' && t.date.toISOString().startsWith('2026-11'))!;
    expect(after.status).toBe('categorized');
    expect(after.splits).toBeDefined();
  });
});

describe('dry-run preview parity', () => {
  it('previews the categorization hits the commit will produce', async () => {
    catRules = [catRule({ name: 'TEKsystems revenue', pattern: 'teksystems', taxEnabled: true, taxProvince: 'AB' })];
    const rows = [row(0, '2026-10-05', 'TEKsystems', 2520), row(1, '2026-10-06', 'MYSTERY SHOP', -20)];
    const dry = await dryRunImport({
      companyId: 'co-1', accountId: 'acct-1', normalized: rows, skipDuplicates: true, applyRulesOnImport: true,
    });
    expect(dry.ruleHits.categorized).toBe(0);
    expect(dry.categorizationHits.matched).toBe(1);
    expect(dry.categorizationHits.activeRuleCount).toBe(1);
    expect(dry.categorizationHits.ruleNames).toEqual(['TEKsystems revenue']);

    const committed = await commitImport(commitInput(rows));
    expect(committed.categorization.matched).toBe(dry.categorizationHits.matched);
  });

  it('a row the Banking rules categorize is excluded from the categorization preview', async () => {
    bankRules = [{
      id: 'br-1', name: 'Bank TEK', order: 1, op: 'contains', value: 'TEKsystems', anyOf: [],
      scope: { accountIds: 'all', direction: 'both' }, setCategoryCode: '4000', setTaxCode: null,
      setTaxRate: null, setTaxInclusive: false, setContactId: null, autoPost: false, enabled: true,
    }];
    catRules = [catRule({ pattern: 'teksystems' })];
    const dry = await dryRunImport({
      companyId: 'co-1', accountId: 'acct-1', normalized: [row(0, '2026-10-05', 'TEKsystems', 2520)],
      skipDuplicates: true, applyRulesOnImport: true,
    });
    expect(dry.ruleHits.categorized).toBe(1);
    expect(dry.categorizationHits.matched).toBe(0);
  });

  it('flag off: the preview promises nothing', async () => {
    catRules = [catRule({ pattern: 'teksystems' })];
    const dry = await dryRunImport({
      companyId: 'co-1', accountId: 'acct-1', normalized: [row(0, '2026-10-05', 'TEKsystems', 2520)],
      skipDuplicates: true, applyRulesOnImport: false,
    });
    expect(dry.categorizationHits).toEqual({ matched: 0, activeRuleCount: 0, ruleNames: [] });
  });
});

describe('manual Apply endpoint (shared engine, unchanged behaviour)', () => {
  it('still categorizes unreviewed transactions and reports the same message', async () => {
    store.push({
      id: 'tx-m1', companyId: 'co-1', date: new Date('2026-10-05'), description: 'TEKsystems',
      merchant: null, rawStatementText: 'TEKsystems', amount: 2520, categoryId: null, status: 'toreview',
    });
    catRules = [catRule({ pattern: 'teksystems' })];
    const res = await applyPOST(new NextRequest('http://localhost/api/categorization-rules/apply', { method: 'POST' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.matched).toBe(1);
    expect(body.data.total).toBe(1);
    expect(body.data.message).toBe('1 of 1 transactions auto-categorized');
    expect(store[0].status).toBe('categorized');
    expect(store[0].categoryId).toBe('coa-4000');
  });
});
