/**
 * Pure-logic tests for the consolidation engine — no DB, no mocks.
 * Mirrors the style of critical-flows.test.ts: arithmetic assertions only.
 *
 * The balance-sheet scenario reproduces the design prototype's sample data
 * (4 entities, 3 due-from/to links, one 780,000 investment) and asserts the
 * exact consolidated figures from the design.
 */

import { mergeEntityLines } from '@/lib/consolidation/merge';
import { deriveEliminations, computeCyeByEntity, computeFctrByEntity } from '@/lib/consolidation/eliminations';
import { reconcileRoundedParts, round2 } from '@/lib/consolidation/rounding';
import { composeBalanceSheet, composeTrialBalance, composeProfitLoss } from '@/lib/consolidation/statements';
import type { EntityLine, ConsolidatedLine, EliminationLink } from '@/lib/consolidation/types';

type L = EntityLine;

function line(
  code: string,
  name: string,
  type: L['type'],
  amount: number,
  extra?: Partial<L>
): L {
  return {
    code,
    name,
    gifiCode: null,
    type,
    subType: null,
    detailType: null,
    isControlAccount: false,
    relatedPartyCompanyId: null,
    amount,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────
// Prototype scenario — Balance Sheet sample
// ─────────────────────────────────────────────────────────────

const NHL = 'nhl';
const NLI = 'nli';
const NLU = 'nlu';
const RBP = 'rbp';

const linesByCompany: Record<string, L[]> = {
  [NHL]: [
    line('1000', 'Cash and equivalents', 'asset', 412880.0),
    line('1100', 'Accounts receivable', 'asset', 186400.0),
    line('1150', 'Due from Nexvar Logistics', 'asset', 180000.0, { isControlAccount: true }),
    line('1152', 'Due from Nexvar Labs USA', 'asset', 60000.0, { isControlAccount: true }),
    line('1400', 'Prepaid expenses', 'asset', 24700.0),
    line('1500', 'Property and equipment, net', 'asset', 96500.0),
    line('1600', 'Investment in subsidiaries', 'asset', 780000.0),
    line('2000', 'Accounts payable', 'liability', 128300.0),
    line('2100', 'Due to Riverbend Properties', 'liability', 60000.0, { isControlAccount: true }),
    line('2200', 'GST/HST payable', 'liability', 18640.0),
    line('2300', 'Accrued liabilities', 'liability', 32000.0),
    line('2500', 'Long-term debt', 'liability', 350000.0),
    line('3000', 'Share capital', 'equity', 500000.0, { subType: 'common_shares' }),
    line('3100', 'Retained earnings', 'equity', 651540.0, { subType: 'retained_earnings' }),
  ],
  [NLI]: [
    line('1000', 'Cash and equivalents', 'asset', 268450.0),
    line('1100', 'Accounts receivable', 'asset', 342900.0),
    line('1200', 'Inventory', 'asset', 415600.0),
    line('1400', 'Prepaid expenses', 'asset', 38200.0),
    line('1500', 'Property and equipment, net', 'asset', 512300.0),
    line('2000', 'Accounts payable', 'liability', 296700.0),
    line('2100', 'Due to Nexvar Holdings', 'liability', 180000.0, { isControlAccount: true }),
    line('2200', 'GST/HST payable', 'liability', 42380.0),
    line('2300', 'Accrued liabilities', 'liability', 58400.0),
    line('2500', 'Long-term debt', 'liability', 240000.0),
    line('3000', 'Share capital', 'equity', 300000.0, { subType: 'common_shares' }),
    line('3100', 'Retained earnings', 'equity', 459970.0, { subType: 'retained_earnings' }),
  ],
  [NLU]: [
    line('1000', 'Cash and equivalents', 'asset', 196320.0),
    line('1100', 'Accounts receivable', 'asset', 128650.0),
    line('1200', 'Inventory', 'asset', 96400.0),
    line('1400', 'Prepaid expenses', 'asset', 12900.0),
    line('1500', 'Property and equipment, net', 'asset', 148900.0),
    line('2000', 'Accounts payable', 'liability', 88450.0),
    line('2100', 'Due to Nexvar Holdings', 'liability', 60000.0, { isControlAccount: true }),
    line('2300', 'Accrued liabilities', 'liability', 21600.0),
    line('2500', 'Long-term debt', 'liability', 60000.0),
    line('3000', 'Share capital', 'equity', 220000.0, { subType: 'common_shares' }),
    line('3100', 'Retained earnings', 'equity', 133120.0, { subType: 'retained_earnings' }),
  ],
  [RBP]: [
    line('1000', 'Cash and equivalents', 'asset', 84110.0),
    line('1100', 'Accounts receivable', 'asset', 22300.0),
    line('1150', 'Due from Nexvar Holdings', 'asset', 60000.0, { isControlAccount: true }),
    line('1400', 'Prepaid expenses', 'asset', 6400.0),
    line('1500', 'Property and equipment, net', 'asset', 1240000.0),
    line('2000', 'Accounts payable', 'liability', 18900.0),
    line('2200', 'GST/HST payable', 'liability', 5120.0),
    line('2300', 'Accrued liabilities', 'liability', 9800.0),
    line('2500', 'Long-term debt', 'liability', 820000.0),
    line('3000', 'Share capital', 'equity', 260000.0, { subType: 'common_shares' }),
    line('3100', 'Retained earnings', 'equity', 298990.0, { subType: 'retained_earnings' }),
  ],
};

const links: EliminationLink[] = [
  {
    id: 'l1', companyAId: NHL, companyBId: NLI,
    aName: 'Nexvar Holdings Ltd.', bName: 'Nexvar Logistics Inc.',
    aOwnershipOfB: 100, bOwnershipOfA: 0,
    aDueFromCode: '1150', aDueToCode: '2199', bDueFromCode: '1199', bDueToCode: '2100',
  },
  {
    id: 'l2', companyAId: NHL, companyBId: NLU,
    aName: 'Nexvar Holdings Ltd.', bName: 'Nexvar Labs USA LLC',
    aOwnershipOfB: 100, bOwnershipOfA: 0,
    aDueFromCode: '1152', aDueToCode: '2198', bDueFromCode: '1198', bDueToCode: '2100',
  },
  {
    id: 'l3', companyAId: RBP, companyBId: NHL,
    aName: 'Riverbend Properties Ltd.', bName: 'Nexvar Holdings Ltd.',
    aOwnershipOfB: 0, bOwnershipOfA: 100,
    aDueFromCode: '1150', aDueToCode: '2197', bDueFromCode: '1197', bDueToCode: '2100',
  },
];

const currencyOf = { [NHL]: 'CAD', [NLI]: 'CAD', [NLU]: 'CAD', [RBP]: 'CAD' };
const selectedIds = [NHL, NLI, NLU, RBP];

function buildMerged(): { lines: ConsolidatedLine[]; eliminations: ReturnType<typeof deriveEliminations> } {
  const merged = mergeEntityLines(selectedIds.map((id) => ({ companyId: id, lines: linesByCompany[id] })));
  const eliminations = deriveEliminations(links, selectedIds, linesByCompany, currencyOf, 'CAD');

  const map = new Map<string, ConsolidatedLine>();
  for (const l of merged.lines) map.set(l.code, l);

  // apply effects (mirror of engine.applyEffects)
  for (const byCode of Object.values(eliminations.effects)) {
    for (const [code, amount] of Object.entries(byCode)) {
      const target = map.get(code);
      if (target) target.elimination += amount;
    }
  }

  // presentation rounding
  const lines = [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  for (const l of lines) {
    for (const id of Object.keys(l.byEntity)) l.byEntity[id] = round2(l.byEntity[id]);
    l.elimination = round2(l.elimination);
    l.consolidated = round2(selectedIds.reduce((s, id) => s + (l.byEntity[id] ?? 0), 0) + l.elimination);
  }
  return { lines, eliminations };
}

describe('mergeEntityLines', () => {
  it('merges shared codes across entities', () => {
    const { lines } = mergeEntityLines([
      { companyId: 'a', lines: [line('1000', 'Cash', 'asset', 100)] },
      { companyId: 'b', lines: [line('1000', 'Cash', 'asset', 200)] },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].byEntity).toEqual({ a: 100, b: 200 });
  });

  it('re-routes divergent codes onto the shared GIFI line and warns', () => {
    const { lines, warnings } = mergeEntityLines([
      { companyId: 'a', lines: [line('1000', 'Cash', 'asset', 100, { gifiCode: '1000' })] },
      { companyId: 'b', lines: [line('100', 'Cash at bank', 'asset', 200, { gifiCode: '1000' })] },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].byEntity).toEqual({ a: 100, b: 200 });
    expect(warnings.some((w) => w.code === 'chart_merge')).toBe(true);
  });
});

describe('deriveEliminations — intercompany balances', () => {
  it('eliminates the prototype sample exactly: due-from/to net to zero', () => {
    const { lines, eliminations } = buildMerged();

    const dueFrom = lines.find((l) => l.code === '1150');
    expect(dueFrom).toBeDefined();
    expect(dueFrom!.consolidated).toBe(0); // 240,000 eliminated
    expect(dueFrom!.elimination).toBe(-240000);

    const dueTo = lines.find((l) => l.code === '2100');
    expect(dueTo!.consolidated).toBe(0); // 300,000 eliminated
    expect(dueTo!.elimination).toBe(-300000);

    const icEntries = eliminations.entries.filter((e) => e.description.startsWith('Due from / due to'));
    expect(icEntries.reduce((s, e) => s + e.amount, 0)).toBe(300000);
    expect(icEntries.every((e) => e.status === 'matched')).toBe(true);
  });

  it('marks a one-sided entry as a break with the right difference', () => {
    const oneSided: Record<string, L[]> = {
      a: [line('1310', 'Due from B', 'asset', 4820.0, { isControlAccount: true })],
      b: [line('2310', 'Due to A', 'liability', 0, { isControlAccount: true })],
    };
    const result = deriveEliminations(
      [{ id: 'x', companyAId: 'a', companyBId: 'b', aName: 'A', bName: 'B', aOwnershipOfB: 100, bOwnershipOfA: 0, aDueFromCode: '1310', aDueToCode: '2311', bDueFromCode: '1311', bDueToCode: '2310' }],
      ['a', 'b'],
      oneSided,
      { a: 'CAD', b: 'CAD' },
      'CAD'
    );
    const breakEntry = result.entries.find((e) => e.status === 'break');
    expect(breakEntry).toBeDefined();
    expect(breakEntry!.difference).toBe(4820.0);
    expect(breakEntry!.amount).toBe(0); // nothing matched to eliminate
  });
});

describe('deriveEliminations — investment in subsidiaries', () => {
  it('eliminates investment against share capital; consolidated share capital = parent alone', () => {
    const { lines, eliminations } = buildMerged();

    const investment = lines.find((l) => l.code === '1600');
    expect(investment!.consolidated).toBe(0);
    expect(investment!.elimination).toBe(-780000);

    const shareCapital = lines.find((l) => l.code === '3000');
    expect(shareCapital!.consolidated).toBe(500000); // parent's alone
    expect(shareCapital!.elimination).toBe(-780000);

    const invEntries = eliminations.entries.filter((e) => e.description.startsWith('Investment'));
    expect(invEntries.reduce((s, e) => s + e.amount, 0)).toBe(780000);
    expect(eliminations.warnings.filter((w) => w.code === 'goodwill')).toHaveLength(0);
  });

  it('warns once when investment exceeds share capital (goodwill out of scope)', () => {
    const local: Record<string, L[]> = {
      a: [line('1600', 'Investment in subsidiaries', 'asset', 100000)],
      b: [line('3000', 'Share capital', 'equity', 70000, { subType: 'common_shares' })],
    };
    const result = deriveEliminations(
      [{ id: 'x', companyAId: 'a', companyBId: 'b', aName: 'A', bName: 'B', aOwnershipOfB: 100, bOwnershipOfA: 0, aDueFromCode: null, aDueToCode: null, bDueFromCode: null, bDueToCode: null }],
      ['a', 'b'],
      local,
      { a: 'CAD', b: 'CAD' },
      'CAD'
    );
    expect(result.warnings.filter((w) => w.code === 'goodwill')).toHaveLength(1);
    const entry = result.entries.find((e) => e.description.startsWith('Investment'));
    expect(entry!.amount).toBe(70000); // only the share capital is eliminated
  });
});

describe('composeBalanceSheet', () => {
  it('reproduces the prototype consolidated figures and balances', () => {
    const { lines } = buildMerged();
    const result = composeBalanceSheet(lines, selectedIds);

    const asset = result.sections.find((s) => s.key === 'asset')!;
    const liab = result.sections.find((s) => s.key === 'liability')!;
    const equity = result.sections.find((s) => s.key === 'equity')!;

    expect(asset.totals.consolidated).toBe(4233910.0);
    expect(asset.totals.elimination).toBe(-1080000.0);
    expect(liab.totals.consolidated).toBe(2190290.0);
    expect(equity.totals.consolidated).toBe(2043620.0);

    const cash = asset.lines.find((l) => l.code === '1000')!;
    expect(cash.consolidated).toBe(961760.0); // 412,880 + 268,450 + 196,320 + 84,110

    // Grand total = total liabilities and equity = 4,233,910.00
    expect(result.grandTotal.consolidated).toBe(4233910.0);
    expect(result.grandTotal.elimination).toBe(-1080000.0);

    expect(result.isBalanced).toBe(true);
    expect(result.outOfBalanceBy).toBe(0);
  });

  it('flags an out-of-balance statement', () => {
    const local: ConsolidatedLine[] = [
      { code: '1000', name: 'Cash', gifiCode: null, type: 'asset', subType: null, detailType: null, byEntity: { a: 1000 }, elimination: 0, consolidated: 1000 },
      { code: '3000', name: 'Share capital', gifiCode: null, type: 'equity', subType: 'common_shares', detailType: null, byEntity: { a: 500 }, elimination: 0, consolidated: 500 },
    ];
    const result = composeBalanceSheet(local, ['a']);
    expect(result.isBalanced).toBe(false);
    expect(result.outOfBalanceBy).toBe(500.0);
  });
});

describe('composeTrialBalance', () => {
  it('balances when debits equal credits', () => {
    const local: ConsolidatedLine[] = [
      { code: '1000', name: 'Cash', gifiCode: null, type: 'asset', subType: null, detailType: null, byEntity: { a: 100 }, elimination: 0, consolidated: 100 },
      { code: '3000', name: 'Capital', gifiCode: null, type: 'equity', subType: null, detailType: null, byEntity: { a: 100 }, elimination: 0, consolidated: 100 },
    ];
    const result = composeTrialBalance(local, ['a']);
    expect(result.isBalanced).toBe(true);
  });
});

describe('composeProfitLoss', () => {
  it('computes net income = income − cogs − opex', () => {
    const local: ConsolidatedLine[] = [
      { code: '4000', name: 'Revenue', gifiCode: null, type: 'income', subType: null, detailType: null, byEntity: { a: 1000 }, elimination: 0, consolidated: 1000 },
      { code: '5000', name: 'Cost of goods', gifiCode: null, type: 'expense', subType: null, detailType: 'cogs', byEntity: { a: 400 }, elimination: 0, consolidated: 400 },
      { code: '6000', name: 'Rent', gifiCode: null, type: 'expense', subType: null, detailType: null, byEntity: { a: 200 }, elimination: 0, consolidated: 200 },
    ];
    const result = composeProfitLoss(local, ['a']);
    expect(result.grandTotal.consolidated).toBe(400); // 1000 − 400 − 200
    expect(result.grandTotal.byEntity.a).toBe(400);
  });
});

describe('FX translation reserve', () => {
  it('is the plug between translated assets, liabilities, equity and CYE', () => {
    const local: Record<string, L[]> = {
      us: [
        line('1000', 'Cash', 'asset', 1000), // closing
        line('2000', 'Loan', 'liability', 200),
        line('3000', 'Share capital', 'equity', 500), // historical
      ],
    };
    const cye = computeCyeByEntity({ us: [line('4000', 'Revenue', 'income', 100)] }, ['us']);
    const fctr = computeFctrByEntity(local, cye, ['us']);
    // 1000 − 200 − 500 − 100 = 200
    expect(fctr.us).toBe(200);
  });
});

describe('rounding', () => {
  it('adjusts the largest line when rounded parts do not sum to the target', () => {
    const parts = [33.33, 33.33, 33.33];
    const { parts: adjusted, note } = reconcileRoundedParts(parts, 100.0);
    expect(adjusted.reduce((s, p) => s + p, 0)).toBe(100.0);
    expect(note).not.toBeNull();
  });

  it('leaves already-consistent parts untouched', () => {
    const parts = [25.5, 25.5];
    const { parts: adjusted, note } = reconcileRoundedParts(parts, 51.0);
    expect(adjusted).toEqual(parts);
    expect(note).toBeNull();
  });
});
