/**
 * GIFI readiness worklist on engine v2 (follow-up to Phase 2 item 3,
 * which wired v2 + learning events into the account forms and
 * deliberately deferred the readiness panel).
 *
 * Covered here:
 *  - the worklist's suggestion path — computeGifiReadiness picks the
 *    undecided population, rankGifiSuggestions ranks each row — now
 *    returns v2's top candidate for the known divergence case:
 *    "Holdbacks Payable" suggests 2623, where v1 suggested 2620;
 *  - the learning context the parent page passes re-ranks worklist
 *    rows the same way it re-ranks the forms;
 *  - the worklist population is unchanged: decided-unmapped accounts
 *    (gifiUnmappedByChoice) stay off the worklist, coded accounts too;
 *  - applying a code from the worklist records the same
 *    GifiSuggestionEvent the forms record, through the same hook:
 *    the panel's PUT /api/coa/[id] payload now carries
 *    `gifiShownCodes`, and the route's existing recorder writes the
 *    event (top pick, override, and deliberate-unmapped cases);
 *  - event recording is failure-proof: a rejected event write still
 *    returns a successful save, and a save with no shown list (every
 *    pre-existing client) records nothing.
 */

import { NextRequest } from 'next/server';

// ── Mocks (same pattern as gifi-coa.test.ts, plus the event table
// the real recorder writes through the mocked db) ───────────────────
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockEventCreate = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    chartOfAccount: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    gifiSuggestionEvent: {
      create: (...args: unknown[]) => mockEventCreate(...args),
    },
  },
}));

const mockRequireCompany = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  requireCompany: (...args: unknown[]) => mockRequireCompany(...args),
  auditLog: jest.fn(),
}));

import { computeGifiReadiness, type GifiReadinessAccountInput } from '@/lib/gifi-readiness';
import { suggestGifiCodes } from '@/lib/gifi-suggestions';
import { rankGifiSuggestions } from '@/lib/gifi-suggestions-v2';
import { buildGifiLearningContext, type GifiEventLike } from '@/lib/gifi-learning';
import { PUT } from '@/app/api/coa/[id]/route';

const codes = (list: { code: string }[]) => list.map((s) => s.code);

// ── The worklist suggestion path ─────────────────────────────────────

describe('worklist suggestion path (readiness population + v2 ranking)', () => {
  const holdbacks: GifiReadinessAccountInput = {
    id: 'acct-hb',
    code: '2620',
    name: 'Holdbacks Payable',
    type: 'liability',
    gifiCode: null,
  };

  it('puts the undecided account on the worklist', () => {
    const readiness = computeGifiReadiness([holdbacks]);
    expect(readiness.needsCode.map((a) => a.name)).toEqual(['Holdbacks Payable']);
  });

  it('suggests v2\'s top candidate (2623) for "Holdbacks Payable", where v1 suggested 2620', () => {
    // The divergence this wiring fixes: v1 collapsed the account onto
    // the general payable code; v2 promotes the precise detail code.
    expect(suggestGifiCodes(holdbacks)[0].code).toBe('2620');

    const [row] = computeGifiReadiness([holdbacks]).needsCode;
    const ranked = rankGifiSuggestions(row);
    expect(ranked[0].code).toBe('2623');
    expect(ranked[0].description).not.toBe('');
    expect(ranked[0].reason).not.toBe('');
    // The general code stays on the list as a candidate, ranked below.
    expect(codes(ranked)).toContain('2620');
    expect(codes(ranked).indexOf('2620')).toBeGreaterThan(0);
  });

  it('re-ranks worklist rows from the learning context, like the forms', () => {
    const account: GifiReadinessAccountInput = {
      id: 'acct-cp',
      code: '2620',
      name: 'Contractor Payable',
      type: 'liability',
      gifiCode: null,
    };
    const events: GifiEventLike[] = Array.from({ length: 3 }, () => ({
      accountName: 'Contractor Payable',
      accountType: 'liability',
      chosenCode: '2621',
    }));
    const learning = buildGifiLearningContext(events, []);
    const [row] = computeGifiReadiness([account]).needsCode;
    const ranked = rankGifiSuggestions(row, learning);
    expect(ranked[0].code).toBe('2621');
    expect(ranked[0].reason).toBe('You usually code these as 2621 here');
  });

  it('keeps decided-unmapped and coded accounts off the worklist (unchanged population)', () => {
    const decided: GifiReadinessAccountInput = {
      id: 'acct-misc',
      code: '6990',
      name: 'Miscellaneous Expense',
      type: 'expense',
      gifiCode: null,
      gifiUnmappedByChoice: true,
    };
    const coded: GifiReadinessAccountInput = {
      id: 'acct-rent',
      code: '8910',
      name: 'Office Rent',
      type: 'expense',
      gifiCode: '8910',
    };
    const readiness = computeGifiReadiness([decided, coded]);
    expect(readiness.needsCode).toEqual([]);
    expect(readiness.decidedUnmapped.map((a) => a.name)).toEqual(['Miscellaneous Expense']);
  });
});

