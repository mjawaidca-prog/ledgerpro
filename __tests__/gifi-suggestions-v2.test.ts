/**
 * GIFI suggestion engine v2 (LedgerPro improvement plan, Phase 2
 * item 3): RANKED suggestions that learn from overrides.
 *
 * Covered here:
 *  - ranking order for representative account names (v1's candidates,
 *    rescored, order preserved where v1 was already right);
 *  - the Nov 19 seed divergences: three DISTINCT payable accounts
 *    that v1 collapsed onto the generic 2620 now get their precise
 *    detail codes (2623/2625/2626) ranked first, with 2620 still
 *    present; the chequing account (1010 pattern) keeps 1002 first
 *    but surfaces 1001 — Cash as a flagged alternative with a reason;
 *  - per-company override learning: repeated choices for a name
 *    pattern re-rank that pattern's #1, with the reason
 *    "You usually code these as Y here";
 *  - scope discipline: the global (cross-company) signal is weaker
 *    than the per-company signal and never outranks it; a global-only
 *    signal still applies, with its own reason;
 *  - a learned code joins the list even when the rules offered
 *    nothing for the name;
 *  - restraint parity with v1: design-exempt and already-coded
 *    accounts get no suggestions, learning or not;
 *  - the pattern/aggregation layer (anonymized keys, both levels,
 *    unchosen events teach nothing) and the event recorder's
 *    shown-vs-chosen bookkeeping (top vs override, unmapped).
 */

const mockEventCreate = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    gifiSuggestionEvent: {
      create: (...args: unknown[]) => mockEventCreate(...args),
    },
  },
}));

import { rankGifiSuggestions } from '@/lib/gifi-suggestions-v2';
import {
  aggregateGifiPatterns,
  buildGifiLearningContext,
  gifiNamePatterns,
  type GifiEventLike,
} from '@/lib/gifi-learning';
import { recordGifiSuggestionEvent, sanitizeShownCodes } from '@/lib/gifi-events-server';
import { hasGifiDecision, gifiDecisionError } from '@/lib/gifi-readiness';

const codes = (list: { code: string }[]) => list.map((s) => s.code);

function events(name: string, accountType: string, chosenCode: string, n: number): GifiEventLike[] {
  return Array.from({ length: n }, () => ({ accountName: name, accountType, chosenCode }));
}

// ── Ranking order, no learning ───────────────────────────────────────

describe('rankGifiSuggestions — ranking order (rules only)', () => {
  it('keeps v1 keyword order for rent, with descending scores', () => {
    const ranked = rankGifiSuggestions({ name: 'Office Rent', type: 'expense' });
    expect(codes(ranked)).toEqual(['8910', '8911', '8914']);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThan(ranked[2].score);
    for (const s of ranked) {
      expect(s.description).not.toBe('');
      expect(s.reason).not.toBe('');
    }
  });

  it('ranks a template twin first with the top base score', () => {
    const ranked = rankGifiSuggestions({ name: 'Insurance', type: 'expense' });
    expect(ranked[0].code).toBe('8690');
    expect(ranked[0].score).toBe(90);
    expect(ranked[0].signals).toContain('template');
  });

  it('keeps v1 keyword order for interest/bank charges', () => {
    const ranked = rankGifiSuggestions({ name: 'Bank Charges & Interest', type: 'expense' });
    expect(codes(ranked).slice(0, 2)).toEqual(['8710', '8715']);
  });
});

// ── Seed divergences (Nov 19, Muja) ──────────────────────────────────

describe('rankGifiSuggestions — the Nov 19 seed divergences', () => {
  it('distinct payable accounts no longer collapse onto generic 2620', () => {
    const holdbacks = rankGifiSuggestions({ name: 'Holdbacks Payable', type: 'liability' });
    const mgmtFees = rankGifiSuggestions({ name: 'Management Fees Payable', type: 'liability' });
    const bonuses = rankGifiSuggestions({ name: 'Bonuses Payable', type: 'liability' });

    // Each precise detail code outranks the general code…
    expect(holdbacks[0].code).toBe('2623');
    expect(mgmtFees[0].code).toBe('2625');
    expect(bonuses[0].code).toBe('2626');
    // …three distinct tops, not one collapsed code…
    expect(new Set([holdbacks[0].code, mgmtFees[0].code, bonuses[0].code]).size).toBe(3);
    // …and the general code is still on each list, with the precise
    // winner explaining why it beat it.
    for (const ranked of [holdbacks, mgmtFees, bonuses]) {
      expect(codes(ranked)).toContain('2620');
      expect(ranked[0].reason).toContain('2620');
      expect(ranked[0].signals).toContain('precise-child');
    }
  });

  it('a generic-only payable name keeps 2620 first but surfaces precise alternatives', () => {
    const ranked = rankGifiSuggestions({ name: 'Contractor Payable', type: 'liability' });
    expect(ranked[0].code).toBe('2620');
    // Detail codes under 2620 are present as consider-options.
    expect(codes(ranked)).toContain('2621');
    const child = ranked.find((s) => s.code === '2621');
    expect(child?.reason).toContain('2620');
  });

  it('chequing account (the 1010 pattern): 1002 first, 1001 Cash surfaced as the alternative', () => {
    const ranked = rankGifiSuggestions({ name: 'Business Checking', type: 'asset' });
    expect(ranked[0].code).toBe('1002');
    const cash = ranked.find((s) => s.code === '1001');
    expect(cash).toBeDefined();
    expect(cash?.alternative).toBe(true);
    expect(cash?.reason).toContain('Cash');
    expect(cash?.reason).toContain('Also consider');
  });
});

