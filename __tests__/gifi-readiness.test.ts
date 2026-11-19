/**
 * GIFI Slices 3–4 (chart-of-accounts GIFI plan, 2026-11-19):
 *  - readiness counting (active only; Retained Earnings / Opening
 *    Balance Equity / owner's capital & draw excluded by design;
 *    legacy invalid values count as uncoded; inactive accounts and
 *    Miscellaneous Expense handled per the plan);
 *  - entity flow mode (sole proprietor quiet, everything else —
 *    including unset — full);
 *  - the pre-export checklist decision (Slice 4): shows only in the
 *    full flow when countable uncoded accounts exist;
 *  - suggestions: template twins stay in sync with BOTH chart
 *    templates, keyword shortlists, account-type filtering, exempt
 *    and already-coded accounts get none, and suggesting is pure —
 *    it never mutates or "applies" anything;
 *  - the worklist save path is the same validated PUT /api/coa/[id]
 *    the Edit form uses.
 */

import { NextRequest } from 'next/server';

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    chartOfAccount: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      findMany: jest.fn(async () => []),
      create: jest.fn(),
    },
  },
}));

const mockRequireCompany = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: (...args: unknown[]) => mockRequireCompany(...args),
  auditLog: jest.fn(),
}));

import {
  computeGifiReadiness,
  gifiAccountStatus,
  gifiExportChecklist,
  gifiFlowMode,
  isGifiDesignExempt,
  type GifiReadinessAccountInput,
} from '@/lib/gifi-readiness';
import { suggestGifiCodes } from '@/lib/gifi-suggestions';
import { validateGifiCode } from '@/lib/gifi';
import { CORPORATION_CHART_OF_ACCOUNTS, DEFAULT_CHART_OF_ACCOUNTS } from '@/lib/default-coa';
import { PUT } from '@/app/api/coa/[id]/route';

// ── Readiness counting ───────────────────────────────────────────────

const CHART: GifiReadinessAccountInput[] = [
  { id: 'a1', code: '6910', name: 'Insurance', type: 'expense', gifiCode: '8690', active: true },
  { id: 'a2', code: '6990', name: 'Miscellaneous Expense', type: 'expense', gifiCode: null, active: true },
  { id: 'a3', code: '6150', name: 'Consulting Fees', type: 'expense', gifiCode: '87l0', active: true },
  { id: 'a4', code: '1010', name: 'Business Checking', type: 'asset', gifiCode: '2599', active: true },
  { id: 'a5', code: '7000', name: 'Old Account', type: 'expense', gifiCode: null, active: false },
  { id: 'a6', code: '3100', name: 'Retained Earnings', type: 'equity', subType: 'retained_earnings', gifiCode: null, active: true },
  { id: 'a7', code: '3200', name: 'Retained Earnings', type: 'equity', gifiCode: null, active: true },
  { id: 'a8', code: '3950', name: 'Opening Balance Equity', type: 'equity', detailType: 'Opening balance offset', gifiCode: null, active: true },
  { id: 'a9', code: '3000', name: "Owner's Capital", type: 'equity', gifiCode: null, active: true },
  { id: 'a10', code: '3900', name: "Owner's Draw", type: 'equity', gifiCode: null, active: true },
];

