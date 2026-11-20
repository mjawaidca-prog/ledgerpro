/**
 * Industry chart templates (LedgerPro improvement plan, Phase 1
 * item 2 — design §1: CORE + PACK, never 13 separate charts).
 *
 * Pins:
 *  - composition: CORE (the existing default / corporation templates,
 *    unchanged) + the chosen industry's pack, with no duplicate GL
 *    codes and no pack/CORE code overlap;
 *  - every pack account is born GIFI-coded, and every code — pack and
 *    CORE — is a pickable code in the verified CRA catalogue;
 *  - the deliberately-uncoded CORE exemptions (Retained Earnings,
 *    Opening Balance Equity, Owner's Capital, Owner's Draw) stay
 *    uncoded, and no pack reintroduces them;
 *  - the same GL code always means the same account (name + GIFI)
 *    across every pack and add-on;
 *  - the onboarding Industry wiring end to end: PUT /api/companies
 *    stores the normalized key and layers the pack onto the chart;
 *    createCompanyForUser does the same at creation;
 *  - no-industry regression: provisioning without an industry creates
 *    exactly today's chart, byte for byte by code set.
 */
// default-coa / create-company import the Prisma-backed db module; the
// units under test take injectable clients, so stub db out — same
// pattern as payroll-coa-l1.test.ts. The getter defers to the stateful
// fake (mockDb, declared below) at call time, after initialization.
jest.mock('@/lib/db', () => ({
  get db() {
    return mockDb;
  },
}));

const mockRequireCompany = jest.fn();
const mockAuditLog = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: (...args: unknown[]) => mockRequireCompany(...args),
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));
jest.mock('@/lib/auth', () => ({ getServerSession: jest.fn(async () => null) }));

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';
import {
  CORPORATION_CHART_OF_ACCOUNTS,
  DEFAULT_CHART_OF_ACCOUNTS,
  chartTemplateForBusinessType,
  chartTemplateForCompany,
  ensureDefaultChartOfAccounts,
} from '@/lib/default-coa';
import {
  ADDON_PACKS,
  INDUSTRY_OPTIONS,
  INDUSTRY_PACKS,
  industryPackAccounts,
  isKnownIndustryValue,
  normalizeIndustry,
  type IndustryKey,
} from '@/lib/industry-coa';
import { isPickableGifiCode } from '@/lib/gifi';
import { createCompanyForUser } from '@/lib/create-company';
import { PUT } from '@/app/api/companies/route';

// ── Stateful fake db (shared by provisioning + route tests) ────────

type ChartRow = {
  companyId: string;
  code: string;
  name: string;
  type: string;
  subType: string | null;
  detailType: string | null;
  parentCode: string | null;
  description: string | null;
  gifiCode: string | null;
  balance: number;
  active: boolean;
};

const mockDbState: {
  company: Record<string, unknown>;
  chartRows: ChartRow[];
} = {
  company: {},
  chartRows: [],
};

function resetMockDb(company: Record<string, unknown> = {}) {
  mockDbState.company = {
    id: 'co-1',
    name: 'Test Co',
    businessType: 'corporation',
    industry: null,
    currency: 'CAD',
    enabledCurrencies: ['CAD'],
    fiscalYearStart: new Date('2026-01-01T00:00:00.000Z'),
    firstFiscalYearEnd: null,
    ...company,
  };
  mockDbState.chartRows = [];
}

