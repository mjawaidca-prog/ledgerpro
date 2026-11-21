/**
 * Industry re-detection (LedgerPro improvement plan, Phase 2 item 5).
 *
 * Pins:
 *  - the pure scoring engine detects trucking / construction /
 *    real-estate rental / farming from synthetic activity profiles
 *    built the way real books look (CORE chart + the accounts and
 *    payees the business actually uses);
 *  - a generic professional-services profile suggests NOTHING (the
 *    threshold is conservative), and neither do thin data, weak
 *    signals, or a close two-industry race;
 *  - the service layer: a dismissed suggestion stays dismissed, a
 *    DIFFERENT detected industry still surfaces, and an already-set
 *    matching industry suggests nothing;
 *  - the API: GET returns the suggestion, POST dismiss persists it,
 *    a bogus industry is a 400;
 *  - Apply goes through the EXISTING PUT /api/companies flow and
 *    layers the pack idempotently (nothing removed, no duplicates).
 */
// The modules under test import the Prisma-backed db module; stub it
// out with a stateful fake — same pattern as industry-templates.test.ts.
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

import { NextRequest } from 'next/server';
import {
  detectIndustry,
  scoreIndustryFit,
  type AccountActivity,
  type IndustryActivityProfile,
  type TextActivity,
} from '@/lib/industry-detect';
import {
  dismissIndustrySuggestion,
  getIndustrySuggestion,
} from '@/lib/industry-suggestion';
import { GET as suggestionGET, POST as suggestionPOST } from '@/app/api/companies/industry-suggestion/route';
import { PUT as companiesPUT } from '@/app/api/companies/route';

// ── Profile helpers (engine tests) ──────────────────────────────────

function acct(partial: Partial<AccountActivity> & { code: string; name: string }): AccountActivity {
  return {
    type: 'expense',
    gifiCode: null,
    balance: 0,
    txCount: 0,
    journalCount: 0,
    ...partial,
  };
}

function texts(rows: [string, number][]): TextActivity[] {
  return rows.map(([text, amount]) => ({ text, amount }));
}

function repeat(row: [string, number], n: number): [string, number][] {
  return Array.from({ length: n }, () => row);
}

function profile(partial: Partial<IndustryActivityProfile>): IndustryActivityProfile {
  return {
    accounts: [],
    expenseTexts: [],
    incomeTexts: [],
    totalExpenseAmount: 0,
    totalIncomeAmount: 0,
    activityCount: 100,
    ...partial,
  };
}

const TRUCKING_PROFILE = profile({
  accounts: [
    acct({ code: '1010', name: 'Business Chequing', type: 'asset', txCount: 90 }),
    acct({ code: '7185', name: 'Fuel — Trucks', txCount: 40, balance: -30100 }),
    acct({ code: '5290', name: 'Driver Wages', txCount: 24, balance: -61200 }),
    acct({ code: '4100', name: 'Service Revenue', type: 'income', txCount: 30 }),
  ],
  expenseTexts: texts([
    ...repeat(['PETRO-CANADA FUEL', 400], 18),
    ...repeat(['FLYING J DIESEL', 500], 6),
    ...repeat(['OK TIRE STORE', 300], 4),
    ...repeat(['KENWORTH TRUCK CENTRE', 900], 2),
  ]),
  totalExpenseAmount: 13200,
  activityCount: 64,
});

const CONSTRUCTION_PROFILE = profile({
  accounts: [
    acct({ code: '1250', name: 'Holdbacks Receivable', type: 'asset', journalCount: 12, balance: 45000 }),
    acct({ code: '2530', name: 'Holdbacks Payable', type: 'liability', journalCount: 9, balance: -21000 }),
    acct({ code: '5185', name: 'Subcontractor Payments', txCount: 20, balance: -88400 }),
    acct({ code: '4100', name: 'Service Revenue', type: 'income', txCount: 15 }),
  ],
  expenseTexts: texts([
    ...repeat(['HOME DEPOT PRO', 600], 8),
    ...repeat(['RONA LUMBER YARD', 800], 3),
    ['WSIB PREMIUM', 400],
  ]),
  totalExpenseAmount: 7600,
  activityCount: 60,
});

