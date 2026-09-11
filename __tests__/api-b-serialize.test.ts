import { moneyString, moneyNumber, isoDate, reportMeta } from '@/lib/api/serialize';

describe('api-b serialization', () => {
  test('money values serialize as decimal strings, never floats or exponents', () => {
    expect(moneyString(100.5)).toBe('100.50');
    expect(moneyString('0.1')).toBe('0.10');
    // Prisma Decimal coerces through valueOf(); mirror that shape here.
    expect(moneyString({ valueOf: () => 12.3 })).toBe('12.30');
    expect(moneyString(null)).toBe('0.00');
    expect(moneyString(undefined)).toBe('0.00');
    expect(moneyString(Number.NaN)).toBe('0.00');
  });

  test('precision is configurable for rates (3dp) and FX (8dp)', () => {
    expect(moneyString(13.0, 3)).toBe('13.000');
    expect(moneyString(1.3456789, 8)).toBe('1.34567890');
  });

  test('moneyNumber rounds to cents', () => {
    // Note: 1.005 is not representable in float64 (it is 1.00499…), so
    // binary round-half-up lands on 1.00 — the Decimal path in production
    // carries exact cent precision; this helper only collapses float noise.
    expect(moneyNumber(1.005)).toBe(1);
    expect(moneyNumber(0.004)).toBe(0);
    expect(moneyNumber('2.99')).toBe(2.99);
  });

  test('dates serialize as ISO strings, empty values become null', () => {
    expect(isoDate(new Date('2026-09-10T12:00:00Z'))).toBe('2026-09-10T12:00:00.000Z');
    expect(isoDate(null)).toBeNull();
    expect(isoDate(undefined)).toBeNull();
  });

  test('report meta carries period, basis, generation time and currency', () => {
    const meta = reportMeta({
      periodLabel: 'For the period ended September 30, 2026',
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-30T00:00:00Z'),
      currency: 'CAD',
    });
    expect(meta).toMatchObject({
      reportingPeriod: 'For the period ended September 30, 2026',
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2026-09-30T00:00:00.000Z',
      accountingBasis: 'accrual',
      currency: 'CAD',
    });
    expect(new Date(meta.generatedAt).getTime()).not.toBeNaN();
  });
});
