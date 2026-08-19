/**
 * Pure-logic tests for the FX engine — no DB, no mocks. Mirrors the style of
 * critical-flows/consolidation: arithmetic assertions only. Rate-resolution
 * precedence, formatters and the settlement/revaluation math use the design
 * prototype's fixture numbers.
 */

import { chooseRateRow, daysBetween, deviationPct } from '@/lib/fx/rate';
import { N, SIGNED, approx, rateChipStrings, rateDateNote, inverseRate, isZeroDecimal } from '@/lib/fx-format';

// ── Rate precedence (pure tie-break) ─────────────────────────

const D = (s: string) => new Date(s + 'T00:00:00Z');
const row = (date: string, source: 'feed' | 'manual', id = 'x') => ({ date: D(date), rate: 1.36, id, source });

describe('chooseRateRow', () => {
  it('picks the latest date', () => {
    const r = chooseRateRow([row('2026-08-14', 'feed'), row('2026-08-15', 'feed')]);
    expect(r!.date.toISOString().slice(0, 10)).toBe('2026-08-15');
  });

  it('prefers manual on a same-date tie', () => {
    const r = chooseRateRow([row('2026-08-19', 'feed'), row('2026-08-19', 'manual')]);
    expect(r!.source).toBe('manual');
  });

  it('returns null for an empty list', () => {
    expect(chooseRateRow([])).toBeNull();
  });
});

describe('deviationPct / daysBetween', () => {
  it('flags a 10x typo (13.82 vs 1.382)', () => {
    expect(deviationPct(13.82, 1.382)).toBeCloseTo(900, 0);
  });

  it('flags a normal drift under 10%', () => {
    expect(deviationPct(1.382, 1.36)).toBeLessThan(10);
  });

  it('counts calendar days between rate and document date', () => {
    expect(daysBetween('2026-08-15', '2026-08-19')).toBe(4);
  });
});

// ── Formatters ───────────────────────────────────────────────

describe('formatters', () => {
  it('N() renders negatives in parentheses and nil as em dash', () => {
    expect(N(9438.4)).toBe('9,438.40');
    expect(N(-130.47)).toBe('-130.47');
    expect(N(0)).toBe('—');
    expect(N(null)).toBe('—');
  });

  it('N() honours zero-decimal foreign currencies', () => {
    expect(N(6940, { zeroDecimals: true })).toBe('6,940');
  });

  it('SIGNED() uses + and U+2212 minus', () => {
    expect(SIGNED(152.68)).toBe('+152.68');
    expect(SIGNED(-130.47)).toBe('−130.47');
  });

  it('approx() prefixes the derived home equivalent', () => {
    expect(approx(9438.4, 'CAD')).toBe('≈ 9,438.40 CAD');
  });

  it('rate chip strings give primary + inverse', () => {
    const { primary, inverse } = rateChipStrings(1.382, 'USD', 'CAD');
    expect(primary).toBe('1 USD = 1.3820 CAD');
    expect(inverse).toBe('1 CAD = 0.7236 USD');
  });

  it('inverse of a missing rate renders the awaiting copy', () => {
    expect(inverseRate(null)).toBe('awaiting a rate');
    expect(inverseRate(2)).toBe('0.5000');
  });

  it('rateDateNote renders provenance', () => {
    expect(rateDateNote(1.36, '2026-08-19')).toBe('at 1.3600 on 2026-08-19');
    expect(rateDateNote(null, null)).toBe('enter a rate to calculate');
  });

  it('JPY/INR are zero-decimal', () => {
    expect(isZeroDecimal('JPY')).toBe(true);
    expect(isZeroDecimal('USD')).toBe(false);
  });
});

// ── Settlement math (prototype fixtures) ─────────────────────

import { computeSettlement, journalLinesForPayment } from '@/lib/fx/settlement';