const RENTAL_PROFILE = profile({
  accounts: [
    acct({ code: '4290', name: 'Rental Revenue', type: 'income', txCount: 12, balance: 96000 }),
    acct({ code: '2565', name: 'Tenant Deposits Received', type: 'liability', txCount: 6, balance: -6600 }),
    acct({ code: '6300', name: 'Rent & Lease', txCount: 0 }),
  ],
  incomeTexts: texts([
    ...repeat(['Rent — Unit 4, 123 Main St', 2200], 12),
    ...repeat(['Parking income', 150], 2),
  ]),
  totalIncomeAmount: 26700,
  activityCount: 44,
});

const FARMING_PROFILE = profile({
  accounts: [
    acct({ code: '7395', name: 'Feed & Supplements', txCount: 18, balance: -22100 }),
    acct({ code: '7355', name: 'Fertilizer', txCount: 8, balance: -31400 }),
    acct({ code: '9911', name: 'Feed Purchases', gifiCode: '9711', txCount: 10, balance: -9800 }),
    acct({ code: '4000', name: 'Product Sales', type: 'income', txCount: 9 }),
  ],
  expenseTexts: texts([
    ...repeat(['CO-OP FEED MILL', 1200], 6),
    ...repeat(['FERTILIZER — NUTRIEN', 2000], 4),
    ...repeat(['VETERINARY CLINIC', 350], 3),
  ]),
  incomeTexts: texts([
    ...repeat(['GRAIN ELEVATOR — WHEAT', 15000], 3),
    ...repeat(['CATTLE AUCTION', 8000], 2),
  ]),
  totalExpenseAmount: 16250,
  totalIncomeAmount: 61000,
  activityCount: 54,
});

const GENERIC_PROFESSIONAL_PROFILE = profile({
  accounts: [
    acct({ code: '4100', name: 'Service Revenue', type: 'income', txCount: 30, balance: 148000 }),
    acct({ code: '6200', name: 'Professional Fees', txCount: 5 }),
    acct({ code: '6300', name: 'Rent & Lease', txCount: 12 }),
    acct({ code: '6100', name: 'Software & Subscriptions', txCount: 9 }),
    acct({ code: '6800', name: 'Office Supplies', txCount: 7 }),
  ],
  incomeTexts: texts([
    ...repeat(['Consulting retainer — monthly', 5000], 10),
    ...repeat(['Advisory services', 2500], 4),
  ]),
  expenseTexts: texts([
    ...repeat(['Office rent', 2000], 12),
    ...repeat(['FIGMA SUBSCRIPTION', 60], 9),
    ...repeat(['Staples office supplies', 120], 5),
  ]),
  totalExpenseAmount: 25140,
  totalIncomeAmount: 60000,
  activityCount: 63,
});

// ── Engine: detection ───────────────────────────────────────────────

describe('industry detection — synthetic profiles', () => {
  test('a trucking business is detected as trucking', () => {
    const result = detectIndustry(TRUCKING_PROFILE, null);
    expect(result?.industry).toBe('trucking');
    expect(result!.score).toBeGreaterThanOrEqual(0.45);
    expect(result!.evidence.join(' ')).toMatch(/Fuel/);
    expect(scoreIndustryFit(TRUCKING_PROFILE)[0].industry).toBe('trucking');
  });

  test('a construction business is detected from holdbacks activity', () => {
    const result = detectIndustry(CONSTRUCTION_PROFILE, 'general');
    expect(result?.industry).toBe('construction');
    expect(result!.evidence.join(' ')).toMatch(/Holdbacks receivable/);
  });

  test('a rental business is detected from rental revenue and rent share', () => {
    const result = detectIndustry(RENTAL_PROFILE, null);
    expect(result?.industry).toBe('real_estate_rental');
    expect(result!.evidence.join(' ')).toMatch(/Rent is \d+% of income/);
  });

  test('a farming business is detected from farm accounts and inputs', () => {
    const result = detectIndustry(FARMING_PROFILE, null);
    expect(result?.industry).toBe('farming');
  });

  test('detection also fires when a different industry is currently set', () => {
    expect(detectIndustry(TRUCKING_PROFILE, 'retail')?.industry).toBe('trucking');
  });

  test('no suggestion when the detected industry is already set', () => {
    expect(detectIndustry(TRUCKING_PROFILE, 'trucking')).toBeNull();
    expect(detectIndustry(FARMING_PROFILE, 'farming')).toBeNull();
  });
});