// ── Event recording through the worklist's save route ────────────────

function putRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/coa/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const EXISTING = {
  id: 'acct-hb',
  companyId: 'company-a',
  name: 'Holdbacks Payable',
  type: 'liability',
  gifiCode: null as string | null,
  gifiUnmappedByChoice: false,
};

describe('PUT /api/coa/[id] with the worklist payload (gifiShownCodes)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireCompany.mockResolvedValue({ companyId: 'company-a', userId: 'owner-1', error: null });
    mockFindUnique.mockResolvedValue({ ...EXISTING });
    mockUpdate.mockImplementation(async ({ data }: any) => {
      const merged: Record<string, unknown> = { ...EXISTING };
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) merged[key] = value;
      }
      return merged;
    });
    mockEventCreate.mockResolvedValue({ id: 'evt-1' });
  });

  it('records the event when the top suggestion is applied', async () => {
    const res = await PUT(
      putRequest('acct-hb', { gifiCode: '2623', gifiShownCodes: ['2623', '2620'] }),
      { params: { id: 'acct-hb' } },
    );
    expect(res.status).toBe(200);
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-a',
        accountName: 'Holdbacks Payable',
        accountType: 'liability',
        shownCodes: JSON.stringify(['2623', '2620']),
        chosenCode: '2623',
        wasTopSuggestion: true,
        wasOverride: false,
      }),
    });
  });

  it('records an override when a different shown code is applied', async () => {
    const res = await PUT(
      putRequest('acct-hb', { gifiCode: '2620', gifiShownCodes: ['2623', '2620'] }),
      { params: { id: 'acct-hb' } },
    );
    expect(res.status).toBe(200);
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        chosenCode: '2620',
        wasTopSuggestion: false,
        wasOverride: true,
      }),
    });
  });

  it('records the deliberate-unmapped decision from the worklist', async () => {
    const res = await PUT(
      putRequest('acct-hb', { gifiCode: null, gifiUnmappedByChoice: true, gifiShownCodes: ['2623', '2620'] }),
      { params: { id: 'acct-hb' } },
    );
    expect(res.status).toBe(200);
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        chosenCode: null,
        wasTopSuggestion: false,
        wasOverride: false,
      }),
    });
  });

  it('still saves when the event write fails (telemetry never fails a save)', async () => {
    mockEventCreate.mockRejectedValue(new Error('event table unavailable'));
    const res = await PUT(
      putRequest('acct-hb', { gifiCode: '2623', gifiShownCodes: ['2623', '2620'] }),
      { params: { id: 'acct-hb' } },
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('records nothing when no shown list is sent (pre-existing clients unaffected)', async () => {
    const res = await PUT(putRequest('acct-hb', { gifiCode: '2623' }), { params: { id: 'acct-hb' } });
    expect(res.status).toBe(200);
    expect(mockEventCreate).not.toHaveBeenCalled();
  });
});
