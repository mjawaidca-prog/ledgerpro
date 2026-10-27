/**
 * Payroll sync L1 — payroll accounts in the default chart template.
 *
 * Adds the granular payroll accounts the Nexvar Pay → LedgerPro sync
 * (Mode 2) maps onto: 2410 CPP Payable, 2420 EI Payable, 2430 Income Tax
 * Payable, 2440 Wages Payable, and Employer Payroll Taxes Expense.
 *
 * CODE NOTE: the scoping doc proposed 6930 for Employer Payroll Taxes
 * Expense, but 6930 is already Repairs & Maintenance in the template and
 * account codes are unique per company (@@unique([companyId, code])) —
 * a second 6930 could never be created for any company. 6940 (the next
 * free expense code) is used instead; these tests pin that decision so
 * the collision cannot be reintroduced silently.
 */
// default-coa imports the Prisma-backed db module; the unit under test
// takes an injectable client, so stub db out (Prisma client is not
// generated in this sandbox) — same pattern as phase0-claims-leaks.test.ts.
jest.mock('@/lib/db', () => ({ db: {} }));

import { DEFAULT_CHART_OF_ACCOUNTS, ensureDefaultChartOfAccounts } from '@/lib/default-coa';

const PAYROLL_ACCOUNTS = [
  { code: '2410', name: 'CPP Payable', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities' },
  { code: '2420', name: 'EI Payable', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities' },
  { code: '2430', name: 'Income Tax Payable', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities' },
  { code: '2440', name: 'Wages Payable', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities' },
  { code: '6940', name: 'Employer Payroll Taxes Expense', type: 'expense', subType: undefined, detailType: 'Payroll expenses' },
] as const;

type Row = {
  companyId: string;
  code: string;
  name: string;
  type: string;
  subType: string | null;
  detailType: string | null;
  parentCode: string | null;
  description: string | null;
  balance: number;
  active: boolean;
};

/**
 * Stateful fake of the ChartOfAccount client slice that
 * ensureDefaultChartOfAccounts() uses. It emulates the real queries:
 *  - the by-code lookup has NO active filter (a deactivated account
 *    still counts as existing and must be left untouched);
 *  - the by-name lookup only sees active accounts;
 *  - createMany with skipDuplicates skips codes the company already has
 *    (the @@unique([companyId, code]) constraint), including duplicates
 *    inside the same batch.
 */
function fakeClient(seed: Partial<Row>[] = []) {
  const rows: Row[] = seed.map((r) => ({
    companyId: 'co-1',
    subType: null,
    detailType: null,
    parentCode: null,
    description: null,
    balance: 0,
    active: true,
    ...r,
  } as Row));
  const createdBatches: any[][] = [];
  const client = {
    chartOfAccount: {
      findMany: jest.fn(async (args: any) => {
        if (args?.where?.code?.in) {
          const wanted = new Set<string>(args.where.code.in);
          return rows.filter((r) => wanted.has(r.code)).map((r) => ({ code: r.code }));
        }
        // name-collision guard query: active accounts only
        return rows.filter((r) => r.active).map((r) => ({ name: r.name }));
      }),
      createMany: jest.fn(async ({ data }: any) => {
        createdBatches.push(data);
        let count = 0;
        for (const row of data as Row[]) {
          if (rows.some((r) => r.code === row.code)) continue; // skipDuplicates
          rows.push({ ...row });
          count += 1;
        }
        return { count };
      }),
    },
  };
  return { client: client as any, rows, createdBatches };
}

describe('L1 — default chart template carries the payroll accounts', () => {
  test('the five new accounts are present with the correct codes, names and types', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));
    for (const expected of PAYROLL_ACCOUNTS) {
      const account = byCode.get(expected.code);
      expect(account).toBeDefined();
      expect(account!.name).toBe(expected.name);
      expect(account!.type).toBe(expected.type);
      expect(account!.subType).toBe(expected.subType);
      expect(account!.detailType).toBe(expected.detailType);
    }
  });

  test('payables match the 2400 Payroll Liabilities conventions; the expense matches 6920', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));
    const umbrella = byCode.get('2400')!;
    for (const code of ['2410', '2420', '2430', '2440']) {
      expect(byCode.get(code)!.type).toBe(umbrella.type);
      expect(byCode.get(code)!.subType).toBe(umbrella.subType);
      expect(byCode.get(code)!.detailType).toBe(umbrella.detailType);
    }
    expect(byCode.get('6940')!.detailType).toBe(byCode.get('6920')!.detailType);
  });

  test('6930 remains Repairs & Maintenance and every template code and name is unique', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));
    expect(byCode.get('6930')!.name).toBe('Repairs & Maintenance');
    const codes = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    const names = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('L1 — ensureDefaultChartOfAccounts backfill', () => {
  test('fresh company receives the five payroll accounts in the created payload shape', async () => {
    const { client, rows } = fakeClient();
    const res = await ensureDefaultChartOfAccounts('co-1', client);
    expect(res.created).toBe(DEFAULT_CHART_OF_ACCOUNTS.length);
    for (const expected of PAYROLL_ACCOUNTS) {
      const row = rows.find((r) => r.code === expected.code);
      expect(row).toMatchObject({
        companyId: 'co-1',
        name: expected.name,
        type: expected.type,
        subType: expected.subType ?? null,
        detailType: expected.detailType,
        balance: 0,
        active: true,
      });
    }
  });

  test('backfill is idempotent by code: running it twice creates each payroll account exactly once', async () => {
    const { client, rows } = fakeClient();
    const first = await ensureDefaultChartOfAccounts('co-1', client);
    expect(first.created).toBe(DEFAULT_CHART_OF_ACCOUNTS.length);
    const second = await ensureDefaultChartOfAccounts('co-1', client);
    expect(second.created).toBe(0);
    expect(rows).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    for (const { code } of PAYROLL_ACCOUNTS) {
      expect(rows.filter((r) => r.code === code)).toHaveLength(1);
    }
    // and a third run still creates nothing
    const third = await ensureDefaultChartOfAccounts('co-1', client);
    expect(third.created).toBe(0);
    expect(rows).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
  });

  test('a company that already has 2410 is not duplicated and its row is not modified', async () => {
    const existing2410 = {
      code: '2410',
      name: 'CPP Payable — employer account',
      type: 'liability',
      subType: 'current_liability',
      detailType: 'Payroll liabilities',
      balance: 125.5,
      active: true,
    };
    const { client, rows, createdBatches } = fakeClient([existing2410]);
    await ensureDefaultChartOfAccounts('co-1', client);
    expect(rows.filter((r) => r.code === '2410')).toHaveLength(1);
    expect(rows.find((r) => r.code === '2410')).toMatchObject(existing2410);
    expect(createdBatches.flat().some((r: any) => r.code === '2410')).toBe(false);
    // the other payroll accounts are still backfilled
    for (const code of ['2420', '2430', '2440', '6940']) {
      expect(rows.filter((r) => r.code === code)).toHaveLength(1);
    }
  });

  test('a DEACTIVATED 2410 is left untouched — not resurrected, renamed or duplicated', async () => {
    const deactivated2410 = {
      code: '2410',
      name: 'CPP Payable',
      type: 'liability',
      subType: 'current_liability',
      detailType: 'Payroll liabilities',
      balance: 0,
      active: false,
    };
    const { client, rows, createdBatches } = fakeClient([deactivated2410]);
    await ensureDefaultChartOfAccounts('co-1', client);
    const matches = rows.filter((r) => r.code === '2410');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject(deactivated2410);
    expect(matches[0].active).toBe(false);
    expect(createdBatches.flat().some((r: any) => r.code === '2410')).toBe(false);
  });

  test('a company with 6930 Repairs & Maintenance still receives Employer Payroll Taxes at 6940', async () => {
    const { client, rows } = fakeClient([
      { code: '6930', name: 'Repairs & Maintenance', type: 'expense', detailType: 'Repairs & maintenance' },
    ]);
    await ensureDefaultChartOfAccounts('co-1', client);
    expect(rows.filter((r) => r.code === '6930')).toHaveLength(1);
    expect(rows.find((r) => r.code === '6930')!.name).toBe('Repairs & Maintenance');
    expect(rows.filter((r) => r.code === '6940' && r.name === 'Employer Payroll Taxes Expense')).toHaveLength(1);
  });
});