// ── Engine: conservative thresholds ─────────────────────────────────

describe('industry detection — thresholds', () => {
  test('a generic professional-services profile suggests nothing', () => {
    expect(detectIndustry(GENERIC_PROFESSIONAL_PROFILE, null)).toBeNull();
    const scores = scoreIndustryFit(GENERIC_PROFESSIONAL_PROFILE);
    expect(Math.max(...scores.map((s) => s.score))).toBeLessThan(0.45);
  });

  test('thin data suggests nothing, however strong the signals', () => {
    const sparse = { ...TRUCKING_PROFILE, activityCount: 12 };
    expect(detectIndustry(sparse, null)).toBeNull();
  });

  test('one strong signal alone is not enough', () => {
    const fuelOnly = profile({
      expenseTexts: texts(repeat(['PETRO-CANADA FUEL', 400], 25)),
      totalExpenseAmount: 10000,
      activityCount: 25,
    });
    expect(detectIndustry(fuelOnly, null)).toBeNull();
  });

  test('a close race between two industries suggests nothing', () => {
    const mixed = profile({
      accounts: [
        acct({ code: '2470', name: 'Gift Cards Outstanding', type: 'liability', txCount: 5 }),
        acct({ code: '1130', name: 'Inventory — Goods for Sale', type: 'asset', gifiCode: '1121', txCount: 8 }),
        acct({ code: '4380', name: 'Online Sales — Canada', type: 'income', txCount: 20 }),
      ],
      expenseTexts: texts([
        ...repeat(['AMAZON MARKETPLACE', 200], 4),
        ...repeat(['SHOPIFY', 150], 4),
        ...repeat(['CANADA POST SHIPPING', 90], 4),
        ...repeat(['SQUARE', 75], 2),
      ]),
      totalExpenseAmount: 1910,
      activityCount: 47,
    });
    const scores = scoreIndustryFit(mixed);
    // Both retail and ecommerce clear the score bar — the margin rule
    // is what stays silent.
    expect(scores[0].score).toBeGreaterThanOrEqual(0.45);
    expect(scores[0].score - scores[1].score).toBeLessThan(0.1);
    expect(detectIndustry(mixed, null)).toBeNull();
  });
});

// ── Stateful fake db (service + route + apply tests) ────────────────

type FakeChartRow = {
  id: string; companyId: string; code: string; name: string; type: string;
  subType: string | null; detailType: string | null; parentCode: string | null;
  description: string | null; gifiCode: string | null; balance: number; active: boolean;
};
type FakeTxRow = {
  categoryId: string | null; amount: number; description: string;
  merchant: string | null; payeeGuess: string | null; status: string;
};

const mockDbState: {
  company: Record<string, any>;
  chartRows: FakeChartRow[];
  txRows: FakeTxRow[];
  journalLineRows: { glAccountCode: string }[];
} = { company: {}, chartRows: [], txRows: [], journalLineRows: [] };

let rowSeq = 0;
function chartRow(partial: Partial<FakeChartRow> & { code: string; name: string }): FakeChartRow {
  rowSeq += 1;
  return {
    id: `acct-${rowSeq}`,
    companyId: 'co-1',
    type: 'expense',
    subType: null,
    detailType: null,
    parentCode: null,
    description: null,
    gifiCode: null,
    balance: 0,
    active: true,
    ...partial,
  };
}