describe('computeSettlement — receivables', () => {
  const base = { remainingForeign: 6940, remainingHome: 9438.4 };

  it('gain: 6,940 USD @ invoice 1.3600 paid at 1.3820 → +152.68', () => {
    const c = computeSettlement({ amountForeign: 6940, invoiceRate: 1.36, settlementRate: 1.382, ...base });
    expect(c.cashHome).toBe(9591.08);
    expect(c.reliefHome).toBe(9438.4);
    expect(c.fxDifference).toBe(152.68);
    expect(c.outcome).toBe('gain');
  });

  it('loss: 6,940 USD paid at 1.3412 → −130.47 (README 453.28 is stale)', () => {
    const c = computeSettlement({ amountForeign: 6940, invoiceRate: 1.36, settlementRate: 1.3412, ...base });
    expect(c.cashHome).toBe(9307.93);
    expect(c.fxDifference).toBe(-130.47);
    expect(c.outcome).toBe('loss');
  });

  it('partial: 3,000 of 6,940 at 1.3820 → +66.00, remainder keeps the invoice rate', () => {
    const c = computeSettlement({ amountForeign: 3000, invoiceRate: 1.36, settlementRate: 1.382, ...base });
    expect(c.cashHome).toBe(4146.0);
    expect(c.reliefHome).toBe(4080.0);
    expect(c.fxDifference).toBe(66.0);
    expect(c.remainingForeign).toBe(3940.0);
    expect(c.remainingHome).toBe(5358.4); // 9,438.40 − 4,080.00 at the original rate
  });

  it('no movement: same rate → outcome none, no FX line', () => {
    const c = computeSettlement({ amountForeign: 6940, invoiceRate: 1.36, settlementRate: 1.36, ...base });
    expect(c.fxDifference).toBe(0);
    expect(c.outcome).toBe('none');
  });
});

describe('computeSettlement — payables (sign flip)', () => {
  it('a higher closing rate is a LOSS on a payable', () => {
    // Bill 2,480 USD @ 1.3745 (carried 3,408.76 CAD) paid at 1.3805 → cash 3,423.64.
    const c = computeSettlement({
      amountForeign: 2480, invoiceRate: 1.3745, settlementRate: 1.3805,
      remainingForeign: 2480, remainingHome: 3408.76, isPayable: true,
    });
    expect(c.cashHome).toBe(3423.64);
    expect(c.reliefHome).toBe(3408.76);
    expect(c.fxDifference).toBe(-14.88); // relief − cash
    expect(c.outcome).toBe('loss');
  });
});

describe('journalLinesForPayment', () => {
  it('gain journal matches the prototype: DR 1015 9,591.08 / CR 1100 9,438.40 / CR 4310 152.68', () => {
    const c = computeSettlement({ amountForeign: 6940, invoiceRate: 1.36, settlementRate: 1.382, remainingForeign: 6940, remainingHome: 9438.4 });
    const lines = journalLinesForPayment(c, {
      cashAccountCode: '1015', receivableAccountCode: '1100', fxAccountCode: '4310',
      roundingAccountCode: '4390', documentId: 'INV-1042', counterpartyName: 'Atlas Logistics', currency: 'USD',
    });
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(9591.08);
    expect(totalCredit).toBe(9591.08);
    expect(lines.find((l) => l.glAccountCode === '4310')?.credit).toBe(152.68);
    expect(lines.find((l) => l.glAccountCode === '1100')?.creditForeign).toBe(6940);
  });

  it('no-movement journal drops the FX line entirely', () => {
    const c = computeSettlement({ amountForeign: 6940, invoiceRate: 1.36, settlementRate: 1.36, remainingForeign: 6940, remainingHome: 9438.4 });
    const lines = journalLinesForPayment(c, {
      cashAccountCode: '1015', receivableAccountCode: '1100', fxAccountCode: '4310',
      roundingAccountCode: '4390', documentId: 'INV-1042', counterpartyName: 'Atlas Logistics', currency: 'USD',
    });
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.glAccountCode === '4310')).toBe(false);
  });

  it('every journal balances to the cent', () => {
    for (const [sr, ir] of [[1.382, 1.36], [1.3412, 1.36], [1.3873, 1.36], [1.36, 1.36]]) {
      const c = computeSettlement({ amountForeign: 6940, invoiceRate: ir, settlementRate: sr, remainingForeign: 6940, remainingHome: 9438.4 });
      const lines = journalLinesForPayment(c, {
        cashAccountCode: '1015', receivableAccountCode: '1100', fxAccountCode: '4310',
        roundingAccountCode: '4390', documentId: 'INV-1042', counterpartyName: 'A', currency: 'USD',
      });
      const d = lines.reduce((s, l) => s + l.debit, 0);
      const c2 = lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.abs(d - c2)).toBeLessThan(0.005);
    }
  });
});

// ── Revaluation math (prototype fixtures) ───────────────────

import { isMonetaryAccount, buildRevaluationRows, revaluationJournalLines } from '@/lib/fx/revaluation';

