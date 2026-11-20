/**
 * GIFI-at-creation (LedgerPro improvement plan, Phase 1 item 1;
 * design §2.1): no account saves without a GIFI DECISION.
 *
 * Covered here:
 *  - the decision predicate shared by the account forms and the
 *    POST/PUT /api/coa routes (hasGifiDecision / gifiDecisionError):
 *    a valid code decides; the recorded "leave unmapped" choice
 *    decides; the D2 design exemptions (Retained Earnings, Opening
 *    Balance Equity, Owner's Capital / Owner's Draw) are decided by
 *    design; a blank or a legacy invalid value decides NOTHING;
 *  - readiness: a deliberately-unmapped account leaves the worklist
 *    and the count, and is reported as decidedUnmapped — while an
 *    undecided account stays on the worklist exactly as before;
 *  - the export checklist no longer fires for decided accounts;
 *  - the suggestion the form leads with carries a code, the official
 *    description, and a plain-language reason (the [Use NNNN] data);
 *  - mixed-account detection: a combined loan-payment name (Muja's
 *    "Motor Vehicle — Ford Credit Payments") gets the split-it
 *    notice, ordinary accounts get none.
 */

import {
  computeGifiReadiness,
  gifiDecisionError,
  gifiExportChecklist,
  hasGifiDecision,
  type GifiReadinessAccountInput,
} from '@/lib/gifi-readiness';
import { mixedGifiAccountNotice, suggestGifiCodes } from '@/lib/gifi-suggestions';

// ── The decision predicate ───────────────────────────────────────────

describe('hasGifiDecision', () => {
  it('a valid code is a decision', () => {
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: '8690' })).toBe(true);
  });

  it('the recorded leave-unmapped choice is a decision', () => {
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: null, gifiUnmappedByChoice: true })).toBe(true);
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: '', gifiUnmappedByChoice: true })).toBe(true);
  });

  it('a blank with no choice is NOT a decision (the old silent default)', () => {
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: null })).toBe(false);
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: '' })).toBe(false);
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense' })).toBe(false);
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: null, gifiUnmappedByChoice: false })).toBe(false);
  });

  it('a legacy invalid stored value is NOT a decision — it must be fixed or deliberately left', () => {
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: '87l0' })).toBe(false);
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: '2599' })).toBe(false);
    // …but the deliberate choice covers it (choosing it clears the value).
    expect(hasGifiDecision({ name: 'Insurance', type: 'expense', gifiCode: '87l0', gifiUnmappedByChoice: true })).toBe(true);
  });

  it('the D2 design exemptions are decided by design, with no code and no flag', () => {
    for (const account of [
      { name: 'Retained Earnings', type: 'equity' },
      { name: 'Retained Earnings', type: 'equity', subType: 'retained_earnings' },
      { name: 'Opening Balance Equity', type: 'equity' },
      { name: 'Opening Balance Equity', type: 'equity', detailType: 'Opening balance offset' },
      { name: "Owner's Capital", type: 'equity' },
      { name: "Owner's Draw", type: 'equity' },
    ]) {
      expect(hasGifiDecision({ ...account, gifiCode: null })).toBe(true);
    }
  });

  it('near-miss names are not exempt (only the real D2 accounts are)', () => {
    expect(hasGifiDecision({ name: 'Retained Earnings Reserve', type: 'equity', gifiCode: null })).toBe(false);
    expect(hasGifiDecision({ name: 'Capital Projects', type: 'expense', gifiCode: null })).toBe(false);
  });
});

describe('gifiDecisionError', () => {
  it('is null when a decision exists and names both ways to decide when not', () => {
    expect(gifiDecisionError({ name: 'Insurance', type: 'expense', gifiCode: '8690' })).toBeNull();
    expect(gifiDecisionError({ name: 'Retained Earnings', type: 'equity', gifiCode: null })).toBeNull();
    const err = gifiDecisionError({ name: 'Insurance', type: 'expense', gifiCode: null });
    expect(err).toMatch(/GIFI code/);
    expect(err).toMatch(/Leave unmapped/);
  });
});

// ── Readiness: decided accounts leave the worklist ───────────────────

