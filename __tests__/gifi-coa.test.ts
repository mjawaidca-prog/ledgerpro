/**
 * GIFI Slices 1–2 (chart-of-accounts GIFI plan, 2026-11-19):
 *  - catalogue integrity (769 CRA codes from the verified RC4088 list;
 *    every template assignment exists and is assignable);
 *  - API validation on POST/PUT /api/coa (bad code rejected, total and
 *    computed codes rejected, good code stored, blank clears);
 *  - template coding (Appendix B assignments; corporation variant;
 *    Retained Earnings / Opening Balance Equity deliberately uncoded);
 *  - backfill (exact code+name match fills, name mismatch doesn't,
 *    an existing stored value is never overwritten, idempotent).
 */

import { NextRequest } from 'next/server';

// ── Mocks for the route tests ────────────────────────────────────────
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    chartOfAccount: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

const mockRequireCompany = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: (...args: unknown[]) => mockRequireCompany(...args),
  auditLog: jest.fn(),
}));
jest.mock('@/lib/default-coa', () => ({
  ...jest.requireActual('@/lib/default-coa'),
  ensureDefaultChartOfAccounts: jest.fn(async () => ({ created: 0 })),
}));
jest.mock('@/lib/reporting', () => ({
  getGLActivity: jest.fn(async () => []),
  endOfDay: (d: Date) => d,
  coaSummaryFromActivity: jest.fn(() => ({})),
}));

import { GIFI_CATALOGUE } from '@/lib/gifi-catalogue';
import {
  COMPUTED_GIFI_CODES,
  PICKABLE_GIFI_CODES,
  getGifiEntry,
  hasValidGifiCode,
  isPickableGifiCode,
  validateGifiCode,
} from '@/lib/gifi';
import {
  CORPORATION_CHART_OF_ACCOUNTS,
  DEFAULT_CHART_OF_ACCOUNTS,
  chartTemplateForBusinessType,
} from '@/lib/default-coa';
import { backfillGifiCodesForCompany, type GifiBackfillAccount } from '@/lib/gifi-backfill';
import { POST } from '@/app/api/coa/route';
import { PUT } from '@/app/api/coa/[id]/route';

// ── Catalogue integrity ──────────────────────────────────────────────

describe('GIFI catalogue (RC4088 verified)', () => {
  it('holds all 769 codes, unique and 4-digit', () => {
    expect(GIFI_CATALOGUE).toHaveLength(769);
    const codes = new Set(GIFI_CATALOGUE.map((e) => e.code));
    expect(codes.size).toBe(769);
    for (const e of GIFI_CATALOGUE) expect(e.code).toMatch(/^\d{4}$/);
  });

  it('carries the official CRA descriptions', () => {
    expect(getGifiEntry('1001')?.description).toBe('Cash');
    expect(getGifiEntry('8710')?.description).toBe('Interest and bank charges');
    expect(getGifiEntry('3500')?.description).toBe('Common shares');
    expect(getGifiEntry('9060')?.description).toBe('Salaries and wages');
  });

  it('offers only detail/generic codes, minus the computed continuity codes', () => {
    // 598 detail + 137 generic − {3600, 3680} (generic but computed on
    // the tax side; 3849 is a total and already excluded by type).
    expect(PICKABLE_GIFI_CODES).toHaveLength(733);
    for (const e of PICKABLE_GIFI_CODES) {
      expect(['detail', 'generic']).toContain(e.codeType);
      expect(COMPUTED_GIFI_CODES.has(e.code)).toBe(false);
    }
  });

  it('never offers total, header, or computed codes', () => {
    for (const code of ['2599', '3499', '3620', '3640', '8299', '9368', '9999', '0001', '3600', '3680', '3849']) {
      expect(isPickableGifiCode(code)).toBe(false);
    }
    for (const code of ['1001', '1002', '1301', '2624', '3500', '8000', '8710', '9060']) {
      expect(isPickableGifiCode(code)).toBe(true);
    }
  });
});

// ── Validation ───────────────────────────────────────────────────────