// ── Learning: per-company overrides ──────────────────────────────────

describe('rankGifiSuggestions — per-company override learning', () => {
  it('repeated company choices re-rank the pattern #1 with the "usually" reason', () => {
    const before = rankGifiSuggestions({ name: 'Contractor Payable', type: 'liability' });
    expect(before[0].code).toBe('2620');

    const learning = buildGifiLearningContext(events('Contractor Payable', 'liability', '2621', 3), []);
    const after = rankGifiSuggestions({ name: 'Contractor Payable', type: 'liability' }, learning);
    expect(after[0].code).toBe('2621');
    expect(after[0].reason).toBe('You usually code these as 2621 here');
    expect(after[0].signals).toContain('company-exact');
    expect(after[0].score).toBeGreaterThan(before.find((s) => s.code === '2621')?.score ?? 0);
  });

  it('learning generalizes across name variants of the same pattern (token level)', () => {
    const learning = buildGifiLearningContext(events('Contractor Payable', 'liability', '2621', 3), []);
    // Different exact name, same discriminating tokens once pluralized.
    const ranked = rankGifiSuggestions({ name: 'Contractor Payables', type: 'liability' }, learning);
    expect(ranked[0].code).toBe('2621');
    expect(ranked[0].signals).toContain('company-tokens');
  });

  it('a learned code joins the list even when the rules offer nothing', () => {
    expect(rankGifiSuggestions({ name: 'Miscellaneous Consulting', type: 'expense' })).toEqual([]);
    const learning = buildGifiLearningContext(events('Miscellaneous Consulting', 'expense', '8860', 2), []);
    const ranked = rankGifiSuggestions({ name: 'Miscellaneous Consulting', type: 'expense' }, learning);
    expect(codes(ranked)).toEqual(['8860']);
    expect(ranked[0].reason).toBe('You usually code these as 8860 here');
  });

  it('company learning for one account type does not leak into another', () => {
    const learning = buildGifiLearningContext(events('Contractor Payable', 'liability', '2621', 3), []);
    const ranked = rankGifiSuggestions({ name: 'Contractor Payable', type: 'expense' }, learning);
    expect(ranked.find((s) => s.code === '2621')).toBeUndefined();
  });
});

// ── Learning: global signal discipline ───────────────────────────────

describe('rankGifiSuggestions — global signal ranked below per-company', () => {
  it('company habit beats a stronger-count global habit for the same pattern', () => {
    const learning = buildGifiLearningContext(
      events('Contractor Payable', 'liability', '2621', 2),
      events('Contractor Payable', 'liability', '2622', 8),
    );
    const ranked = rankGifiSuggestions({ name: 'Contractor Payable', type: 'liability' }, learning);
    const companyPick = ranked.find((s) => s.code === '2621');
    const globalPick = ranked.find((s) => s.code === '2622');
    expect(companyPick).toBeDefined();
    expect(globalPick).toBeDefined();
    expect(companyPick!.score).toBeGreaterThan(globalPick!.score);
    expect(ranked.indexOf(companyPick!)).toBeLessThan(ranked.indexOf(globalPick!));
    // The headline reason on the company's code is the company's own.
    expect(companyPick!.reason).toBe('You usually code these as 2621 here');
    expect(globalPick!.reason).toBe('Other companies usually code these as 2622');
  });

  it('a global-only signal still applies, with its own reason', () => {
    const learning = buildGifiLearningContext([], events('Contractor Payable', 'liability', '2622', 5));
    const ranked = rankGifiSuggestions({ name: 'Contractor Payable', type: 'liability' }, learning);
    const globalPick = ranked.find((s) => s.code === '2622');
    expect(globalPick).toBeDefined();
    expect(globalPick!.reason).toBe('Other companies usually code these as 2622');
    expect(globalPick!.signals.some((s) => s.startsWith('global-'))).toBe(true);
  });
});

// ── Restraint parity with v1 ─────────────────────────────────────────