const mockDb: any = {
  company: {
    findUnique: jest.fn(async () => ({ ...mockDbState.company })),
    update: jest.fn(async ({ data }: any) => {
      Object.assign(mockDbState.company, data);
      return { ...mockDbState.company };
    }),
    create: jest.fn(async ({ data }: any) => {
      mockDbState.company = { id: 'co-new', ...data };
      return { ...mockDbState.company };
    }),
  },
  chartOfAccount: {
    findMany: jest.fn(async (args: any) => {
      if (args?.where?.code?.in) {
        const wanted = new Set<string>(args.where.code.in);
        return mockDbState.chartRows.filter((r) => wanted.has(r.code)).map((r) => ({ code: r.code }));
      }
      // name-collision guard query: active accounts only
      return mockDbState.chartRows.filter((r) => r.active).map((r) => ({ name: r.name }));
    }),
    createMany: jest.fn(async ({ data }: any) => {
      let count = 0;
      for (const row of data as ChartRow[]) {
        if (mockDbState.chartRows.some((r) => r.code === row.code)) continue; // skipDuplicates
        mockDbState.chartRows.push({ ...row });
        count += 1;
      }
      return { count };
    }),
  },
  membership: { create: jest.fn(async () => ({})) },
  subscription: { create: jest.fn(async () => ({})) },
  plan: { findFirst: jest.fn(async () => ({ id: 'plan-free' })) },
  journalEntry: { count: jest.fn(async () => 0) },
  invoice: { count: jest.fn(async () => 0) },
  bill: { count: jest.fn(async () => 0) },
};

const PACK_KEYS = Object.keys(INDUSTRY_PACKS) as IndustryKey[];

// ── Composition ─────────────────────────────────────────────────────

describe('industry packs — composition (CORE + PACK)', () => {
  test('the design specifies 12 packs plus general, each pack 10–25 accounts', () => {
    expect(INDUSTRY_OPTIONS).toHaveLength(13);
    expect(PACK_KEYS).toHaveLength(12);
    for (const key of PACK_KEYS) {
      const pack = INDUSTRY_PACKS[key]!;
      expect(pack.length).toBeGreaterThanOrEqual(10);
      expect(pack.length).toBeLessThanOrEqual(25);
    }
  });

  test.each(['sole_proprietor', 'corporation'])(
    'CORE + pack has no duplicate GL codes and no pack/CORE overlap (%s)',
    (businessType) => {
      const core = chartTemplateForBusinessType(businessType);
      const coreCodes = new Set(core.map((a) => a.code));
      for (const key of PACK_KEYS) {
        const pack = industryPackAccounts(key);
        for (const account of pack) {
          expect(coreCodes.has(account.code)).toBe(false);
        }
        const composed = chartTemplateForCompany(businessType, key);
        expect(composed).toHaveLength(core.length + pack.length);
        expect(new Set(composed.map((a) => a.code)).size).toBe(composed.length);
        // CORE is a prefix of the composition, in order, unchanged.
        expect(composed.slice(0, core.length)).toEqual(core);
      }
    },
  );

  test('no industry / general / unknown industry returns CORE itself', () => {
    for (const businessType of ['sole_proprietor', 'corporation'] as const) {
      const core = chartTemplateForBusinessType(businessType);
      expect(chartTemplateForCompany(businessType, null)).toBe(core);
      expect(chartTemplateForCompany(businessType, undefined)).toBe(core);
      expect(chartTemplateForCompany(businessType, 'general')).toBe(core);
      expect(chartTemplateForCompany(businessType, 'not-a-real-industry')).toBe(core);
    }
  });

  test('add-on packs layer on top of a primary pack without duplicates', () => {
    const composed = chartTemplateForCompany('corporation', 'professional_services', ['rental', 'usd']);
    const codes = composed.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('4290'); // rental add-on
    expect(codes).toContain('1370'); // usd add-on
    expect(codes).toContain('4150'); // primary pack
  });
});