describe('computeGifiReadiness — deliberate unmapped', () => {
  const chart: GifiReadinessAccountInput[] = [
    { id: 'c1', code: '6910', name: 'Insurance', type: 'expense', gifiCode: '8690', active: true },
    { id: 'c2', code: '6990', name: 'Miscellaneous Expense', type: 'expense', gifiCode: null, gifiUnmappedByChoice: true, active: true },
    { id: 'c3', code: '6150', name: 'Consulting Fees', type: 'expense', gifiCode: null, active: true },
    { id: 'c4', code: '5410', name: 'Motor Vehicle — Ford Credit Payments', type: 'expense', gifiCode: null, gifiUnmappedByChoice: true, active: true },
    { id: 'c5', code: '7000', name: 'Dormant Decided', type: 'expense', gifiCode: null, gifiUnmappedByChoice: true, active: false },
  ];

  it('excludes decided-unmapped accounts from the count and the worklist, and reports them separately', () => {
    const r = computeGifiReadiness(chart);
    expect(r.total).toBe(2); // Insurance + Consulting Fees only
    expect(r.coded).toBe(1);
    expect(r.needsCode.map((a) => a.code)).toEqual(['6150']);
    expect(r.decidedUnmapped.map((a) => a.code)).toEqual(['6990', '5410']);
  });

  it('a coded account with a stale flag still counts as coded (the code wins)', () => {
    const r = computeGifiReadiness([
      { id: 'x1', code: '6910', name: 'Insurance', type: 'expense', gifiCode: '8690', gifiUnmappedByChoice: true, active: true },
    ]);
    expect(r.total).toBe(1);
    expect(r.coded).toBe(1);
    expect(r.decidedUnmapped).toEqual([]);
  });

  it('rows without the flag behave exactly as before (decidedUnmapped is empty)', () => {
    const r = computeGifiReadiness([
      { id: 'y1', code: '6990', name: 'Miscellaneous Expense', type: 'expense', gifiCode: null, active: true },
    ]);
    expect(r.total).toBe(1);
    expect(r.needsCode.map((a) => a.code)).toEqual(['6990']);
    expect(r.decidedUnmapped).toEqual([]);
  });

  it('the export checklist stays quiet when the only uncoded accounts are decided', () => {
    const decidedOnly: GifiReadinessAccountInput[] = [
      { code: '6990', name: 'Miscellaneous Expense', type: 'expense', gifiCode: null, gifiUnmappedByChoice: true, active: true },
    ];
    expect(gifiExportChecklist(decidedOnly, 'corporation').show).toBe(false);
    const withUndecided = [...decidedOnly, chart[2]];
    expect(gifiExportChecklist(withUndecided, 'corporation').show).toBe(true);
  });
});

// ── The suggestion the form leads with ───────────────────────────────

describe('the form suggestion (one-tap [Use NNNN] data)', () => {
  it('carries a code, the official description, and a plain-language reason', () => {
    const [top] = suggestGifiCodes({ name: 'Repairs', type: 'expense' });
    expect(top.code).toBe('8960');
    expect(top.description).toBe('Repairs and maintenance');
    expect(top.reason.length).toBeGreaterThan(0);
  });

  it('is offered for an undecided account and withdrawn once a code is chosen', () => {
    expect(suggestGifiCodes({ name: 'Insurance', type: 'expense', gifiCode: null }).length).toBeGreaterThan(0);
    expect(suggestGifiCodes({ name: 'Insurance', type: 'expense', gifiCode: '8690' })).toEqual([]);
  });
});

// ── Mixed-account detection (design §2.1 point 4) ────────────────────

describe('mixedGifiAccountNotice', () => {
  it('flags the Muja case: a combined vehicle-loan payment account', () => {
    const notice = mixedGifiAccountNotice({ name: 'Motor Vehicle — Ford Credit Payments' });
    expect(notice).not.toBeNull();
    expect(notice).toMatch(/principal/);
    expect(notice).toMatch(/split/i);
  });

  it('flags plain loan-payment names', () => {
    expect(mixedGifiAccountNotice({ name: 'Loan Payments' })).not.toBeNull();
    expect(mixedGifiAccountNotice({ name: 'Equipment Financing Payment' })).not.toBeNull();
    expect(mixedGifiAccountNotice({ name: 'Mortgage Payment' })).not.toBeNull();
  });

  it('stays silent for ordinary accounts', () => {
    for (const name of ['Insurance', 'Accounts Payable', 'Credit Cards', 'Loans Payable', 'Interest Expense', 'Bank Fees', '']) {
      expect(mixedGifiAccountNotice({ name })).toBeNull();
    }
  });
});