describe('validateGifiCode', () => {
  it('accepts a good code and trims it', () => {
    expect(validateGifiCode('8710')).toEqual({ ok: true, code: '8710' });
    expect(validateGifiCode(' 1002 ')).toEqual({ ok: true, code: '1002' });
  });

  it('treats blank/null as "no code", which is allowed', () => {
    expect(validateGifiCode(null)).toEqual({ ok: true, code: null });
    expect(validateGifiCode(undefined)).toEqual({ ok: true, code: null });
    expect(validateGifiCode('')).toEqual({ ok: true, code: null });
    expect(validateGifiCode('   ')).toEqual({ ok: true, code: null });
  });

  it('rejects typos and non-catalogue codes', () => {
    expect(validateGifiCode('87l0').ok).toBe(false);
    expect(validateGifiCode('871').ok).toBe(false);
    expect(validateGifiCode('4999').ok).toBe(false); // not in the catalogue
    expect(validateGifiCode(8710).ok).toBe(false); // must be a string
  });

  it('rejects total and computed codes with a clear reason', () => {
    const total = validateGifiCode('2599');
    expect(total.ok).toBe(false);
    if (!total.ok) expect(total.error).toMatch(/calculated by the tax software/);
    const computed = validateGifiCode('3600');
    expect(computed.ok).toBe(false);
    if (!computed.ok) expect(computed.error).toMatch(/calculated by the tax software/);
  });

  it('hasValidGifiCode mirrors what the export can use', () => {
    expect(hasValidGifiCode('8710')).toBe(true);
    expect(hasValidGifiCode('87l0')).toBe(false);
    expect(hasValidGifiCode('2599')).toBe(false);
    expect(hasValidGifiCode(null)).toBe(false);
    expect(hasValidGifiCode('')).toBe(false);
  });
});

// ── Templates (Slice 2) ──────────────────────────────────────────────

describe('pre-coded templates', () => {
  it('every GIFI code assigned in either template exists and is assignable', () => {
    for (const template of [DEFAULT_CHART_OF_ACCOUNTS, CORPORATION_CHART_OF_ACCOUNTS]) {
      for (const account of template) {
        if (account.gifiCode) {
          expect(isPickableGifiCode(account.gifiCode)).toBe(true);
        }
      }
    }
  });

  it('default template carries the Appendix B assignments', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));
    expect(byCode.get('1000')?.gifiCode).toBe('1002');
    expect(byCode.get('1040')?.gifiCode).toBe('1001');
    expect(byCode.get('1100')?.gifiCode).toBe('1062');
    expect(byCode.get('1500')?.gifiCode).toBe('1787');
    expect(byCode.get('2310')?.gifiCode).toBe('1480');
    expect(byCode.get('2440')?.gifiCode).toBe('2624');
    expect(byCode.get('2500')?.gifiCode).toBe('3140');
    expect(byCode.get('4000')?.gifiCode).toBe('8000');
    expect(byCode.get('5000')?.gifiCode).toBe('8320');
    expect(byCode.get('6200')?.gifiCode).toBe('8860');
    expect(byCode.get('6900')?.gifiCode).toBe('8715');
    expect(byCode.get('6920')?.gifiCode).toBe('9060');
    expect(byCode.get('6940')?.gifiCode).toBe('8622');
  });

  it('Retained Earnings, Opening Balance Equity, owner accounts and Miscellaneous stay deliberately uncoded', () => {
    const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));
    for (const code of ['3000', '3100', '3900', '3950', '6990']) {
      expect(byCode.get(code)?.gifiCode).toBeUndefined();
    }
  });

  it('corporation variant swaps the equity section and adds the shareholder pair', () => {
    const byCode = new Map(CORPORATION_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));
    expect(byCode.get('3000')?.name).toBe('Share Capital');
    expect(byCode.get('3000')?.gifiCode).toBe('3500');
    expect(byCode.get('1300')?.name).toBe('Due from Shareholder');
    expect(byCode.get('1300')?.gifiCode).toBe('1301');
    expect(byCode.get('2600')?.name).toBe('Due to Shareholder');
    expect(byCode.get('2600')?.gifiCode).toBe('2781');
    expect(CORPORATION_CHART_OF_ACCOUNTS.some((a) => a.name === "Owner's Capital")).toBe(false);
    expect(CORPORATION_CHART_OF_ACCOUNTS.some((a) => a.name === "Owner's Draw")).toBe(false);
    // Deliberate exceptions survive the variant.
    expect(byCode.get('3100')?.gifiCode).toBeUndefined();
    expect(byCode.get('3950')?.gifiCode).toBeUndefined();
    // Shared operating accounts keep the same coding as the default.
    expect(byCode.get('6920')?.gifiCode).toBe('9060');
  });

  it('template selection follows businessType', () => {
    expect(chartTemplateForBusinessType('corporation')).toBe(CORPORATION_CHART_OF_ACCOUNTS);
    expect(chartTemplateForBusinessType('sole_proprietor')).toBe(DEFAULT_CHART_OF_ACCOUNTS);
    expect(chartTemplateForBusinessType('partnership')).toBe(DEFAULT_CHART_OF_ACCOUNTS);
    expect(chartTemplateForBusinessType(null)).toBe(DEFAULT_CHART_OF_ACCOUNTS);
    expect(chartTemplateForBusinessType(undefined)).toBe(DEFAULT_CHART_OF_ACCOUNTS);
  });
});

