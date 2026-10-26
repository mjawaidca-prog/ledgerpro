/**
 * Phase 0 (P0-7/P0-8) — chart template hygiene.
 *
 * Live findings: code 3900 meant "Owner's Draw" in the chart template
 * but the opening-balance route created/used it as "Opening Balance
 * Equity"; and Muja's live chart carried duplicate-name accounts
 * (5300 Insurance next to 6910 Insurance, 5600 Bank Charges & Interest
 * next to 6900 Bank Fees). The shipped template itself holds exactly one
 * of each name — the guard below stops template re-runs from minting a
 * second account with a name the company already has under another code.
 */
// default-coa imports the Prisma-backed db module; the unit under test
// takes an injectable client, so stub db out (Prisma client is not
// generated in this sandbox).
jest.mock('@/lib/db', () => ({ db: {} }));

import { DEFAULT_CHART_OF_ACCOUNTS, ensureDefaultChartOfAccounts } from '@/lib/default-coa';

function fakeClient(existingCodes: string[], existingNames: string[]) {
  const created: any[] = [];
  const client = {
    chartOfAccount: {
      findMany: jest.fn(async (args: any) => {
        if (args?.where?.code?.in) {
          return existingCodes.map((code) => ({ code }));
        }
        return existingNames.map((name) => ({ name }));
      }),
      createMany: jest.fn(async ({ data }: any) => {
        created.push(...data);
        return { count: data.length };
      }),
    },
  };
  return { client: client as any, created };
}

describe('Phase 0 — default chart template', () => {
  test('3900 is Owner\'s Draw and Opening Balance Equity has its own code 3950', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a.name]));
    expect(byCode.get('3900')).toBe("Owner's Draw");
    expect(byCode.get('3950')).toBe('Opening Balance Equity');
  });

  test('template contains exactly one Insurance and one Bank Fees account', () => {
    const names = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.name);
    expect(names.filter((n) => n === 'Insurance')).toHaveLength(1);
    expect(names.filter((n) => n === 'Bank Fees')).toHaveLength(1);
  });

  test('fresh company gets the full template including 3950', async () => {
    const { client, created } = fakeClient([], []);
    const res = await ensureDefaultChartOfAccounts('co-new', client);
    expect(res.created).toBe(DEFAULT_CHART_OF_ACCOUNTS.length);
    expect(created.some((a) => a.code === '3950' && a.name === 'Opening Balance Equity')).toBe(true);
    expect(created.filter((a) => a.name === 'Insurance')).toHaveLength(1);
  });

  test('a company that already has "Insurance" under code 5300 does not get a second Insurance at 6910', async () => {
    const { client, created } = fakeClient([], ['Insurance', 'Bank Fees']);
    await ensureDefaultChartOfAccounts('co-muja-like', client);
    expect(created.some((a) => a.name === 'Insurance')).toBe(false);
    expect(created.some((a) => a.name === 'Bank Fees')).toBe(false);
    // unrelated missing accounts are still created
    expect(created.some((a) => a.code === '3950')).toBe(true);
  });

  test('fully templated company creates nothing', async () => {
    const allCodes = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code);
    const allNames = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.name);
    const { client, created } = fakeClient(allCodes, allNames);
    const res = await ensureDefaultChartOfAccounts('co-full', client);
    expect(res.created).toBe(0);
    expect(created).toHaveLength(0);
  });
});