describe('rankGifiSuggestions — restraint (v1 parity)', () => {
  it('design-exempt accounts get nothing, even with learning', () => {
    const learning = buildGifiLearningContext(events('Retained Earnings', 'equity', '3840', 4), []);
    expect(rankGifiSuggestions({ name: 'Retained Earnings', type: 'equity' }, learning)).toEqual([]);
    expect(rankGifiSuggestions({ name: 'Opening Balance Equity', type: 'equity' }, learning)).toEqual([]);
  });

  it('an account already carrying a valid code gets nothing', () => {
    expect(rankGifiSuggestions({ name: 'Insurance', type: 'expense', gifiCode: '8690' })).toEqual([]);
  });

  it('an empty name gets nothing', () => {
    expect(rankGifiSuggestions({ name: '  ', type: 'expense' })).toEqual([]);
  });
});

// ── Patterns & aggregation ───────────────────────────────────────────

describe('gifi learning patterns', () => {
  it('token pattern is stemmed, sorted, stopword-free', () => {
    expect(gifiNamePatterns('Wages Payable').tokens).toBe('payable|wage');
    expect(gifiNamePatterns('The Accounts Payable').tokens).toBe('payable');
    expect(gifiNamePatterns('Business Checking').exact).toBe('business checking');
  });

  it('aggregation counts both levels and skips unchosen events', () => {
    const stats = aggregateGifiPatterns([
      ...events('Wages Payable', 'liability', '2624', 2),
      { accountName: 'Wages Payable', accountType: 'liability', chosenCode: null },
    ]);
    const exact = stats.find((s) => s.level === 'exact' && s.chosenCode === '2624');
    const tokens = stats.find((s) => s.level === 'tokens' && s.chosenCode === '2624');
    expect(exact?.count).toBe(2);
    expect(tokens?.count).toBe(2);
    expect(stats.every((s) => s.chosenCode === '2624')).toBe(true);
  });
});

// ── Event recording ──────────────────────────────────────────────────

describe('suggestion event recording', () => {
  beforeEach(() => {
    mockEventCreate.mockReset();
    mockEventCreate.mockResolvedValue({});
  });

  it('sanitizes the client-reported shown list', () => {
    expect(sanitizeShownCodes(['2620', '2621', '2620', 'abc', 42, ' 2624 '])).toEqual(['2620', '2621', '2624']);
    expect(sanitizeShownCodes('nope')).toEqual([]);
    expect(sanitizeShownCodes(undefined)).toEqual([]);
  });

  it('records top-suggestion acceptance vs override vs unmapped', async () => {
    await recordGifiSuggestionEvent({
      companyId: 'c1', accountName: 'Wages Payable', accountType: 'liability',
      shownCodes: ['2624', '2620'], chosenCode: '2624',
    });
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ wasTopSuggestion: true, wasOverride: false, chosenCode: '2624' }),
    });

    mockEventCreate.mockClear();
    await recordGifiSuggestionEvent({
      companyId: 'c1', accountName: 'Wages Payable', accountType: 'liability',
      shownCodes: ['2624', '2620'], chosenCode: '2620',
    });
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ wasTopSuggestion: false, wasOverride: true, chosenCode: '2620' }),
    });

    mockEventCreate.mockClear();
    await recordGifiSuggestionEvent({
      companyId: 'c1', accountName: 'Wages Payable', accountType: 'liability',
      shownCodes: ['2624', '2620'], chosenCode: null,
    });
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ wasTopSuggestion: false, wasOverride: false, chosenCode: null }),
    });
  });

  it('stores the anonymized patterns alongside the event', async () => {
    await recordGifiSuggestionEvent({
      companyId: 'c1', accountName: 'Wages Payable', accountType: 'liability',
      shownCodes: ['2624'], chosenCode: '2624',
    });
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ patternExact: 'wages payable', patternTokens: 'payable|wage' }),
    });
  });

  it('never throws when the write fails — recording cannot block a save', async () => {
    mockEventCreate.mockRejectedValue(new Error('db down'));
    await expect(
      recordGifiSuggestionEvent({
        companyId: 'c1', accountName: 'Wages Payable', accountType: 'liability',
        shownCodes: ['2624'], chosenCode: '2624',
      }),
    ).resolves.toBe(false);
  });

  it('writes nothing when nothing was shown', async () => {
    await expect(
      recordGifiSuggestionEvent({
        companyId: 'c1', accountName: 'Wages Payable', accountType: 'liability',
        shownCodes: [], chosenCode: '2624',
      }),
    ).resolves.toBe(false);
    expect(mockEventCreate).not.toHaveBeenCalled();
  });
});

// ── Phase 1 decision predicate — unchanged ───────────────────────────

describe('Phase 1 decision predicate (regression spot-check)', () => {
  it('hasGifiDecision / gifiDecisionError behave exactly as Phase 1 specified', () => {
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: '8690' })).toBe(true);
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: null })).toBe(false);
    expect(
      hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: null, gifiUnmappedByChoice: true }),
    ).toBe(true);
    expect(hasGifiDecision({ name: 'Retained Earnings', type: 'equity', gifiCode: null })).toBe(true);
    expect(gifiDecisionError({ name: 'Insurance', type: 'expense', gifiCode: null })).not.toBeNull();
    expect(gifiDecisionError({ name: 'Insurance', type: 'expense', gifiCode: '8690' })).toBeNull();
  });
});