// ── API validation (POST / PUT /api/coa) ─────────────────────────────

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/coa', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
function putRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/coa/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/coa GIFI validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue({ companyId: 'company-a', userId: 'owner-1', error: null });
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockImplementation(async ({ data }: any) => ({ id: 'new-id', ...data }));
  });

  const base = { code: '6150', name: 'Bank Charges', type: 'expense' };

  it('stores a good code at creation', async () => {
    const res = await POST(postRequest({ ...base, gifiCode: '8710' }));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gifiCode: '8710' }) }),
    );
  });

  // GIFI-at-creation (Phase 1, design §2.1) supersedes the old
  // "blank is fine" contract: a silent blank is now refused; the
  // recorded "leave unmapped" choice is the way to create uncoded.
  it('refuses an undecided account at creation (no code, no recorded choice)', async () => {
    const res = await POST(postRequest(base));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Leave unmapped/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates an uncoded account when the unmapped choice is recorded', async () => {
    const res = await POST(postRequest({ ...base, gifiUnmappedByChoice: true }));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gifiCode: null, gifiUnmappedByChoice: true }),
      }),
    );
  });

  it('creates a design-exempt account uncoded with no choice needed', async () => {
    const res = await POST(postRequest({ code: '3100', name: 'Retained Earnings', type: 'equity' }));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gifiCode: null, gifiUnmappedByChoice: false }),
      }),
    );
  });

  it('stores the code, not the flag, when both are sent (they are exclusive)', async () => {
    const res = await POST(postRequest({ ...base, gifiCode: '8710', gifiUnmappedByChoice: true }));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gifiCode: '8710', gifiUnmappedByChoice: false }),
      }),
    );
  });

  it('rejects a typo code and creates nothing', async () => {
    const res = await POST(postRequest({ ...base, gifiCode: '87l0' }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a total code', async () => {
    const res = await POST(postRequest({ ...base, gifiCode: '2599' }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a computed retained-earnings code', async () => {
    const res = await POST(postRequest({ ...base, gifiCode: '3600' }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('warns (but saves) when the code’s section fights the account type', async () => {
    const res = await POST(postRequest({ ...base, gifiCode: '1001' })); // asset code on an expense
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.warnings).toHaveLength(1);
    expect(json.warnings[0]).toMatch(/1001/);
  });
});

describe('PUT /api/coa/[id] GIFI validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue({ companyId: 'company-a', userId: 'owner-1', error: null });
    mockFindUnique.mockResolvedValue({ id: 'acct-1', companyId: 'company-a', type: 'expense', gifiCode: null });
    mockUpdate.mockImplementation(async ({ data }: any) => ({ id: 'acct-1', ...data }));
  });

  it('stores a good code on edit', async () => {
    const res = await PUT(putRequest('acct-1', { gifiCode: '9060' }), { params: { id: 'acct-1' } });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gifiCode: '9060' }) }),
    );
  });

  // GIFI-at-creation (Phase 1): clearing is no longer silent — blank
  // alone is refused; blank + the recorded choice clears and records.
  it('refuses to clear a code silently (blank with no recorded choice)', async () => {
    const res = await PUT(putRequest('acct-1', { gifiCode: '' }), { params: { id: 'acct-1' } });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('clears the code when the unmapped choice is recorded', async () => {
    const res = await PUT(putRequest('acct-1', { gifiCode: '', gifiUnmappedByChoice: true }), { params: { id: 'acct-1' } });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gifiCode: null, gifiUnmappedByChoice: true }),
      }),
    );
  });

  it('records the unmapped choice on its own (worklist "Leave unmapped")', async () => {
    const res = await PUT(putRequest('acct-1', { gifiCode: null, gifiUnmappedByChoice: true }), { params: { id: 'acct-1' } });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gifiCode: null, gifiUnmappedByChoice: true }),
      }),
    );
  });

  it('rejects an invalid code and updates nothing', async () => {
    const res = await PUT(putRequest('acct-1', { gifiCode: '9999' }), { params: { id: 'acct-1' } });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('leaves the code alone when the field is absent', async () => {
    const res = await PUT(putRequest('acct-1', { name: 'Renamed' }), { params: { id: 'acct-1' } });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gifiCode: undefined }) }),
    );
  });
});