function seedTruckingBooks() {
  mockDbState.chartRows = [
    chartRow({ code: '1010', name: 'Business Chequing', type: 'asset' }),
    chartRow({ code: '4100', name: 'Service Revenue', type: 'income' }),
    chartRow({ code: '7185', name: 'Fuel — Trucks' }),
    chartRow({ code: '5290', name: 'Driver Wages' }),
  ];
  const fuelId = mockDbState.chartRows[2].id;
  const driverId = mockDbState.chartRows[3].id;
  mockDbState.txRows = [
    ...Array.from({ length: 18 }, () => ({ categoryId: fuelId, amount: -400, description: 'PETRO-CANADA FUEL', merchant: null, payeeGuess: null, status: 'categorized' })),
    ...Array.from({ length: 6 }, () => ({ categoryId: fuelId, amount: -500, description: 'FLYING J DIESEL', merchant: null, payeeGuess: null, status: 'categorized' })),
    ...Array.from({ length: 4 }, () => ({ categoryId: driverId, amount: -300, description: 'OK TIRE STORE', merchant: null, payeeGuess: null, status: 'categorized' })),
    ...Array.from({ length: 2 }, () => ({ categoryId: driverId, amount: -900, description: 'KENWORTH TRUCK CENTRE', merchant: null, payeeGuess: null, status: 'categorized' })),
  ];
  mockDbState.journalLineRows = [];
}

function seedConstructionBooks() {
  mockDbState.chartRows = [
    chartRow({ code: '1250', name: 'Holdbacks Receivable', type: 'asset', balance: 45000 }),
    chartRow({ code: '2530', name: 'Holdbacks Payable', type: 'liability', balance: -21000 }),
    chartRow({ code: '5185', name: 'Subcontractor Payments' }),
    chartRow({ code: '4100', name: 'Service Revenue', type: 'income' }),
  ];
  const subId = mockDbState.chartRows[2].id;
  mockDbState.txRows = [
    ...Array.from({ length: 8 }, () => ({ categoryId: subId, amount: -600, description: 'HOME DEPOT PRO', merchant: null, payeeGuess: null, status: 'categorized' })),
    ...Array.from({ length: 3 }, () => ({ categoryId: subId, amount: -800, description: 'RONA LUMBER YARD', merchant: null, payeeGuess: null, status: 'categorized' })),
    { categoryId: subId, amount: -400, description: 'WSIB PREMIUM', merchant: null, payeeGuess: null, status: 'categorized' },
  ];
  mockDbState.journalLineRows = [
    ...Array.from({ length: 12 }, () => ({ glAccountCode: '1250' })),
    ...Array.from({ length: 9 }, () => ({ glAccountCode: '2530' })),
    ...Array.from({ length: 20 }, () => ({ glAccountCode: '5185' })),
  ];
}

function resetMockDb(company: Record<string, any> = {}) {
  mockDbState.company = {
    id: 'co-1',
    name: 'Test Co',
    businessType: 'corporation',
    industry: null,
    industrySuggestionDismissedKey: null,
    currency: 'CAD',
    enabledCurrencies: ['CAD'],
    fiscalYearStart: new Date('2026-01-01T00:00:00.000Z'),
    firstFiscalYearEnd: null,
    ...company,
  };
  mockDbState.chartRows = [];
  mockDbState.txRows = [];
  mockDbState.journalLineRows = [];
}

const mockDb: any = {
  company: {
    findUnique: jest.fn(async () => ({ ...mockDbState.company })),
    update: jest.fn(async ({ data }: any) => {
      Object.assign(mockDbState.company, data);
      return { ...mockDbState.company };
    }),
  },
  chartOfAccount: {
    findMany: jest.fn(async (args: any) => {
      if (args?.select?.id) return mockDbState.chartRows.filter((r) => r.active);
      if (args?.where?.code?.in) {
        const wanted = new Set<string>(args.where.code.in);
        return mockDbState.chartRows.filter((r) => wanted.has(r.code)).map((r) => ({ code: r.code }));
      }
      return mockDbState.chartRows.filter((r) => r.active).map((r) => ({ name: r.name }));
    }),
    createMany: jest.fn(async ({ data }: any) => {
      let count = 0;
      for (const row of data) {
        if (mockDbState.chartRows.some((r) => r.code === row.code)) continue;
        mockDbState.chartRows.push(chartRow({ ...row }));
        count += 1;
      }
      return { count };
    }),
  },
  transaction: {
    findMany: jest.fn(async () => mockDbState.txRows),
  },
  journalLine: {
    findMany: jest.fn(async () => mockDbState.journalLineRows),
  },
  journalEntry: { count: jest.fn(async () => 0) },
  invoice: { count: jest.fn(async () => 0) },
  bill: { count: jest.fn(async () => 0) },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireCompany.mockResolvedValue({ companyId: 'co-1', userId: 'user-1', error: null });
  resetMockDb();
});