describe('industry packs — GIFI coding', () => {
  test('every pack account is born coded with a pickable catalogue code', () => {
    for (const key of PACK_KEYS) {
      for (const account of INDUSTRY_PACKS[key]!) {
        expect(account.gifiCode).toBeDefined();
        expect(isPickableGifiCode(account.gifiCode!)).toBe(true);
      }
    }
    for (const pack of Object.values(ADDON_PACKS)) {
      for (const account of pack) {
        expect(account.gifiCode).toBeDefined();
        expect(isPickableGifiCode(account.gifiCode!)).toBe(true);
      }
    }
  });

  test('every CORE account code is pickable too (regression guard)', () => {
    for (const account of [...DEFAULT_CHART_OF_ACCOUNTS, ...CORPORATION_CHART_OF_ACCOUNTS]) {
      if (account.gifiCode) expect(isPickableGifiCode(account.gifiCode)).toBe(true);
    }
  });

  test('design-named pack accounts carry the design GIFI codes', () => {
    const byKeyCode = (key: IndustryKey, code: string) =>
      INDUSTRY_PACKS[key]!.find((a) => a.code === code);
    expect(byKeyCode('construction', '1250')?.gifiCode).toBe('1068'); // holdbacks receivable
    expect(byKeyCode('construction', '2530')?.gifiCode).toBe('2620'); // holdbacks payable
    expect(byKeyCode('real_estate_rental', '4290')?.gifiCode).toBe('8141'); // rental revenue
    expect(byKeyCode('farming', '4430')?.gifiCode).toBe('9371'); // wheat (9370 family)
    expect(byKeyCode('farming', '7340')?.gifiCode).toBe('9662'); // fertilizer (9790-family block)
    expect(byKeyCode('holding', '4500')?.gifiCode).toBe('8096'); // dividends, Canadian
    expect(byKeyCode('holding', '4510')?.gifiCode).toBe('8097'); // dividends, foreign
    expect(byKeyCode('holding', '4530')?.gifiCode).toBe('8094'); // interest, other Canadian
    expect(byKeyCode('ecommerce', '4380')?.gifiCode).toBe('8000'); // jurisdiction split, one code
    expect(byKeyCode('ecommerce', '4400')?.gifiCode).toBe('8000');
    expect(byKeyCode('ecommerce', '4410')?.gifiCode).toBe('8000');
  });

  test('the deliberately-uncoded CORE exemptions stay uncoded; packs contain none of them', () => {
    const uncodedDefault = DEFAULT_CHART_OF_ACCOUNTS.filter((a) => !a.gifiCode).map((a) => a.code).sort();
    expect(uncodedDefault).toEqual(['3000', '3100', '3900', '3950', '6990']);
    const uncodedCorp = CORPORATION_CHART_OF_ACCOUNTS.filter((a) => !a.gifiCode).map((a) => a.code).sort();
    expect(uncodedCorp).toEqual(['3100', '3950', '6990']);
    const exemptNames = new Set(['retained earnings', 'opening balance equity', "owner's capital", "owner's draw"]);
    for (const key of PACK_KEYS) {
      for (const account of INDUSTRY_PACKS[key]!) {
        expect(exemptNames.has(account.name.trim().toLowerCase())).toBe(false);
      }
    }
  });

  test('one GL code = one account across every pack and add-on', () => {
    const seen = new Map<string, { name: string; gifiCode?: string }>();
    const all = [
      ...PACK_KEYS.flatMap((k) => INDUSTRY_PACKS[k]!),
      ...Object.values(ADDON_PACKS).flat(),
    ];
    for (const account of all) {
      const prior = seen.get(account.code);
      if (prior) {
        expect(prior.name).toBe(account.name);
        expect(prior.gifiCode).toBe(account.gifiCode);
      } else {
        seen.set(account.code, { name: account.name, gifiCode: account.gifiCode });
      }
    }
  });
});

// ── Industry value handling ─────────────────────────────────────────

describe('industry value normalization', () => {
  test('canonical keys, legacy aliases, case and whitespace', () => {
    expect(normalizeIndustry('construction')).toBe('construction');
    expect(normalizeIndustry(' Construction ')).toBe('construction');
    expect(normalizeIndustry('technology')).toBe('it_software');
    expect(normalizeIndustry('professional')).toBe('professional_services');
    expect(normalizeIndustry('realestate')).toBe('real_estate_rental');
    expect(normalizeIndustry('general')).toBe('general');
  });

  test('empty and unknown values', () => {
    expect(normalizeIndustry('')).toBeNull();
    expect(normalizeIndustry(null)).toBeNull();
    expect(normalizeIndustry(undefined)).toBeNull();
    expect(normalizeIndustry('underwater basket weaving')).toBeNull();
    expect(isKnownIndustryValue('')).toBe(true);
    expect(isKnownIndustryValue(null)).toBe(true);
    expect(isKnownIndustryValue('farming')).toBe(true);
    expect(isKnownIndustryValue('underwater basket weaving')).toBe(false);
    expect(isKnownIndustryValue(42)).toBe(false);
  });
});