// ── Backfill ─────────────────────────────────────────────────────────

function fakeBackfillClient(accounts: GifiBackfillAccount[]) {
  const state = accounts.map((a) => ({ ...a }));
  const updates: { id: string; gifiCode: string }[] = [];
  return {
    state,
    updates,
    chartOfAccount: {
      findMany: async () => state.map((a) => ({ ...a })),
      update: async ({ where, data }: any) => {
        updates.push({ id: where.id, gifiCode: data.gifiCode });
        const row = state.find((a) => a.id === where.id);
        if (row) row.gifiCode = data.gifiCode;
        return row;
      },
    },
  };
}

describe('backfillGifiCodesForCompany', () => {
  const baseAccounts: GifiBackfillAccount[] = [
    { id: 'a1', code: '1010', name: 'Business Checking', gifiCode: null },
    { id: 'a2', code: '1010', name: 'Chequing Account', gifiCode: null }, // name mismatch (dup code impossible in prod; exercises the name rule)
    { id: 'a3', code: '1040', name: 'Petty Cash', gifiCode: '1002' }, // user-set — never overwritten
    { id: 'a4', code: '1100', name: 'Accounts Receivable', gifiCode: '87l0' }, // legacy typo — never overwritten
    { id: 'a5', code: '3100', name: 'Retained Earnings', gifiCode: null }, // deliberately uncoded template account
    { id: 'a6', code: '9999', name: 'Custom Account', gifiCode: null }, // not a template account
  ];

  it('fills exact code+name matches only', async () => {
    const client = fakeBackfillClient(baseAccounts);
    const result = await backfillGifiCodesForCompany('company-a', client as any, {});
    expect(result.filled).toBe(1);
    expect(result.fills).toEqual([
      { accountCode: '1010', accountName: 'Business Checking', gifiCode: '1002' },
    ]);
    expect(result.alreadyCoded).toBe(2); // a3 (user code) + a4 (legacy typo)
    expect(result.noMatch).toBe(3); // a2 name mismatch, a5 deliberate, a6 custom
    expect(client.updates).toEqual([{ id: 'a1', gifiCode: '1002' }]);
  });

  it('is idempotent — a second run fills nothing', async () => {
    const client = fakeBackfillClient(baseAccounts);
    await backfillGifiCodesForCompany('company-a', client as any, {});
    const second = await backfillGifiCodesForCompany('company-a', client as any, {});
    expect(second.filled).toBe(0);
    expect(client.updates).toHaveLength(1);
  });

  it('dry-run reports without writing', async () => {
    const client = fakeBackfillClient(baseAccounts);
    const result = await backfillGifiCodesForCompany('company-a', client as any, { apply: false });
    expect(result.filled).toBe(1);
    expect(client.updates).toHaveLength(0);
  });

  it('matches a corporation against the corporation template', async () => {
    const client = fakeBackfillClient([
      { id: 'c1', code: '3000', name: 'Share Capital', gifiCode: null },
      { id: 'c2', code: '3000', name: "Owner's Capital", gifiCode: null },
      { id: 'c3', code: '1300', name: 'Due from Shareholder', gifiCode: null },
    ]);
    const result = await backfillGifiCodesForCompany('company-corp', client as any, { businessType: 'corporation' });
    expect(result.filled).toBe(2);
    expect(result.fills).toContainEqual({ accountCode: '3000', accountName: 'Share Capital', gifiCode: '3500' });
    expect(result.fills).toContainEqual({ accountCode: '1300', accountName: 'Due from Shareholder', gifiCode: '1301' });
    expect(result.noMatch).toBe(1); // Owner's Capital is not in the corporation template
  });
});
