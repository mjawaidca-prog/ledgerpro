/**
 * CCA register (improvement plan Phase 1, item 4).
 *
 * The expected values below are hand-computed from the CCA class
 * rates and the book-policy rules documented in src/lib/cca/engine.ts
 * (half-year rule on additions, AIIP first-year factors, no
 * depreciation in the year of disposal) — they are not snapshots of
 * whatever the engine happens to output. The export expectations are
 * written against the `cca-register/1` contract in
 * src/lib/cca-register.ts (design §3.3).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  accumulatedDepAtCents,
  capitalCostCents,
  classContinuity,
  computeBookSchedule,
  depreciationForYearCents,
  type BookAssetFacts,
  type ContinuityAsset,
  type FiscalYearLike,
} from '@/lib/cca/engine';
import { CCA_CLASSES, defaultAiip, mirrorFirstYearFactor } from '@/lib/cca/classes';
import { buildCcaRegisterPayload, CCA_REGISTER_CONTRACT_VERSION } from '@/lib/cca-register';
import { canonicalPayloadHash } from '@/lib/tb-gifi';

const CY = (y: number): FiscalYearLike => ({
  label: `FY ${y}`,
  start: `${y}-01-01`,
  end: `${y}-12-31`,
});
const YEARS = [CY(2022), CY(2023), CY(2024), CY(2025), CY(2026), CY(2027), CY(2028)];

function facts(overrides: Partial<BookAssetFacts>): BookAssetFacts {
  return {
    capitalCostCents: 1_000_000,
    availableForUseDate: '2023-01-15',
    ccaClass: '8',
    aiip: false,
    bookMethod: 'mirror_tax',
    bookRatePct: null,
    bookLifeYears: null,
    openingAccumDepCents: 0,
    openingAccumThrough: null,
    disposal: null,
    ...overrides,
  };
}

describe('capital cost — net of ITCs and assistance', () => {
  test('a $10,000 purchase plus 13% HST: gross $11,300, ITC $1,300, cost $10,000', () => {
    expect(capitalCostCents(1_130_000, 130_000, 0)).toBe(1_000_000);
  });
  test('government assistance also reduces the cost', () => {
    expect(capitalCostCents(1_130_000, 130_000, 50_000)).toBe(950_000);
  });
  test('ITCs plus assistance above the gross cost are a data error', () => {
    expect(() => capitalCostCents(100_000, 130_000, 0)).toThrow(RangeError);
  });
  test('negative inputs are rejected', () => {
    expect(() => capitalCostCents(-1, 0, 0)).toThrow(RangeError);
  });
});

describe('mirror-tax declining balance — half-year rule on additions', () => {
  // Class 10 (30%): $30,000 vehicle, AFU Mar 15, 2023, not AIIP.
  // Year 1: 30,000 × 30% × ½ = 4,500. Year 2: 25,500 × 30% = 7,650.
  // Year 3: 17,850 × 30% = 5,355.
  const asset = facts({
    ccaClass: '10',
    capitalCostCents: 3_000_000,
    availableForUseDate: '2023-03-15',
  });
  const rows = computeBookSchedule(asset, YEARS);

  test('no rows before the available-for-use year', () => {
    expect(rows.map((r) => r.label)).toEqual(['FY 2023', 'FY 2024', 'FY 2025', 'FY 2026', 'FY 2027', 'FY 2028']);
  });
  test('first year takes the half-year rule', () => {
    expect(rows[0].depreciationCents).toBe(450_000);
    expect(rows[0].closingNbvCents).toBe(2_550_000);
  });
  test('later years run on the declining balance', () => {
    expect(rows[1].depreciationCents).toBe(765_000);
    expect(rows[2].depreciationCents).toBe(535_500);
    expect(rows[2].closingNbvCents).toBe(1_249_500);
  });
  test('accumulated depreciation accumulates', () => {
    expect(accumulatedDepAtCents(asset, YEARS, 'FY 2025')).toBe(1_750_500);
    expect(depreciationForYearCents(asset, YEARS, 'FY 2024')).toBe(765_000);
  });
});

describe('half-year-exempt classes (Class 52, 100%)', () => {
  test('the full cost is depreciated in the first year', () => {
    const asset = facts({ ccaClass: '52', capitalCostCents: 200_000, availableForUseDate: '2023-05-01' });
    const rows = computeBookSchedule(asset, YEARS);
    expect(rows[0].depreciationCents).toBe(200_000);
    expect(rows[0].closingNbvCents).toBe(0);
    expect(rows[1].depreciationCents).toBe(0);
  });
});

describe('AIIP first-year factors (Class 50, 55%)', () => {
  const cost = 1_000_000; // $10,000
  test('AIIP available for use before 2024: factor 1.5 — 10,000 × 55% × 1.5 = 8,250', () => {
    const asset = facts({ ccaClass: '50', capitalCostCents: cost, availableForUseDate: '2023-06-01', aiip: true });
    expect(computeBookSchedule(asset, YEARS)[0].depreciationCents).toBe(825_000);
  });
  test('AIIP available for use in 2025: factor 1.0 — 10,000 × 55% = 5,500', () => {
    const asset = facts({ ccaClass: '50', capitalCostCents: cost, availableForUseDate: '2025-06-01', aiip: true });
    const rows = computeBookSchedule(asset, YEARS);
    expect(rows.find((r) => r.label === 'FY 2025')?.depreciationCents).toBe(550_000);
  });
  test('not AIIP: the plain half-year rule — 10,000 × 55% × ½ = 2,750', () => {
    const asset = facts({ ccaClass: '50', capitalCostCents: cost, availableForUseDate: '2025-06-01', aiip: false });
    const rows = computeBookSchedule(asset, YEARS);
    expect(rows.find((r) => r.label === 'FY 2025')?.depreciationCents).toBe(275_000);
  });
  test('factor table matches the phase-out', () => {
    const info = CCA_CLASSES['50'];
    expect(mirrorFirstYearFactor(info, true, '2023-12-31')).toBe(1.5);
    expect(mirrorFirstYearFactor(info, true, '2024-01-01')).toBe(1);
    expect(mirrorFirstYearFactor(info, true, '2027-12-31')).toBe(1);
    expect(mirrorFirstYearFactor(info, true, '2028-01-01')).toBe(0.5);
    expect(mirrorFirstYearFactor(info, false, '2023-06-01')).toBe(0.5);
    expect(mirrorFirstYearFactor(CCA_CLASSES['12'], false, '2023-06-01')).toBe(1);
  });
  test('default AIIP flag follows the acquisition-date rule', () => {
    expect(defaultAiip('2023-01-15', '2023-01-15')).toBe(true);
    expect(defaultAiip('2018-11-20', '2019-01-01')).toBe(false); // acquired ON Nov 20, 2018 is not after it
    expect(defaultAiip('2018-11-21', '2019-01-01')).toBe(true);
    expect(defaultAiip('2027-06-01', '2028-06-01')).toBe(false); // AFU not before 2028
  });
});

describe('disposals — no depreciation in the disposal year, book gain/loss on NBV', () => {
  // Class 8 (20%): $10,000, AFU Feb 1, 2022. FY2022: 10,000 × 20% × ½ =
  // 1,000 → NBV 9,000. FY2023: 9,000 × 20% = 1,800 → NBV 7,200.
  // Sold Jun 15, 2024 for $8,000: gain = 8,000 − 7,200 = 800.
  const base = {
    ccaClass: '8',
    capitalCostCents: 1_000_000,
    availableForUseDate: '2022-02-01',
  };
  test('gain on disposal', () => {
    const asset = facts({ ...base, disposal: { date: '2024-06-15', proceedsCents: 800_000 } });
    const rows = computeBookSchedule(asset, YEARS);
    expect(rows.map((r) => r.label)).toEqual(['FY 2022', 'FY 2023', 'FY 2024']);
    const disposalRow = rows[2];
    expect(disposalRow.depreciationCents).toBe(0);
    expect(disposalRow.openingNbvCents).toBe(720_000);
    expect(disposalRow.disposal?.gainLossCents).toBe(80_000);
    expect(disposalRow.closingNbvCents).toBe(0);
  });
  test('loss on disposal', () => {
    const asset = facts({ ...base, disposal: { date: '2024-06-15', proceedsCents: 500_000 } });
    const rows = computeBookSchedule(asset, YEARS);
    expect(rows[2].disposal?.gainLossCents).toBe(-220_000);
  });
  test('acquired and disposed in the same year: no depreciation, gain/loss on full cost', () => {
    const asset = facts({
      ccaClass: '8',
      capitalCostCents: 1_000_000,
      availableForUseDate: '2024-03-01',
      disposal: { date: '2024-09-01', proceedsCents: 1_100_000 },
    });
    const rows = computeBookSchedule(asset, YEARS);
    expect(rows).toHaveLength(1);
    expect(rows[0].depreciationCents).toBe(0);
    expect(rows[0].disposal?.gainLossCents).toBe(100_000);
  });
});

describe('book policy overrides', () => {
  test('straight-line: $12,000 over 5 years is $2,400 every year, first year in full', () => {
    const asset = facts({
      capitalCostCents: 1_200_000,
      availableForUseDate: '2023-01-10',
      bookMethod: 'straight_line',
      bookLifeYears: 5,
    });
    const rows = computeBookSchedule(asset, YEARS);
    expect(rows.slice(0, 5).map((r) => r.depreciationCents)).toEqual([
      240_000, 240_000, 240_000, 240_000, 240_000,
    ]);
    expect(rows[4].closingNbvCents).toBe(0);
    expect(rows[5].depreciationCents).toBe(0); // capped at NBV
  });
  test('declining-balance override: 20% on NBV, no half-year rule', () => {
    const asset = facts({
      capitalCostCents: 2_000_000,
      availableForUseDate: '2023-01-10',
      bookMethod: 'declining_balance',
      bookRatePct: 20,
    });
    const rows = computeBookSchedule(asset, YEARS);
    expect(rows[0].depreciationCents).toBe(400_000);
    expect(rows[1].depreciationCents).toBe(320_000);
  });
  test('none: never depreciates', () => {
    const asset = facts({ bookMethod: 'none' });
    expect(computeBookSchedule(asset, YEARS).every((r) => r.depreciationCents === 0)).toBe(true);
  });
});

describe('mirror-tax straight-line classes', () => {
  test('Class 29 (50% SL): first year half of the annual amount, then full, capped at cost', () => {
    // $40,000: annual = 20,000. FY1 = 10,000; FY2 = 20,000; FY3 = 10,000 (cap).
    const asset = facts({ ccaClass: '29', capitalCostCents: 4_000_000, availableForUseDate: '2023-04-01' });
    const rows = computeBookSchedule(asset, YEARS);
    expect(rows[0].depreciationCents).toBe(1_000_000);
    expect(rows[1].depreciationCents).toBe(2_000_000);
    expect(rows[2].depreciationCents).toBe(1_000_000);
    expect(rows[2].closingNbvCents).toBe(0);
  });
  test('Class 13 (leasehold, life-based): $24,000 over 10 years, first year halved', () => {
    const asset = facts({
      ccaClass: '13',
      capitalCostCents: 2_400_000,
      availableForUseDate: '2023-04-01',
      bookLifeYears: 10,
    });
    const rows = computeBookSchedule(asset, YEARS);
    expect(rows[0].depreciationCents).toBe(120_000);
    expect(rows[1].depreciationCents).toBe(240_000);
  });
});

describe('mid-life adoption — opening accumulated depreciation is respected', () => {
  test('the engine starts from cost − opening accum and applies no first-year factor', () => {
    // Class 10, $30,000, AFU 2022 — but the books already carry $5,000
    // of depreciation through Dec 31, 2023. First computed year is
    // FY2024: NBV 25,000 × 30% = 7,500 (no half-year factor).
    const asset = facts({
      ccaClass: '10',
      capitalCostCents: 3_000_000,
      availableForUseDate: '2022-03-01',
      openingAccumDepCents: 500_000,
      openingAccumThrough: '2023-12-31',
    });
    const rows = computeBookSchedule(asset, YEARS);
    expect(rows[0].label).toBe('FY 2024');
    expect(rows[0].openingNbvCents).toBe(2_500_000);
    expect(rows[0].depreciationCents).toBe(750_000);
    expect(rows[0].accumulatedDepCents).toBe(1_250_000);
  });
});

describe('non-calendar fiscal years (Oct 1 – Sep 30)', () => {
  test('an asset available Nov 15, 2025 first depreciates in FY 2026', () => {
    const years: FiscalYearLike[] = [
      { label: 'FY 2025', start: '2024-10-01', end: '2025-09-30' },
      { label: 'FY 2026', start: '2025-10-01', end: '2026-09-30' },
      { label: 'FY 2027', start: '2026-10-01', end: '2027-09-30' },
    ];
    const asset = facts({
      ccaClass: '10',
      capitalCostCents: 3_000_000,
      availableForUseDate: '2025-11-15',
    });
    const rows = computeBookSchedule(asset, years);
    expect(rows.map((r) => r.label)).toEqual(['FY 2026', 'FY 2027']);
    expect(rows[0].depreciationCents).toBe(450_000); // half-year rule
  });
});

describe('per-class continuity', () => {
  const cont = (a: Partial<ContinuityAsset> & { id: string }): ContinuityAsset => ({
    acquisitionDate: a.availableForUseDate ?? '2023-01-15',
    ...facts(a),
    ...a,
  });
  const assets: ContinuityAsset[] = [
    cont({ id: 'veh', ccaClass: '10', capitalCostCents: 3_000_000, availableForUseDate: '2023-03-15', acquisitionDate: '2023-03-15' }),
    cont({
      id: 'equip',
      ccaClass: '10',
      capitalCostCents: 1_000_000,
      availableForUseDate: '2024-04-01',
      acquisitionDate: '2024-04-01',
      disposal: { date: '2025-02-01', proceedsCents: 800_000 },
    }),
    cont({ id: 'pc', ccaClass: '50', capitalCostCents: 500_000, availableForUseDate: '2025-05-01', acquisitionDate: '2025-05-01' }),
  ];
  const rows = classContinuity(assets, YEARS, CY(2025));
  const c10 = rows.find((r) => r.ccaClass === '10')!;
  const c50 = rows.find((r) => r.ccaClass === '50')!;

  test('Class 10: opening holds both assets, the disposal leaves at cost, proceeds recorded', () => {
    expect(c10.openingCostCents).toBe(4_000_000);
    expect(c10.additionsCostCents).toBe(0);
    expect(c10.disposalsCostCents).toBe(1_000_000);
    expect(c10.disposalsProceedsCents).toBe(800_000);
    expect(c10.closingCostCents).toBe(3_000_000);
    expect(c10.disposalAssetIds).toEqual(['equip']);
  });
  test('Class 10 book side: only the surviving asset depreciates and accumulates in FY2025', () => {
    // Vehicle FY2025 depreciation 5,355 (see half-year suite); the
    // disposed asset takes none in its disposal year.
    expect(c10.bookDepreciationCents).toBe(535_500);
    expect(c10.accumulatedBookDepCents).toBe(1_750_500);
    expect(c10.netBookValueCents).toBe(1_249_500);
  });
  test('Class 50: the in-year addition appears with its first-year depreciation', () => {
    expect(c50.openingCostCents).toBe(0);
    expect(c50.additionsCostCents).toBe(500_000);
    expect(c50.additionAssetIds).toEqual(['pc']);
    // $5,000 × 55% × ½ = $1,375
    expect(c50.bookDepreciationCents).toBe(137_500);
    expect(c50.netBookValueCents).toBe(362_500);
  });
});

describe('cca-register/1 export contract', () => {
  const assetInput = {
    assetId: 'asset-43',
    description: 'CNC milling machine',
    ccaClass: '43',
    capitalCostCents: 1_000_000, // $11,300 gross − $1,300 ITC = $10,000 net
    grossCostCents: 1_130_000,
    itcClaimedCents: 130_000,
    governmentAssistanceCents: 0,
    acquisitionDate: '2026-02-10',
    availableForUseDate: '2026-03-01',
    aiip: true,
    wouldBeClass53: true,
    luxuryVehicle: false,
    vendor: 'MachineCo',
    serialNumber: null,
    bookMethod: 'mirror_tax',
    accumulatedBookDepCents: 450_000,
    netBookValueCents: 550_000,
    disposal: null,
  };
  const buildInput = {
    companyId: 'company-1',
    bn: '731893160RC0001',
    fiscalYearStart: '2025-10-01',
    fiscalYearEnd: '2026-09-30',
    fiscalYearLabel: 'FY 2026',
    classes: [
      {
        ccaClass: '43',
        label: 'Class 43 — manufacturing & processing machinery, 30%',
        ratePct: 30,
        method: 'DB' as const,
        openingCapitalCostCents: 0,
        closingCapitalCostCents: 1_000_000,
        bookDepreciationExpenseCents: 450_000,
        accumulatedBookDepCents: 450_000,
        netBookValueCents: 550_000,
        additionAssetIds: ['asset-43'],
        disposalAssetIds: [],
      },
    ],
    assets: [assetInput],
    ledgerAmortizationExpenseCents: 450_000,
  };

  test('carries the contract identity and fiscal period', () => {
    const { payload } = buildCcaRegisterPayload(buildInput);
    expect(payload.contractVersion).toBe(CCA_REGISTER_CONTRACT_VERSION);
    expect(payload.contractVersion).toBe('cca-register/1');
    expect(payload.companyId).toBe('company-1');
    expect(payload.bn).toBe('731893160RC0001');
    expect(payload.fiscalYearStart).toBe('2025-10-01');
    expect(payload.fiscalYearEnd).toBe('2026-09-30');
  });

  test('additions carry the Sch 8 facts: net cost, dates, AIIP and the would-be-Class-53 flag (BF-2)', () => {
    const { payload } = buildCcaRegisterPayload(buildInput);
    const classes = payload.classes as any[];
    expect(classes).toHaveLength(1);
    expect(classes[0].additions).toEqual([
      {
        assetId: 'asset-43',
        description: 'CNC milling machine',
        cost: '10000.00', // NET of the $1,300 ITC — never the $11,300 gross
        acquisitionDate: '2026-02-10',
        availableForUseDate: '2026-03-01',
        aiip: true,
        wouldBeClass53: true,
      },
    ]);
    expect(classes[0].openingUccAsFiled).toBeNull(); // reserved for the write-back loop
  });

  test('the register dump keeps gross, ITC and net side by side', () => {
    const { payload } = buildCcaRegisterPayload(buildInput);
    const assets = payload.assets as any[];
    expect(assets[0].grossCost).toBe('11300.00');
    expect(assets[0].itcClaimed).toBe('1300.00');
    expect(assets[0].capitalCost).toBe('10000.00');
  });

  test('Schedule 1: book add-back is machine-supplied, CCA claimed is reserved null', () => {
    const { payload } = buildCcaRegisterPayload(buildInput);
    const sch1 = payload.schedule1 as any;
    expect(sch1.bookAmortizationAddBack).toBe('4500.00');
    expect(sch1.ccaClaimed).toBeNull();
  });

  test('book side cross-checks against the ledger and reports the difference', () => {
    const tied = buildCcaRegisterPayload(buildInput);
    expect((tied.payload.bookSide as any).difference).toBe('0.00');
    expect((tied.payload.bookSide as any).tiesOut).toBe(true);
    expect(tied.bookVsLedgerDifferenceCents).toBe(0);

    const off = buildCcaRegisterPayload({ ...buildInput, ledgerAmortizationExpenseCents: 400_000 });
    expect((off.payload.bookSide as any).difference).toBe('500.00');
    expect((off.payload.bookSide as any).tiesOut).toBe(false);

    const noLedger = buildCcaRegisterPayload({ ...buildInput, ledgerAmortizationExpenseCents: null });
    expect((noLedger.payload.bookSide as any).ledgerAmortizationExpenseForYear).toBeNull();
    expect((noLedger.payload.bookSide as any).difference).toBeNull();
    expect((noLedger.payload.bookSide as any).tiesOut).toBeNull();
  });

  test('hash is the canonical hash of the payload without the hash field, and is stable', () => {
    const a = buildCcaRegisterPayload(buildInput);
    const b = buildCcaRegisterPayload(buildInput);
    expect(a.payload.hash).toBe(b.payload.hash);
    const { hash, ...rest } = a.payload;
    expect(canonicalPayloadHash(rest)).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('hash changes when a fact changes', () => {
    const a = buildCcaRegisterPayload(buildInput);
    const changed = buildCcaRegisterPayload({
      ...buildInput,
      assets: [{ ...assetInput, wouldBeClass53: false }],
    });
    expect(changed.payload.hash).not.toBe(a.payload.hash);
  });

  test('disposals reach the class section with proceeds, date and reason', () => {
    const disposedAsset = {
      ...assetInput,
      assetId: 'asset-8',
      ccaClass: '8',
      disposal: { date: '2026-05-20', proceedsCents: 250_000, reason: 'sold' },
    };
    const { payload } = buildCcaRegisterPayload({
      ...buildInput,
      classes: [
        {
          ccaClass: '8',
          label: 'Class 8 — furniture, equipment & fixtures, 20%',
          ratePct: 20,
          method: 'DB' as const,
          openingCapitalCostCents: 1_000_000,
          closingCapitalCostCents: 0,
          bookDepreciationExpenseCents: 0,
          accumulatedBookDepCents: 0,
          netBookValueCents: 0,
          additionAssetIds: [],
          disposalAssetIds: ['asset-8'],
        },
      ],
      assets: [disposedAsset],
    });
    const classes = payload.classes as any[];
    expect(classes[0].disposals).toEqual([
      {
        assetId: 'asset-8',
        description: 'CNC milling machine',
        proceeds: '2500.00',
        date: '2026-05-20',
        reason: 'sold',
      },
    ]);
  });
});

describe('cca register migration', () => {
  const migration = readFileSync(
    resolve('prisma/migrations/20261120210000_cca_register/migration.sql'),
    'utf8'
  );
  const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');

  test('creates the register tables after the loan tool migration', () => {
    expect(migration).toContain('CREATE TABLE "FixedAsset"');
    expect(migration).toContain('CREATE TABLE "FixedAssetDisposal"');
    expect(migration).toContain('CREATE TYPE "BookDepreciationMethod"');
    expect(migration).toContain('CREATE TYPE "DisposalReason"');
    expect(migration).toContain('ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS \'fixed_asset\'');
    expect(migration).toContain('REFERENCES "Company"("id")');
    expect(migration).toContain('REFERENCES "FixedAsset"("id") ON DELETE CASCADE');
    expect(migration).toContain('"wouldBeClass53" BOOLEAN');
    expect(migration).toContain('"capitalCost" DECIMAL(14,2)');
  });

  test('schema carries the models and the fixed_asset journal source', () => {
    expect(schema).toContain('model FixedAsset {');
    expect(schema).toContain('model FixedAssetDisposal {');
    expect(schema).toContain('fixedAssets         FixedAsset[]');
    expect(schema).toMatch(/enum JournalSource \{[^}]*fixed_asset/s);
  });
});