// ── Provisioning ────────────────────────────────────────────────────

describe('ensureDefaultChartOfAccounts — industry provisioning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockDb();
  });

  test('no industry: creates exactly today\u2019s chart (regression)', async () => {
    const { created } = await ensureDefaultChartOfAccounts('co-1', mockDb, 'corporation');
    const expected = CORPORATION_CHART_OF_ACCOUNTS.map((a) => a.code).sort();
    expect(mockDbState.chartRows.map((r) => r.code).sort()).toEqual(expected);
    expect(created).toBe(CORPORATION_CHART_OF_ACCOUNTS.length);

    const again = await ensureDefaultChartOfAccounts('co-1', mockDb, 'corporation');
    expect(again.created).toBe(0);
  });

  test('industry layers the pack on CORE, born coded, idempotently', async () => {
    const first = await ensureDefaultChartOfAccounts('co-1', mockDb, 'corporation', 'construction');
    const expectedCount = CORPORATION_CHART_OF_ACCOUNTS.length + INDUSTRY_PACKS.construction!.length;
    expect(first.created).toBe(expectedCount);
    expect(mockDbState.chartRows).toHaveLength(expectedCount);

    const holdbacks = mockDbState.chartRows.find((r) => r.code === '1250');
    expect(holdbacks?.name).toBe('Holdbacks Receivable');
    expect(holdbacks?.gifiCode).toBe('1068');
    const holdbacksPayable = mockDbState.chartRows.find((r) => r.code === '2530');
    expect(holdbacksPayable?.gifiCode).toBe('2620');

    const second = await ensureDefaultChartOfAccounts('co-1', mockDb, 'corporation', 'construction');
    expect(second.created).toBe(0);
    expect(mockDbState.chartRows).toHaveLength(expectedCount);
  });

  test('industry resolves from the company row when the caller does not pass it', async () => {
    resetMockDb({ businessType: 'corporation', industry: 'retail' });
    await ensureDefaultChartOfAccounts('co-1', mockDb);
    const codes = mockDbState.chartRows.map((r) => r.code);
    expect(codes).toContain('1130'); // retail inventory
    expect(codes).toContain('2470'); // gift cards
    expect(codes).toHaveLength(CORPORATION_CHART_OF_ACCOUNTS.length + INDUSTRY_PACKS.retail!.length);
  });

  test('the name-collision guard covers pack accounts too', async () => {
    // A company that already has an account NAMED like the pack's
    // inventory account under a different code (e.g. from a TB import)
    // must not get a second one from the pack.
    mockDbState.chartRows.push({
      companyId: 'co-1', code: '1135', name: 'Inventory — Goods for Sale', type: 'asset',
      subType: 'current_asset', detailType: 'Inventory', parentCode: null,
      description: null, gifiCode: '1121', balance: 0, active: true,
    });
    await ensureDefaultChartOfAccounts('co-1', mockDb, 'corporation', 'retail');
    expect(mockDbState.chartRows.filter((r) => r.name === 'Inventory — Goods for Sale')).toHaveLength(1);
    expect(mockDbState.chartRows.some((r) => r.code === '1130')).toBe(false);
  });
});

// ── Company creation wiring ─────────────────────────────────────────