describe('isMonetaryAccount', () => {
  it('includes cash/AR/AP/FX loans', () => {
    expect(isMonetaryAccount({ code: '1015', name: 'USD Chequing', type: 'asset', subType: 'current_asset', detailType: 'Bank' })).toBe(true);
    expect(isMonetaryAccount({ code: '1100', name: 'AR', type: 'asset', subType: 'current_asset', detailType: 'Accounts receivable' })).toBe(true);
    expect(isMonetaryAccount({ code: '2200', name: 'AP', type: 'liability', subType: 'current_liability', detailType: 'Accounts payable' })).toBe(true);
    expect(isMonetaryAccount({ code: '2500', name: 'Loans', type: 'liability', subType: 'long_term_liability', detailType: 'Loans payable' })).toBe(true);
  });

  it('excludes prepaids, fixed assets and non-balance-sheet accounts', () => {
    expect(isMonetaryAccount({ code: '1200', name: 'Prepaid', type: 'asset', subType: 'current_asset', detailType: 'Prepaid expenses' })).toBe(false);
    expect(isMonetaryAccount({ code: '1500', name: 'Equipment', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets' })).toBe(false);
    expect(isMonetaryAccount({ code: '4000', name: 'Revenue', type: 'income', subType: null, detailType: null })).toBe(false);
  });
});

describe('buildRevaluationRows — prototype fixture nets +118.09 with liability inversion', () => {
  const balances = [
    { accountCode: '1100', accountName: 'AR — USD customers', type: 'asset' as const, currency: 'USD', balanceForeign: 11540, carryingHome: 15802.64 },
    { accountCode: '1100', accountName: 'AR — EUR customers', type: 'asset' as const, currency: 'EUR', balanceForeign: 4300, carryingHome: 6278.2 },
    { accountCode: '1100', accountName: 'AR — GBP customers', type: 'asset' as const, currency: 'GBP', balanceForeign: 1950, carryingHome: 3368.1 },
    { accountCode: '2200', accountName: 'AP — USD vendors', type: 'liability' as const, currency: 'USD', balanceForeign: 2480, carryingHome: 3408.76 },
    { accountCode: '1015', accountName: 'USD Chequing', type: 'asset' as const, currency: 'USD', balanceForeign: 5576.5, carryingHome: 7711.87 },
  ];
  const rates = { USD: 1.3805, EUR: 1.468, GBP: 1.719 };

  it('produces the prototype rows and net', () => {
    const { rows, net, missingRates } = buildRevaluationRows({ balances, rates });
    expect(missingRates).toHaveLength(0);
    // AR USD: 11,540 × 1.3805 = 15,930.97 → +128.33
    expect(rows[0].revaluedHome).toBe(15930.97);
    expect(rows[0].unrealized).toBe(128.33);
    // AR GBP: 1,950 × 1.719 = 3,352.05 → −16.05
    const gbp = rows.find((r) => r.ccy === 'GBP')!;
    expect(gbp.unrealized).toBe(-16.05);
    // AP USD — liability inversion: 2,480 × 1.3805 = 3,423.64; carrying 3,408.76 → −14.88
    const ap = rows.find((r) => r.account === 'AP — USD vendors')!;
    expect(ap.revaluedHome).toBe(3423.64);
    expect(ap.unrealized).toBe(-14.88);
    expect(ap.liability).toBe(true);
    // Net: 128.33 + 34.20 − 16.05 − 14.88 − 13.51 = 118.09
    expect(net).toBe(118.09);
  });

  it('flags missing rates', () => {
    const { missingRates } = buildRevaluationRows({ balances, rates: { USD: 1.3805 } });
    expect(missingRates).toContain('EUR');
    expect(missingRates).toContain('GBP');
  });

  it('journal lines balance and invert for losses', () => {
    const { rows } = buildRevaluationRows({ balances, rates });
    const lines = revaluationJournalLines(rows, '4320', '2026-08-31');
    const d = lines.reduce((s, l) => s + l.debit, 0);
    const c = lines.reduce((s, l) => s + l.credit, 0);
    expect(Math.abs(d - c)).toBeLessThan(0.005);
    // Loss rows debit 4320
    expect(lines.some((l) => l.glAccountCode === '4320' && l.debit > 0)).toBe(true);
    expect(lines.some((l) => l.glAccountCode === '4320' && l.credit > 0)).toBe(true);
  });
});

export {};
