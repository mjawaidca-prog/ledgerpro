/**
 * Pure-logic tests for the banking overhaul — no DB, no mocks. Fixture-driven
 * with the design prototype's numbers (RBC statement, 148 rows, 6 duplicates,
 * 1 locked, cheque 1184, unrecorded charge 84.50, GST backout 5.64, split
 * 1,284.50, reconciliation out-by 3,493.26).
 */

import {
  normalizeDescription,
  makeDedupeKey,
  classifyDuplicates,
  daysBetweenIso,
} from '@/lib/banking/dedupe';
import { guessPayee, resolveContact, titleCasePayee } from '@/lib/banking/payee';
import { ruleMatches, applyRules, type BankRuleLike } from '@/lib/banking/rules';
import {
  inclusiveTaxAmount,
  netOfInclusiveTax,
  allocation,
  computeSplitTaxes,
  buildPostingLines,
  round2,
} from '@/lib/banking/splits';
import {
  ledgerBalanceFor,
  reconcileVerdict,
  nextLockedThrough,
  rolledBackLockedThrough,
} from '@/lib/banking/reconcile-math';

// ── Dedupe ───────────────────────────────────────────────────

const R = (date: string, amount: number, description: string) => ({ date, amount, description });

describe('dedupe — keys', () => {
  it('is stable and normalizes case/whitespace', () => {
    expect(makeDedupeKey({ date: '2026-08-14', amount: 118.4, description: 'PETRO-CANADA #4412' }))
      .toBe(makeDedupeKey({ date: '2026-08-14', amount: 118.4, description: '  petro-canada   #4412 ' }));
  });

  it('FITID beats the content key', () => {
    const a = makeDedupeKey({ date: '2026-08-14', amount: 100, description: 'X', fitid: 'FIT-1' });
    const b = makeDedupeKey({ date: '2026-08-14', amount: 100, description: 'X', fitid: 'FIT-1' });
    const c = makeDedupeKey({ date: '2026-08-14', amount: 100, description: 'X' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('dedupe — classification', () => {
  it('exact match default-skips against posted AND pending rows', () => {
    const existing = [R('2026-08-13', -24.95, 'MONTHLY PLAN FEE')];
    const flagged = classifyDuplicates({
      rows: [R('2026-08-13', -24.95, 'MONTHLY PLAN FEE')],
      existing,
      lockedThrough: null,
    });
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toBe('exact');
    expect(flagged[0].skip).toBe(true);
  });

  it('flags a row duplicated earlier in the SAME file', () => {
    const flagged = classifyDuplicates({
      rows: [R('2026-08-13', -24.95, 'MONTHLY PLAN FEE'), R('2026-08-13', -24.95, 'monthly plan fee')],
      existing: [],
      lockedThrough: null,
    });
    expect(flagged).toHaveLength(1);
    expect(flagged[0].rowIndex).toBe(1);
    expect(flagged[0].reason).toBe('exact');
  });

  it('same amount within ±3 days default-keeps (never auto-skips)', () => {
    const flagged = classifyDuplicates({
      rows: [R('2026-08-14', 4520.0, 'E-TRANSFER RECEIVED BRIGHTLINE STU')],
      existing: [R('2026-08-12', 4520.0, 'E-TRANSFER RECEIVED BRIGHTLINE STU')],
      lockedThrough: null,
    });
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toBe('same_amount');
    expect(flagged[0].skip).toBe(false);
  });

  it('does not flag outside the 3-day window', () => {
    const flagged = classifyDuplicates({
      rows: [R('2026-08-14', 4520.0, 'E-TRANSFER RECEIVED BRIGHTLINE STU')],
      existing: [R('2026-08-01', 4520.0, 'E-TRANSFER RECEIVED BRIGHTLINE STU')],
      lockedThrough: null,
    });
    expect(flagged).toHaveLength(0);
  });

  it('locked-period rows are always skipped and checked before everything', () => {
    const flagged = classifyDuplicates({
      rows: [R('2026-06-08', -212.66, 'INTERAC PURCHASE — STAPLES')],
      existing: [R('2026-06-08', -212.66, 'INTERAC PURCHASE — STAPLES')],
      lockedThrough: '2026-06-30',
    });
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reason).toBe('locked_period');
    expect(flagged[0].skip).toBe(true);
  });

  it('same-amount matching uses the normalized description', () => {
    expect(normalizeDescription('  petro-canada   #4412  ')).toBe('PETRO-CANADA #4412');
    expect(daysBetweenIso('2026-08-12', '2026-08-14')).toBe(2);
  });
});

// ── Payee ────────────────────────────────────────────────────

describe('payee guessing', () => {
  it('PETRO-CANADA #4412 CALGARY AB → Petro-Canada', () => {
    expect(guessPayee('PETRO-CANADA #4412 CALGARY AB')).toBe('Petro-Canada');
  });

  it('E-TRANSFER RECEIVED BRIGHTLINE STU → Brightline Stu', () => {
    expect(guessPayee('E-TRANSFER RECEIVED BRIGHTLINE STU')).toBe('Brightline Stu');
  });

  it('bank-charge and payroll rows are not payees', () => {
    expect(guessPayee('MONTHLY PLAN FEE')).toBeNull();
    expect(guessPayee('PAYROLL DEPOSIT NEXVAR')).toBeNull();
  });

  it('resolves the guess to the contact name', () => {
    const contacts = [{ id: 'c1', name: 'Brightline Studio' }];
    const hit = resolveContact('Brightline Stu', contacts);
    expect(hit).toEqual({ id: 'c1', name: 'Brightline Studio' });
    expect(resolveContact('Nobody Inc', contacts)).toBeNull();
  });

  it('title-cases', () => {
    expect(titleCasePayee('BRIGHTLINE STUDIO')).toBe('Brightline Studio');
  });
});

// ── Rules ────────────────────────────────────────────────────

const rule = (over: Partial<BankRuleLike>): BankRuleLike => ({
  id: 'r1',
  name: 'Test',
  order: 0,
  op: 'contains',
  value: 'PETRO-CANADA',
  anyOf: [],
  scope: { accountIds: 'all', direction: 'both' },
  setCategoryCode: '6120',
  setTaxCode: null,
  setTaxRate: null,
  setTaxInclusive: true,
  setContactId: null,
  autoPost: false,
  enabled: true,
  ...over,
});

describe('rules', () => {
  it('contains / is / starts_with semantics', () => {
    expect(ruleMatches(rule({}), { description: 'PETRO-CANADA #4412 CALGARY AB', amount: -118.4, accountId: 'a1' })).toBe(true);
    expect(ruleMatches(rule({ op: 'is', value: 'MONTHLY PLAN FEE' }), { description: 'MONTHLY PLAN FEE', amount: -24.95, accountId: 'a1' })).toBe(true);
    expect(ruleMatches(rule({ op: 'starts_with', value: 'SHOPIFY' }), { description: 'SHOPIFY PAYOUT 4482', amount: 500, accountId: 'a1' })).toBe(true);
    expect(ruleMatches(rule({}), { description: 'SHELL GAS', amount: -60, accountId: 'a1' })).toBe(false);
  });

  it('anyOf acts as OR', () => {
    expect(ruleMatches(rule({ anyOf: ['SHELL'] }), { description: 'SHELL 4421', amount: -60, accountId: 'a1' })).toBe(true);
  });

  it('direction scope filters', () => {
    const outOnly = rule({ scope: { accountIds: 'all', direction: 'out' } });
    expect(ruleMatches(outOnly, { description: 'PETRO-CANADA', amount: -100, accountId: 'a1' })).toBe(true);
    expect(ruleMatches(outOnly, { description: 'PETRO-CANADA REFUND', amount: 100, accountId: 'a1' })).toBe(false);
  });

  it('account scope filters', () => {
    const scoped = rule({ scope: { accountIds: ['a1'], direction: 'both' } });
    expect(ruleMatches(scoped, { description: 'PETRO-CANADA', amount: -100, accountId: 'a2' })).toBe(false);
  });

  it('first-match-wins by order; disabled rules skip; leave-for-matching still hits', () => {
    const rules: BankRuleLike[] = [
      rule({ id: 'first', order: 1, value: 'PETRO' }),
      rule({ id: 'second', order: 2, value: 'PETRO', setCategoryCode: null }),
      rule({ id: 'disabled', order: 0, value: 'PETRO', enabled: false }),
    ];
    const hit = applyRules(rules, { description: 'PETRO-CANADA', amount: -100, accountId: 'a1' });
    expect(hit?.rule.id).toBe('first');
    expect(hit?.categoryCode).toBe('6120');

    const leave = applyRules([rules[1]], { description: 'PETRO-CANADA', amount: -100, accountId: 'a1' });
    expect(leave?.categoryCode).toBeNull();
    expect(leave?.rule.id).toBe('second');
  });
});

// ── Splits & tax ─────────────────────────────────────────────

describe('splits & tax', () => {
  it('inclusive tax backout: 118.40 @ 5% → 5.64 tax, 112.76 net', () => {
    expect(inclusiveTaxAmount(118.4, 5)).toBe(5.64);
    expect(netOfInclusiveTax(118.4, 5)).toBe(112.76);
  });

  it('13% split fixture: 44.24 + 103.54', () => {
    const computed = computeSplitTaxes([
      { categoryCode: '6140', amount: 384.5, taxCode: 'GST/HST 13% (included)', taxRate: 13, taxInclusive: true },
      { categoryCode: '1600', amount: 900.0, taxCode: 'GST/HST 13% (included)', taxRate: 13, taxInclusive: true },
    ]);
    // README formula: 384.50 − 384.50/1.13 = 44.2345 → 44.23 (the prototype's
    // 44.24 is off by a cent; its own total still ties either way).
    expect(computed[0].taxAmount).toBe(44.23);
    expect(computed[1].taxAmount).toBe(103.54);
    // total ties: 384.50 + 900.00 = nets + taxes
    const total = computed.reduce((s, c) => s + c.net + c.taxAmount, 0);
    expect(round2(total)).toBe(1284.5);
  });

  it('allocation: 1,284.50 across 384.50 + 900.00 → remainder 0.00', () => {
    const a = allocation([{ amount: 384.5 }, { amount: 900.0 }], 1284.5);
    expect(a.allocated).toBe(1284.5);
    expect(a.remainder).toBe(0.0);
    expect(allocation([{ amount: 384.5 }], 1284.5).remainder).toBe(900.0);
  });

  it('last split absorbs rounding drift', () => {
    const computed = computeSplitTaxes([
      { categoryCode: '6140', amount: 100.01, taxCode: null, taxRate: 13, taxInclusive: true },
      { categoryCode: '1600', amount: 200.02, taxCode: null, taxRate: 13, taxInclusive: true },
    ]);
    const total = computed.reduce((s, c) => s + c.net + c.taxAmount, 0);
    expect(Math.abs(round2(total) - 300.03)).toBeLessThan(0.005);
  });

  it('buildPostingLines balances to the cent for outflows and inflows', () => {
    const outLines = buildPostingLines({
      splits: [{ categoryCode: '6140', net: 384.5, taxAmount: 0, taxCode: null }],
      direction: 'out',
      bankAccountCode: '1010',
      total: 384.5,
      description: 'TEST',
    });
    const d = outLines.reduce((s, l) => s + l.debit, 0);
    const c = outLines.reduce((s, l) => s + l.credit, 0);
    expect(Math.abs(d - c)).toBeLessThan(0.005);

    const inLines = buildPostingLines({
      splits: [{ categoryCode: '4010', net: 1000, taxAmount: 50, taxCode: 'GST' }],
      direction: 'in',
      bankAccountCode: '1010',
      total: 1050,
      description: 'TEST IN',
      currency: 'USD',
      fxRate: 1.36,
      amountForeign: 1050,
    });
    const d2 = inLines.reduce((s, l) => s + l.debit, 0);
    const c2 = inLines.reduce((s, l) => s + l.credit, 0);
    expect(Math.abs(d2 - c2)).toBeLessThan(0.005);
    expect(inLines.find((l) => l.glAccountCode === '1010')?.debitForeign).toBe(1050);
  });
});

// ── Reconciliation math ──────────────────────────────────────

describe('reconciliation math', () => {
  // Prototype fixture: 6 rows. opening = 84,210.55 − Σ(6 ticked) = 89,970.87
  const tickedAll = [12840.0, -18402.11, -3408.76, -1284.5, 4520.0, -24.95];
  const opening = 89970.87;

  it('all ticked → in balance 0.00', () => {
    const v = reconcileVerdict({
      statementClosingBalance: 84210.55,
      openingReconciledBalance: opening,
      tickedAmounts: tickedAll,
      unticked: [],
      unrecordedItems: [],
    });
    expect(v.ledgerBalance).toBe(84210.55);
    expect(v.inBalance).toBe(true);
    expect(v.difference).toBe(0);
  });

  it('untick cheque 1,184 + unrecorded charge 84.50 → out by 3,493.26 with both causes', () => {
    const ticked = tickedAll.filter((a) => a !== -3408.76);
    const v = reconcileVerdict({
      statementClosingBalance: 84210.55,
      openingReconciledBalance: opening,
      tickedAmounts: ticked,
      unticked: [{ description: 'cheque 1184', amount: -3408.76 }],
      unrecordedItems: [{ description: 'bank charge', amount: 84.5 }],
    });
    expect(v.ledgerBalance).toBe(87703.81);
    expect(v.difference).toBe(-3493.26);
    expect(v.inBalance).toBe(false);
    expect(v.causes).toHaveLength(2);
    expect(v.causes[0]).toContain('cheque 1184');
    expect(v.causes[0]).toContain('3,408.76');
    expect(v.causes[1]).toContain('84.50');
  });

  it('ledgerBalanceFor sums opening + ticked + unrecorded', () => {
    expect(ledgerBalanceFor({ openingReconciledBalance: 100, tickedAmounts: [50, -30], unrecordedItems: [{ amount: 10 }] })).toBe(130);
  });

  it('lock advances monotonically and rolls back on reopen', () => {
    expect(nextLockedThrough(null, '2026-08-31')).toBe('2026-08-31');
    expect(nextLockedThrough('2026-08-31', '2026-07-31')).toBe('2026-08-31'); // never regresses
    expect(nextLockedThrough('2026-07-31', '2026-08-31')).toBe('2026-08-31');
    expect(rolledBackLockedThrough('2026-08-31', '2026-07-31')).toBe('2026-07-31');
    expect(rolledBackLockedThrough('2026-08-31', null)).toBeNull();
  });
});