// ── Service: suggestion rules ───────────────────────────────────────

describe('industry suggestion service', () => {
  test('suggests the detected industry for a company with none set', async () => {
    seedTruckingBooks();
    const suggestion = await getIndustrySuggestion('co-1', mockDb);
    expect(suggestion?.industry).toBe('trucking');
    expect(suggestion?.currentIndustry).toBeNull();
    expect(suggestion!.confidencePct).toBeGreaterThanOrEqual(45);
    expect(suggestion!.evidence.length).toBeGreaterThan(0);
  });

  test('no suggestion when the industry already matches the books', async () => {
    resetMockDb({ industry: 'trucking' });
    seedTruckingBooks();
    expect(await getIndustrySuggestion('co-1', mockDb)).toBeNull();
  });

  test('a dismissed suggestion stays dismissed', async () => {
    seedTruckingBooks();
    await dismissIndustrySuggestion('co-1', 'trucking', mockDb);
    expect(mockDbState.company.industrySuggestionDismissedKey).toBe('trucking');
    expect(await getIndustrySuggestion('co-1', mockDb)).toBeNull();
  });

  test('a different detected industry still surfaces after a dismissal', async () => {
    resetMockDb({ industrySuggestionDismissedKey: 'trucking' });
    seedConstructionBooks();
    const suggestion = await getIndustrySuggestion('co-1', mockDb);
    expect(suggestion?.industry).toBe('construction');
  });

  test('dismissing an unknown industry is rejected', async () => {
    await expect(dismissIndustrySuggestion('co-1', 'bogus', mockDb)).rejects.toThrow(/Unknown industry/);
  });
});

// ── Routes ──────────────────────────────────────────────────────────

function jsonRequest(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/companies/industry-suggestion', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('industry suggestion routes', () => {
  test('GET returns the suggestion payload', async () => {
    seedTruckingBooks();
    const res = await suggestionGET(jsonRequest('GET'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.industry).toBe('trucking');
    expect(json.data.label).toBe('Trucking & transport');
  });

  test('POST dismiss persists the key and silences the suggestion', async () => {
    seedTruckingBooks();
    const res = await suggestionPOST(jsonRequest('POST', { industry: 'trucking' }));
    expect(res.status).toBe(200);
    expect(mockDbState.company.industrySuggestionDismissedKey).toBe('trucking');

    const after = await suggestionGET(jsonRequest('GET'));
    expect((await after.json()).data).toBeNull();
  });

  test('POST with an unknown industry is a 400 and stores nothing', async () => {
    const res = await suggestionPOST(jsonRequest('POST', { industry: 'bogus' }));
    expect(res.status).toBe(400);
    expect(mockDbState.company.industrySuggestionDismissedKey).toBeNull();
  });
});

// ── Apply: the existing PUT /api/companies layering flow ────────────

describe('apply path — PUT /api/companies layers the suggested pack', () => {
  test('applying the suggestion stores the industry and layers the pack, idempotently', async () => {
    seedTruckingBooks();
    const suggestion = await getIndustrySuggestion('co-1', mockDb);
    expect(suggestion?.industry).toBe('trucking');

    const codesBefore = mockDbState.chartRows.map((r) => r.code);
    const putReq = new NextRequest('http://localhost/api/companies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry: suggestion!.industry }),
    });
    const res = await companiesPUT(putReq);
    expect(res.status).toBe(200);
    expect(mockDbState.company.industry).toBe('trucking');

    const codesAfter = mockDbState.chartRows.map((r) => r.code);
    // Trucking pack accounts were layered on (e.g. Fuel — Fleet 7180,
    // Freight & Hauling Revenue 4330)…
    expect(codesAfter).toContain('7180');
    expect(codesAfter).toContain('4330');
    // …nothing pre-existing was removed…
    for (const code of codesBefore) expect(codesAfter).toContain(code);
    // …and there are no duplicate codes.
    expect(new Set(codesAfter).size).toBe(codesAfter.length);

    // After applying, the suggestion is gone (industry now matches).
    expect(await getIndustrySuggestion('co-1', mockDb)).toBeNull();
  });
});
