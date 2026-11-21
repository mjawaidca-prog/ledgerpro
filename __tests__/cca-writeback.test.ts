/**
 * CCA write-back (improvement plan Phase 3, item 5; design §3.4).
 *
 * The receiving side of the write-back loop: `cca-writeback/1`
 * payloads from Nexvar Tax carrying the CCA claimed and closing
 * UCC by class AS FILED, plus the Schedule 1 adjustment lines that
 * become a proposed (never auto-posted) year-end journal.
 *
 * Expected figures are hand-computed from the class rates and the
 * pool formula documented in src/lib/cca-writeback.ts — they are
 * not snapshots of whatever the code happens to output.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildCcaWritebackPayload,
  buildSch1JournalLines,
  computeClassVariance,
  moneyStringToCents,
  parseCcaWritebackPayload,
  planWritebackImport,
  projectClassClaimCents,
  projectClosingUccCents,
  sch1ExpenseAccountCode,
  validateWritebackForCompany,
  type ClassProjectionFacts,
} from '@/lib/cca-writeback';
import { buildCcaRegisterPayload } from '@/lib/cca-register';
import { canonicalPayloadHash } from '@/lib/tb-gifi';

// ─── Fixtures ───

const COMPANY_ID = 'co-1';
const BN = '731893160RC0001';
const FY = { start: '2025-10-01', end: '2026-09-30' };

function validPayload(overrides: Record<string, unknown> = {}) {
  const built = buildCcaWritebackPayload({
    companyId: COMPANY_ID,
    businessNumber: BN,
    fiscalYearStart: FY.start,
    fiscalYearEnd: FY.end,
    classes: [
      { ccaClass: '8', ccaClaimedCents: 412_000, closingUccCents: 1_648_000 },
      { ccaClass: '10', ccaClaimedCents: 690_000, closingUccCents: 1_610_000 },
    ],
    schedule1Adjustments: [
      { description: 'Schedule 1: add back book amortization', amountCents: 985_000, direction: 'add' },
      { description: 'Schedule 1: deduct capital cost allowance', amountCents: 1_102_000, direction: 'deduct' },
    ],
    source: { returnId: 'ret-1', filedAt: '2027-03-28T14:03:11.000Z', confirmationNumber: 'CONF-9' },
  });
  return { ...built, ...overrides };
}

function rehash(payload: Record<string, unknown>) {
  const { hash: _h, ...rest } = payload;
  return { ...rest, hash: canonicalPayloadHash(rest) };
}

// ─── Parsing & hash ───

describe('cca-writeback/1 parsing', () => {
  test('a built payload parses back with cents intact', () => {
    const parsed = parseCcaWritebackPayload(validPayload());
    expect(parsed.companyId).toBe(COMPANY_ID);
    expect(parsed.businessNumber).toBe(BN);
    expect(parsed.fiscalYearStart).toBe(FY.start);
    expect(parsed.classes).toEqual([
      { ccaClass: '8', ccaClaimedCents: 412_000, closingUccCents: 1_648_000 },
      { ccaClass: '10', ccaClaimedCents: 690_000, closingUccCents: 1_610_000 },
    ]);
    expect(parsed.schedule1Adjustments[0].direction).toBe('add');
    expect(parsed.source).toEqual({
      product: 'nexvar-tax',
      returnId: 'ret-1',
      filedAt: '2027-03-28T14:03:11.000Z',
      confirmationNumber: 'CONF-9',
    });
  });

  test('a tampered payload fails hash verification', () => {
    const payload = validPayload();
    (payload.classes as any[])[0].closingUcc = '99999.99'; // edited after hashing
    expect(() => parseCcaWritebackPayload(payload)).toThrow(/hash verification failed/);
  });

  test('a missing or malformed hash is rejected', () => {
    const { hash: _h, ...noHash } = validPayload();
    expect(() => parseCcaWritebackPayload(noHash)).toThrow(/hash is missing/);
  });

  test('a different contract version is rejected', () => {
    expect(() => parseCcaWritebackPayload(rehash(validPayload({ contractVersion: 'cca-writeback/2' })))).toThrow(
      /unsupported contractVersion/
    );
  });

  test('money must be a two-decimal string', () => {
    expect(moneyStringToCents('0.00', 'x')).toBe(0);
    expect(moneyStringToCents('-12.34', 'x')).toBe(-1234);
    expect(() => moneyStringToCents('100', 'x')).toThrow(/decimal string/);
    expect(() => moneyStringToCents(100, 'x')).toThrow(/decimal string/);
    expect(() => moneyStringToCents('1.5', 'x')).toThrow(/decimal string/);
  });

  test('negative claimed / closing figures are rejected (direction carries signs, not amounts)', () => {
    const badClaim = rehash(
      validPayload({
        classes: [{ class: '8', ccaClaimed: '-1.00', closingUcc: '10.00' }],
      })
    );
    expect(() => parseCcaWritebackPayload(badClaim)).toThrow(/cannot be negative/);
    const badAdj = rehash(
      validPayload({
        schedule1Adjustments: [{ description: 'x', amount: '-5.00', direction: 'add' }],
      })
    );
    expect(() => parseCcaWritebackPayload(badAdj)).toThrow(/cannot be negative/);
  });

  test('an unknown direction is rejected', () => {
    const bad = rehash(
      validPayload({ schedule1Adjustments: [{ description: 'x', amount: '5.00', direction: 'sideways' }] })
    );
    expect(() => parseCcaWritebackPayload(bad)).toThrow(/direction must be "add" or "deduct"/);
  });

  test('a payload from another product is rejected', () => {
    const bad = rehash(
      validPayload({
        source: { product: 'someone-else', returnId: 'r', filedAt: '2027-01-01' },
      })
    );
    expect(() => parseCcaWritebackPayload(bad)).toThrow(/source\.product must be "nexvar-tax"/);
  });
});

// ─── Class validation ───

describe('class validation', () => {
  test('a class Nexvar Tax does not model is rejected', () => {
    const bad = rehash(validPayload({ classes: [{ class: '99', ccaClaimed: '1.00', closingUcc: '1.00' }] }));
    expect(() => parseCcaWritebackPayload(bad)).toThrow(/not a CCA class Nexvar Tax models/);
  });

  test('a duplicated class is rejected', () => {
    const bad = rehash(
      validPayload({
        classes: [
          { class: '8', ccaClaimed: '1.00', closingUcc: '1.00' },
          { class: '8', ccaClaimed: '2.00', closingUcc: '2.00' },
        ],
      })
    );
    expect(() => parseCcaWritebackPayload(bad)).toThrow(/appears twice/);
  });

  test('Class 10.1 (a separate-class code with a dot) is accepted', () => {
    const ok = rehash(validPayload({ classes: [{ class: '10.1', ccaClaimed: '1.00', closingUcc: '1.00' }] }));
    expect(parseCcaWritebackPayload(ok).classes[0].ccaClass).toBe('10.1');
  });

  test('an empty class list is a valid filed year (a return with no CCA)', () => {
    const ok = rehash(validPayload({ classes: [], schedule1Adjustments: [] }));
    const parsed = parseCcaWritebackPayload(ok);
    expect(parsed.classes).toEqual([]);
  });
});

// ─── Company / BN / fiscal-year matching ───

describe('company matching', () => {
  const parsed = () => parseCcaWritebackPayload(validPayload());
  const ctx = { companyId: COMPANY_ID, contractBn: BN, fiscalYear: FY };

  test('an exact match passes', () => {
    expect(() => validateWritebackForCompany(parsed(), ctx)).not.toThrow();
  });

  test('another company\u2019s file is refused', () => {
    expect(() => validateWritebackForCompany(parsed(), { ...ctx, companyId: 'co-2' })).toThrow(
      /different company/
    );
  });

  test('a business-number mismatch is refused', () => {
    expect(() => validateWritebackForCompany(parsed(), { ...ctx, contractBn: '999999999RC0001' })).toThrow(
      /business number .* does not match/
    );
  });

  test('a company with no BN on file cannot accept a write-back', () => {
    expect(() => validateWritebackForCompany(parsed(), { ...ctx, contractBn: null })).toThrow(
      /no business number on file/
    );
  });

  test('a fiscal year that is not the company\u2019s is refused', () => {
    expect(
      () => validateWritebackForCompany(parsed(), { ...ctx, fiscalYear: { start: '2025-01-01', end: '2025-12-31' } })
    ).toThrow(/not one of this company's fiscal years/);
  });
});

// ─── Duplicate / version planning ───

describe('import planning', () => {
  test('first import for a year creates', () => {
    expect(planWritebackImport(null, 'abc')).toBe('create_first');
  });
  test('the identical file again is a duplicate, refused', () => {
    expect(planWritebackImport('abc', 'abc')).toBe('duplicate');
  });
  test('a different file for the same year versions', () => {
    expect(planWritebackImport('abc', 'def')).toBe('create_version');
  });
});

// ─── Proposed Sch 1 journal ───

describe('proposed Sch 1 journal lines', () => {
  const accounts = { expenseCode: '6860', accumCode: '1695' };
  const adjustments = [
    { description: 'add back book amortization', amountCents: 985_000, direction: 'add' as const },
    { description: 'deduct CCA', amountCents: 1_102_000, direction: 'deduct' as const },
  ];

  test('an "add" line reverses book expense through accumulated depreciation', () => {
    const lines = buildSch1JournalLines([adjustments[0]], accounts);
    expect(lines).toEqual([
      { glAccountCode: '1695', description: 'add back book amortization', debit: 9850, credit: 0 },
      { glAccountCode: '6860', description: 'add back book amortization', debit: 0, credit: 9850 },
    ]);
  });

  test('a "deduct" line records the deduction through accumulated depreciation', () => {
    const lines = buildSch1JournalLines([adjustments[1]], accounts);
    expect(lines).toEqual([
      { glAccountCode: '6860', description: 'deduct CCA', debit: 11020, credit: 0 },
      { glAccountCode: '1695', description: 'deduct CCA', debit: 0, credit: 11020 },
    ]);
  });

  test('the whole proposal balances to the cent', () => {
    const lines = buildSch1JournalLines(adjustments, accounts);
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(9850 + 11020);
  });

  test('zero-amount lines are skipped and no lines means no journal', () => {
    expect(
      buildSch1JournalLines([{ description: 'nil', amountCents: 0, direction: 'add' }], accounts)
    ).toEqual([]);
    expect(buildSch1JournalLines([], accounts)).toEqual([]);
  });

  test('the expense account is the amortization account only when every class is intangible', () => {
    expect(sch1ExpenseAccountCode([{ ccaClass: '14.1' }, { ccaClass: '14' }])).toBe('6870');
    expect(sch1ExpenseAccountCode([{ ccaClass: '14.1' }, { ccaClass: '8' }])).toBe('6860');
    expect(sch1ExpenseAccountCode([{ ccaClass: '8' }])).toBe('6860');
    expect(sch1ExpenseAccountCode([])).toBe('6860');
  });
});

// ─── Projection (the register's own expectation) ───

describe('closing-UCC projection', () => {
  const facts = (overrides: Partial<ClassProjectionFacts>): ClassProjectionFacts => ({
    ccaClass: '8', // 20% declining balance
    openingUccCents: 0,
    additions: [],
    disposals: [],
    slProjectedClaimCents: null,
    ...overrides,
  });

  test('opening pool only: 20% of $10,000 = $2,000 claim, $8,000 closing', () => {
    const f = facts({ openingUccCents: 1_000_000 });
    expect(projectClassClaimCents(f)).toBe(200_000);
    expect(projectClosingUccCents(f)).toBe(800_000);
  });

  test('a first-year addition takes the half-year rule: $10,000 Class 8 claims $1,000', () => {
    const f = facts({
      additions: [{ costCents: 1_000_000, aiip: false, availableForUseDate: '2026-02-01' }],
    });
    expect(projectClassClaimCents(f)).toBe(100_000);
    expect(projectClosingUccCents(f)).toBe(900_000);
  });

  test('an AIIP addition AFU before 2024 takes the enhanced factor: $10,000 claims $3,000', () => {
    const f = facts({
      additions: [{ costCents: 1_000_000, aiip: true, availableForUseDate: '2023-06-01' }],
    });
    expect(projectClassClaimCents(f)).toBe(300_000);
  });

  test('a disposal deducts the lesser of proceeds and capital cost', () => {
    // Opening $10,000; disposal proceeds $3,000 on a $4,000 asset →
    // deduction $3,000; claim 20% × $7,000 = $1,400; closing $5,600.
    const f = facts({
      openingUccCents: 1_000_000,
      disposals: [{ proceedsCents: 300_000, capitalCostCents: 400_000 }],
    });
    expect(projectClassClaimCents(f)).toBe(140_000);
    expect(projectClosingUccCents(f)).toBe(560_000);
  });

  test('proceeds above capital cost still deduct only the capital cost', () => {
    const f = facts({
      openingUccCents: 1_000_000,
      disposals: [{ proceedsCents: 500_000, capitalCostCents: 400_000 }],
    });
    expect(projectClosingUccCents(f)).toBe(1_000_000 - 400_000 - 120_000);
  });

  test('the claim can never exceed the pool', () => {
    const f = facts({
      ccaClass: '12', // 100%, half-year exempt
      additions: [{ costCents: 50_000, aiip: false, availableForUseDate: '2026-01-10' }],
    });
    expect(projectClassClaimCents(f)).toBe(50_000);
    expect(projectClosingUccCents(f)).toBe(0);
  });

  test('straight-line classes project at the register\u2019s own computed amount', () => {
    const f = facts({ ccaClass: '29', openingUccCents: 400_000, slProjectedClaimCents: 100_000 });
    expect(projectClassClaimCents(f)).toBe(100_000);
    expect(projectClosingUccCents(f)).toBe(300_000);
  });
});

// ─── Variance ───

describe('variance view', () => {
  const projectionFacts: ClassProjectionFacts = {
    ccaClass: '8',
    openingUccCents: 1_000_000,
    additions: [],
    disposals: [],
    slProjectedClaimCents: null,
  };
  // Projection: claim $2,000, expected closing $8,000.

  test('filed figures that match the projection tie out', () => {
    const v = computeClassVariance({
      ccaClass: '8',
      filedClaimCents: 200_000,
      filedClosingUccCents: 800_000,
      projectionFacts,
      factsChangedAfterFiling: false,
    });
    expect(v.cause).toBe('ties_out');
    expect(v.differenceCents).toBe(0);
  });

  test('a lower claim explains the closing difference to the cent', () => {
    // Filed claimed $1,500 of the $2,000 projection → closing is
    // exactly the $500 shortfall higher.
    const v = computeClassVariance({
      ccaClass: '8',
      filedClaimCents: 150_000,
      filedClosingUccCents: 850_000,
      projectionFacts,
      factsChangedAfterFiling: false,
    });
    expect(v.cause).toBe('claim_differed');
    expect(v.differenceCents).toBe(50_000);
    expect(v.causeText).toMatch(/claiming less is a filing choice/);
  });

  test('register facts changed after filing are named when the claim does not explain it', () => {
    const v = computeClassVariance({
      ccaClass: '8',
      filedClaimCents: 200_000, // claim matches the projection…
      filedClosingUccCents: 700_000, // …but the closing is $1,000 lower
      projectionFacts,
      factsChangedAfterFiling: true,
    });
    expect(v.cause).toBe('facts_changed_after_filing');
  });

  test('an unexplained difference is reported as unexplained, never smoothed over', () => {
    const v = computeClassVariance({
      ccaClass: '8',
      filedClaimCents: 200_000,
      filedClosingUccCents: 700_000,
      projectionFacts,
      factsChangedAfterFiling: false,
    });
    expect(v.cause).toBe('unexplained');
    expect(v.differenceCents).toBe(-100_000);
  });

  test('the first filed year has no baseline and says so', () => {
    const v = computeClassVariance({
      ccaClass: '8',
      filedClaimCents: 200_000,
      filedClosingUccCents: 800_000,
      projectionFacts: null,
      factsChangedAfterFiling: false,
    });
    expect(v.cause).toBe('no_filed_opening');
    expect(v.expectedClosingUccCents).toBeNull();
    expect(v.differenceCents).toBeNull();
  });
});

// ─── Filed-record sourcing in the cca-register/1 export ───

describe('cca-register/1 export sourcing', () => {
  const baseInput = {
    companyId: COMPANY_ID,
    bn: BN,
    fiscalYearStart: FY.start,
    fiscalYearEnd: FY.end,
    fiscalYearLabel: 'FY 2025',
    classes: [
      {
        ccaClass: '8',
        label: 'Class 8 — furniture, equipment & fixtures, 20%',
        ratePct: 20,
        method: 'DB' as const,
        openingCapitalCostCents: 2_000_000,
        closingCapitalCostCents: 2_000_000,
        bookDepreciationExpenseCents: 985_000,
        accumulatedBookDepCents: 985_000,
        netBookValueCents: 1_015_000,
        additionAssetIds: [],
        disposalAssetIds: [],
      },
    ],
    assets: [],
    ledgerAmortizationExpenseCents: null,
  };

  test('without a write-back, ccaClaimed and openingUccAsFiled stay null (unchanged behaviour)', () => {
    const { payload } = buildCcaRegisterPayload(baseInput);
    expect((payload.schedule1 as any).ccaClaimed).toBeNull();
    expect((payload.classes as any[])[0].openingUccAsFiled).toBeNull();
  });

  test('with a write-back, the export carries the filed figures', () => {
    const { payload } = buildCcaRegisterPayload({
      ...baseInput,
      ccaClaimedCents: 1_102_000,
      openingUccAsFiledCentsByClass: { '8': 1_648_000 },
    });
    expect((payload.schedule1 as any).ccaClaimed).toBe('11020.00');
    expect((payload.classes as any[])[0].openingUccAsFiled).toBe('16480.00');
  });
});

// ─── Schema & migration presence ───

describe('schema and migration', () => {
  const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(
    resolve('prisma/migrations/20261121190000_cca_writeback/migration.sql'),
    'utf8'
  );

  test('the CcaWriteback model and the cca_writeback journal source exist', () => {
    expect(schema).toContain('model CcaWriteback');
    expect(schema).toMatch(/enum JournalSource \{[^}]*cca_writeback/);
    expect(schema).toContain('ccaWritebacks       CcaWriteback[]');
  });

  test('the migration creates the table and the enum value, additively', () => {
    expect(migration).toContain('CREATE TABLE "CcaWriteback"');
    expect(migration).toContain(`ADD VALUE IF NOT EXISTS 'cca_writeback'`);
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER TABLE "Company"/);
  });
});