describe('computeGifiReadiness', () => {
  it('counts active, non-exempt accounts only', () => {
    const r = computeGifiReadiness(CHART);
    // Countable: Insurance, Miscellaneous Expense, Consulting Fees,
    // Business Checking (a5 inactive; a6–a10 design-exempt).
    expect(r.total).toBe(4);
    expect(r.coded).toBe(1);
    expect(r.needsCode.map((a) => a.code)).toEqual(['6990', '6150', '1010']);
  });

  it('treats a blank code as uncoded and a legacy typo as invalid', () => {
    const r = computeGifiReadiness(CHART);
    const byCode = new Map(r.needsCode.map((a) => [a.code, a]));
    expect(byCode.get('6990')?.status).toBe('uncoded');
    expect(byCode.get('6150')?.status).toBe('invalid');
    expect(byCode.get('6150')?.storedGifiCode).toBe('87l0');
  });

  it('treats a stored total code as invalid (the export cannot use it)', () => {
    const r = computeGifiReadiness(CHART);
    const checking = r.needsCode.find((a) => a.code === '1010');
    expect(checking?.status).toBe('invalid');
    expect(checking?.storedGifiCode).toBe('2599');
  });

  it('keeps Miscellaneous Expense countable (it belongs on the worklist)', () => {
    const r = computeGifiReadiness(CHART);
    expect(r.needsCode.some((a) => a.name === 'Miscellaneous Expense')).toBe(true);
  });

  it('exempts design accounts by name variants (case, spacing, curly apostrophe)', () => {
    expect(isGifiDesignExempt({ code: '3100', name: '  RETAINED   EARNINGS ', type: 'equity' })).toBe(true);
    expect(isGifiDesignExempt({ code: '3900', name: 'Owner’s Draw', type: 'equity' })).toBe(true);
    expect(isGifiDesignExempt({ code: '3950', name: 'Opening Balance Equity', type: 'equity' })).toBe(true);
    expect(isGifiDesignExempt({ code: '6910', name: 'Insurance', type: 'expense' })).toBe(false);
  });

  it('agrees with API validation on what counts as coded', () => {
    for (const value of ['8690', '87l0', '2599', '3600', '', null]) {
      const account: GifiReadinessAccountInput = { code: '1', name: 'X', type: 'expense', gifiCode: value, active: true };
      const validation = validateGifiCode(value);
      const expectCoded = validation.ok && validation.code !== null;
      expect(gifiAccountStatus(account) === 'coded').toBe(expectCoded);
    }
  });
});

// ── Entity flow mode ─────────────────────────────────────────────────

describe('gifiFlowMode', () => {
  it('is quiet only for sole proprietors', () => {
    expect(gifiFlowMode('sole_proprietor')).toBe('quiet');
  });

  it('is full for GIFI filers and for unset/unknown types', () => {
    for (const t of ['corporation', 'partnership', 'nonprofit', 'other', null, undefined, 'bogus']) {
      expect(gifiFlowMode(t)).toBe('full');
    }
  });
});

// ── Slice 4: pre-export checklist decision ───────────────────────────

describe('gifiExportChecklist', () => {
  const uncoded: GifiReadinessAccountInput[] = [
    { code: '5300', name: 'Insurance', type: 'expense', gifiCode: null, active: true },
  ];
  const allCoded: GifiReadinessAccountInput[] = [
    { code: '5300', name: 'Insurance', type: 'expense', gifiCode: '8690', active: true },
    { code: '3100', name: 'Retained Earnings', type: 'equity', subType: 'retained_earnings', gifiCode: null, active: true },
  ];

  it('shows when countable accounts are uncoded', () => {
    const c = gifiExportChecklist(uncoded, 'corporation');
    expect(c.show).toBe(true);
    expect(c.uncoded.map((a) => a.name)).toEqual(['Insurance']);
  });

  it('does not show when everything countable is coded (design-exempt uncoded is fine)', () => {
    expect(gifiExportChecklist(allCoded, 'corporation').show).toBe(false);
  });

  it('shows for an invalid stored code too', () => {
    const invalid = [{ code: '5300', name: 'Insurance', type: 'expense', gifiCode: '87l0', active: true }];
    expect(gifiExportChecklist(invalid, 'corporation').show).toBe(true);
  });

  it('never shows for sole proprietors (quiet flow), even when uncoded', () => {
    expect(gifiExportChecklist(uncoded, 'sole_proprietor').show).toBe(false);
  });

  it('shows for an unset business type (defaults to the full flow)', () => {
    expect(gifiExportChecklist(uncoded, null).show).toBe(true);
  });
});

// ── Suggestions: template twins ──────────────────────────────────────

describe('suggestGifiCodes — template twins', () => {
  it('suggests the template code for every coded account in both templates', () => {
    for (const template of [DEFAULT_CHART_OF_ACCOUNTS, CORPORATION_CHART_OF_ACCOUNTS]) {
      for (const account of template) {
        if (!account.gifiCode) continue;
        const suggestions = suggestGifiCodes({ name: account.name, type: account.type });
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions[0].code).toBe(account.gifiCode);
        expect(suggestions[0].source).toBe('template');
      }
    }
  });

  it('resolves a known synonym to its template twin ("Meals")', () => {
    const s = suggestGifiCodes({ name: 'Meals', type: 'expense' });
    expect(s[0]?.code).toBe('8523');
    expect(s[0]?.source).toBe('template');
  });
});

// ── Suggestions: keyword rules ───────────────────────────────────────

