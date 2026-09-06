import { calculateTax, getTaxRate } from '@/lib/taxes';

describe('Canadian tax rates', () => {
  test('Nova Scotia uses 15% HST through March 31, 2025', () => {
    const rate = getTaxRate('NS', '2025-03-31');
    expect(rate.hst).toBe(15);
    expect(rate.totalRate).toBe(15);
    expect(rate.label).toBe('15% HST');
  });

  test('Nova Scotia uses 14% HST beginning April 1, 2025', () => {
    const rate = getTaxRate('NS', '2025-04-01');
    expect(rate.hst).toBe(14);
    expect(rate.totalRate).toBe(14);
    expect(rate.label).toBe('14% HST');
  });

  test('Nova Scotia current rate is 14% HST', () => {
    expect(getTaxRate('NS', '2026-09-06').totalRate).toBe(14);
  });

  test('tax calculation respects the effective date', () => {
    expect(calculateTax(100, 'NS', '2025-03-31')).toMatchObject({ hst: 15, totalTax: 15, total: 115 });
    expect(calculateTax(100, 'NS', '2025-04-01')).toMatchObject({ hst: 14, totalTax: 14, total: 114 });
  });

  test('other current provincial rates remain unchanged', () => {
    expect(getTaxRate('AB', '2026-09-06').totalRate).toBe(5);
    expect(getTaxRate('ON', '2026-09-06').totalRate).toBe(13);
    expect(getTaxRate('QC', '2026-09-06').totalRate).toBe(14.975);
  });
});
