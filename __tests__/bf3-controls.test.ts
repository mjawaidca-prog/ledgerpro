import { classifyOverlap, diceCoefficient } from '@/lib/bank-feed/overlap';
import { normalizeFeedAmount } from '@/lib/bank-feed/sync';

process.env.BANK_FEED_KEK = Buffer.alloc(32, 7).toString('base64');

describe('BF-3 overlap classification', () => {
  const candidate = (id: string, date: string, amount: number, description: string) => ({
    id,
    date: new Date(date),
    amount,
    description,
  });

  test('a high-confidence match (same amount, close date, similar description) is a duplicate', () => {
    const verdict = classifyOverlap(
      { date: new Date('2026-09-10'), amount: -12.5, description: 'STARBUCKS STORE 123 TORONTO ON' },
      [candidate('r-1', '2026-09-11', -12.5, 'STARBUCKS STORE 123 TORONTO')]
    );
    expect(verdict).toEqual({ verdict: 'duplicate', matchId: 'r-1' });
  });

  test('a same-amount close-date but different description is ambiguous, not a duplicate', () => {
    const verdict = classifyOverlap(
      { date: new Date('2026-09-10'), amount: -12.5, description: 'STARBUCKS STORE 123' },
      [candidate('r-1', '2026-09-11', -12.5, 'AMAZON.CA RETAIL PURCHASE')]
    );
    expect(verdict).toEqual({ verdict: 'ambiguous', matchId: 'r-1' });
  });

  test('two legitimate identical purchases outside the date window both survive', () => {
    const verdict = classifyOverlap(
      { date: new Date('2026-09-20'), amount: -25, description: 'GAS STATION' },
      [candidate('r-1', '2026-09-10', -25, 'GAS STATION')]
    );
    expect(verdict).toEqual({ verdict: 'none', matchId: null });
  });

  test('different amounts never overlap', () => {
    const verdict = classifyOverlap(
      { date: new Date('2026-09-10'), amount: -12.51, description: 'STARBUCKS STORE 123' },
      [candidate('r-1', '2026-09-10', -12.5, 'STARBUCKS STORE 123')]
    );
    expect(verdict).toEqual({ verdict: 'none', matchId: null });
  });

  test('dice similarity behaves sanely', () => {
    expect(diceCoefficient('STARBUCKS', 'STARBUCKS')).toBe(1);
    // A single transposition breaks two bigrams — still clearly similar.
    expect(diceCoefficient('STARBUCKS', 'STARBUKCS')).toBeGreaterThan(0.6);
    expect(diceCoefficient('STARBUCKS', 'AMAZON')).toBeLessThan(0.3);
  });
});

describe('BF-3 amount normalization (no sign flips)', () => {
  test('amounts pass through verbatim, rounded to cents', () => {
    // -12.545 is not representable in float64 (it is -12.54499…), so
    // Math.round lands on -12.54 — deterministic, and provider values are
    // already cent-precision in practice.
    expect(normalizeFeedAmount(-12.545)).toBe(-12.54);
    expect(normalizeFeedAmount(89.4)).toBe(89.4);
    expect(normalizeFeedAmount(-0)).toBe(-0);
    expect(normalizeFeedAmount(Number.NaN)).toBe(0);
    expect(normalizeFeedAmount(Infinity)).toBe(0);
  });

  test('credit-card charges keep Plaid signs (no signMultiplier regression)', () => {
    // Plaid sends credit-card charges positive and payments negative; the
    // import path removed sign flipping in BUG-1 and feeds must match.
    expect(normalizeFeedAmount(45.67)).toBe(45.67);
    expect(normalizeFeedAmount(-45.67)).toBe(-45.67);
  });
});