describe('createCompanyForUser — industry wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockDb();
  });

  test('stores the industry and seeds CORE + pack', async () => {
    const company = await createCompanyForUser(mockDb, 'user-1', 'Haul Co', 'corporation', 'trucking');
    expect(company.industry).toBe('trucking');
    const codes = mockDbState.chartRows.map((r) => r.code);
    expect(codes).toContain('1630'); // tractors & trucks
    expect(codes).toHaveLength(CORPORATION_CHART_OF_ACCOUNTS.length + INDUSTRY_PACKS.trucking!.length);
  });

  test('no industry: nothing stored, CORE only (today\u2019s behaviour)', async () => {
    const company = await createCompanyForUser(mockDb, 'user-1', 'Plain Co', 'corporation');
    expect('industry' in company).toBe(false);
    expect(mockDbState.chartRows).toHaveLength(CORPORATION_CHART_OF_ACCOUNTS.length);
  });

  test('an unknown industry is dropped, never stored', async () => {
    const company = await createCompanyForUser(mockDb, 'user-1', 'Odd Co', 'corporation', 'bogus');
    expect('industry' in company).toBe(false);
    expect(mockDbState.chartRows).toHaveLength(CORPORATION_CHART_OF_ACCOUNTS.length);
  });
});

// ── Onboarding API wiring (PUT /api/companies) ──────────────────────

describe('PUT /api/companies — industry wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockDb();
    mockRequireCompany.mockResolvedValue({ companyId: 'co-1', userId: 'user-1', error: null });
    mockAuditLog.mockResolvedValue(undefined);
  });

  function put(body: Record<string, unknown>) {
    return PUT(new NextRequest('http://localhost/api/companies', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
  }

  test('stores the industry and layers the pack onto the existing CORE chart', async () => {
    // Simulate the chart seeded at registration (CORE only).
    await ensureDefaultChartOfAccounts('co-1', mockDb, 'corporation');
    const coreCount = mockDbState.chartRows.length;

    const res = await put({ industry: 'construction', onboardingComplete: false });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.industry).toBe('construction');
    expect(mockDbState.company.industry).toBe('construction');
    expect(mockDbState.chartRows).toHaveLength(coreCount + INDUSTRY_PACKS.construction!.length);
    expect(mockDbState.chartRows.some((r) => r.code === '1250' && r.gifiCode === '1068')).toBe(true);
  });

  test('re-saving the same industry adds nothing twice', async () => {
    await put({ industry: 'retail' });
    const count = mockDbState.chartRows.length;
    const res = await put({ industry: 'retail' });
    expect(res.status).toBe(200);
    expect(mockDbState.chartRows).toHaveLength(count);
  });

  test('a legacy dropdown value is stored as its canonical pack key', async () => {
    const res = await put({ industry: 'technology' });
    expect(res.status).toBe(200);
    expect(mockDbState.company.industry).toBe('it_software');
    expect(mockDbState.chartRows.some((r) => r.code === '2460')).toBe(true); // deferred revenue
  });

  test('an unknown industry is refused with 400 and stores nothing', async () => {
    const res = await put({ industry: 'underwater basket weaving' });
    expect(res.status).toBe(400);
    expect(mockDbState.company.industry).toBeNull();
    expect(mockDbState.chartRows).toHaveLength(0);
  });

  test('a save without industry leaves the stored value and chart untouched', async () => {
    resetMockDb({ industry: 'farming' });
    const res = await put({ name: 'Renamed Co' });
    expect(res.status).toBe(200);
    expect(mockDbState.company.industry).toBe('farming');
    expect(mockDbState.chartRows).toHaveLength(0);
  });

  test('clearing the industry stores null and removes nothing from the chart', async () => {
    await put({ industry: 'retail' });
    const count = mockDbState.chartRows.length;
    const res = await put({ industry: null });
    expect(res.status).toBe(200);
    expect(mockDbState.company.industry).toBeNull();
    expect(mockDbState.chartRows).toHaveLength(count);
  });
});

// ── Schema + migration ──────────────────────────────────────────────

describe('schema and migration', () => {
  test('Company carries the industry column and the additive migration exists', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const companyModel = schema.slice(schema.indexOf('model Company {'), schema.indexOf('model CompanyTaxConfiguration'));
    expect(companyModel).toMatch(/industry\s+String\?/);

    const sql = fs.readFileSync(
      path.join(process.cwd(), 'prisma/migrations/20261120150000_company_industry/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('ALTER TABLE "Company" ADD COLUMN "industry" TEXT;');
    // Same destructive patterns as scripts/check-migration-safety.mjs.
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
  });
});