describe('suggestGifiCodes — keyword rules', () => {
  it('offers the rent shortlist, generic first', () => {
    const s = suggestGifiCodes({ name: 'Office Rent', type: 'expense' });
    expect(s.map((x) => x.code)).toEqual(['8910', '8911', '8914']);
  });

  it('suggests insurance for a non-template insurance name', () => {
    const s = suggestGifiCodes({ name: 'Cyber Insurance', type: 'expense' });
    expect(s[0]?.code).toBe('8690');
    expect(s[0]?.source).toBe('keyword');
  });

  it('suggests 8710 for "Bank Charges & Interest" (the Muja account)', () => {
    const s = suggestGifiCodes({ name: 'Bank Charges & Interest', type: 'expense' });
    expect(s[0]?.code).toBe('8710');
  });

  it('suggests the family contra code for accumulated amortization accounts', () => {
    expect(suggestGifiCodes({ name: 'Accumulated Amortization — Furniture & Fixtures', type: 'asset' })[0]?.code).toBe('1788');
    expect(suggestGifiCodes({ name: 'Accumulated Depreciation — Vehicles', type: 'asset' })[0]?.code).toBe('1743');
  });

  it('suggests motor vehicles for a vehicle asset account', () => {
    const s = suggestGifiCodes({ name: 'Motor Vehicles', type: 'asset' });
    expect(s[0]?.code).toBe('1742');
  });

  it('filters suggestions to the account type (a vehicle LOAN gets debt, not the vehicle code)', () => {
    const s = suggestGifiCodes({ name: 'Vehicle Loan', type: 'liability' });
    expect(s.map((x) => x.code)).not.toContain('1742');
    expect(s.map((x) => x.code)).toContain('3140');
  });

  it('does not suggest expense codes for an income account', () => {
    const s = suggestGifiCodes({ name: 'Interest Income', type: 'income' });
    expect(s.map((x) => x.code)).not.toContain('8710');
  });
});

// ── Suggestions: restraint ───────────────────────────────────────────

describe('suggestGifiCodes — restraint', () => {
  it('suggests nothing for design-exempt accounts', () => {
    expect(suggestGifiCodes({ name: 'Retained Earnings', type: 'equity' })).toEqual([]);
    expect(suggestGifiCodes({ name: 'Opening Balance Equity', type: 'equity' })).toEqual([]);
  });

  it('suggests nothing when the account already carries a valid code', () => {
    expect(suggestGifiCodes({ name: 'Insurance', type: 'expense', gifiCode: '8690' })).toEqual([]);
  });

  it('still suggests when the stored value is a legacy invalid one', () => {
    const s = suggestGifiCodes({ name: 'Insurance', type: 'expense', gifiCode: '87l0' });
    expect(s[0]?.code).toBe('8690');
  });

  it('is pure: repeated calls agree and the input is never mutated', () => {
    const input = { name: 'Cyber Insurance', type: 'expense', detailType: null, gifiCode: null };
    const snapshot = JSON.stringify(input);
    const first = suggestGifiCodes(input);
    first.push({ code: '9998', description: 'mutated', source: 'keyword', reason: 'test' });
    const second = suggestGifiCodes(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(second.map((x) => x.code)).toEqual(['8690']);
  });
});

// ── Worklist save path: the same validated PUT the Edit form uses ────

function putRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/coa/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('worklist save path (PUT /api/coa/[id] with only gifiCode)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue({ companyId: 'company-a', userId: 'owner-1', error: null });
    mockFindUnique.mockResolvedValue({ id: 'acct-9', companyId: 'company-a', type: 'expense', gifiCode: null });
    mockUpdate.mockImplementation(async ({ data }: any) => ({ id: 'acct-9', ...data }));
  });

  it('persists a picked code through the validated route', async () => {
    const res = await PUT(putRequest('acct-9', { gifiCode: '8690' }), { params: { id: 'acct-9' } });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gifiCode: '8690' }) }),
    );
  });

  it('rejects an invalid code and writes nothing', async () => {
    const res = await PUT(putRequest('acct-9', { gifiCode: '87l0' }), { params: { id: 'acct-9' } });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('surfaces (does not block) a cross-section warning for the worklist to show', async () => {
    const res = await PUT(putRequest('acct-9', { gifiCode: '1001' }), { params: { id: 'acct-9' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warnings).toHaveLength(1);
  });
});
