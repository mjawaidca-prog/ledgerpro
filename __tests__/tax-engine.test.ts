import { calculateTaxLine, TaxComponentDecision, TaxLineInput, TaxTreatment } from '@/lib/tax/engine';

const gst: TaxComponentDecision = { kind: 'GST', treatment: 'taxable', rateMilliPercent: 5000, recoveryBasisPoints: 0 };
const sale = (components: TaxComponentDecision[] = [gst], amountMinor = 10000): TaxLineInput => ({
  amountMinor, priceMode: 'exclusive', direction: 'sale', components,
});

describe('P1 isolated component tax engine', () => {
  test.each([5000, 13000, 14000, 15000])('calculates explicit GST/HST rate %i', rate => {
    const result = calculateTaxLine(sale([{ ...gst, kind: rate === 5000 ? 'GST' : 'HST', rateMilliPercent: rate }]));
    expect(result.taxMinor).toBe(rate / 10);
    expect(result.outputTaxMinor).toBe(result.taxMinor);
    expect(result.grossMinor).toBe(10000 + result.taxMinor);
    expect(result.recoverableMinor).toBe(0);
  });

  test('separates Quebec GST from QST, with no compounding', () => {
    const result = calculateTaxLine(sale([gst, { ...gst, kind: 'QST', rateMilliPercent: 9975 }]));
    expect(result.components.map(component => component.taxMinor)).toEqual([500, 998]);
    expect(result.grossMinor).toBe(11498);
  });

  test('supports independent federal and provincial exemptions', () => {
    const result = calculateTaxLine(sale([gst, { ...gst, kind: 'PST', treatment: 'exempt', rateMilliPercent: 0 }]));
    expect(result.taxMinor).toBe(500);
    expect(result.components[1].treatment).toBe('exempt');
  });

  test.each<TaxTreatment>(['zero_rated', 'exempt', 'out_of_scope'])('preserves distinct %s classification', treatment => {
    const result = calculateTaxLine(sale([{ ...gst, treatment, rateMilliPercent: 0 }]));
    expect(result.taxMinor).toBe(0);
    expect(result.components[0].treatment).toBe(treatment);
  });

  test('splits reviewed input credits from nonrecoverable PST', () => {
    const result = calculateTaxLine({ ...sale([
      { ...gst, recoveryBasisPoints: 5000 }, { ...gst, kind: 'PST', rateMilliPercent: 7000 },
    ]), direction: 'purchase' });
    expect(result).toMatchObject({ taxMinor: 1200, recoverableMinor: 250, nonRecoverableMinor: 950, outputTaxMinor: 0 });
  });

  test('handles QST recovery independently', () => {
    const result = calculateTaxLine({ ...sale([
      { ...gst, recoveryBasisPoints: 10000 }, { ...gst, kind: 'QST', rateMilliPercent: 9975, recoveryBasisPoints: 10000 },
    ]), direction: 'purchase' });
    expect(result).toMatchObject({ recoverableMinor: 1498, nonRecoverableMinor: 0 });
  });

  test('tax-inclusive amounts tie exactly to gross', () => {
    const result = calculateTaxLine({ ...sale([gst, { ...gst, kind: 'QST', rateMilliPercent: 9975 }], 11498), priceMode: 'inclusive' });
    expect(result).toMatchObject({ grossMinor: 11498, netMinor: 10000, taxMinor: 1498 });
  });

  test('inclusive rounding assigns residual to net without inflating gross', () => {
    const result = calculateTaxLine({ ...sale([gst, { ...gst, kind: 'PST', rateMilliPercent: 7000 }], 10), priceMode: 'inclusive' });
    expect(result.netMinor + result.taxMinor).toBe(10);
  });

  test('rounds half-cents symmetrically for credits', () => {
    expect(calculateTaxLine(sale([gst], 10)).taxMinor).toBe(1);
    expect(calculateTaxLine(sale([gst], -10)).taxMinor).toBe(-1);
  });

  test('zero amount and reversed purchase retain accounting identities', () => {
    expect(calculateTaxLine(sale([gst], 0)).grossMinor).toBe(0);
    for (const amountMinor of [-11498, -10, 10, 11498]) {
      for (const priceMode of ['inclusive', 'exclusive'] as const) {
        const result = calculateTaxLine({ ...sale([{ ...gst, recoveryBasisPoints: 3333 }], amountMinor), direction: 'purchase', priceMode });
        expect(result.netMinor + result.taxMinor).toBe(result.grossMinor);
        expect(result.recoverableMinor + result.nonRecoverableMinor).toBe(result.taxMinor);
      }
    }
  });

  test.each([NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid monetary amount %s', amount => {
    expect(() => calculateTaxLine(sale([gst], amount))).toThrow('safe integer');
  });

  test('guards output overflow even though bigint arithmetic is exact', () => {
    expect(() => calculateTaxLine(sale([gst], Number.MAX_SAFE_INTEGER))).toThrow('safe integer');
  });

  test('rejects conflicting or missing component decisions', () => {
    expect(() => calculateTaxLine(sale([]))).toThrow('Explicit');
    expect(() => calculateTaxLine(sale([gst, gst]))).toThrow('Duplicate');
    expect(() => calculateTaxLine(sale([gst, { ...gst, kind: 'HST' }]))).toThrow('HST');
    expect(() => calculateTaxLine(sale([{ ...gst, kind: 'QST' }, { ...gst, kind: 'PST' }]))).toThrow('provincial');
    expect(() => calculateTaxLine(sale([{ ...gst, treatment: 'exempt' }]))).toThrow('zero rate');
    expect(() => calculateTaxLine(sale([{ ...gst, rateMilliPercent: 0 }]))).toThrow('zero_rated');
  });

  test('low-value inclusive Quebec purchases balance and reverse exactly', () => {
    for (let amount = 0; amount <= 250; amount++) {
      const input: TaxLineInput = { ...sale([
        { ...gst, recoveryBasisPoints: 3333 },
        { ...gst, kind: 'QST', rateMilliPercent: 9975, recoveryBasisPoints: 5000 },
      ], amount), direction: 'purchase', priceMode: 'inclusive' };
      const debit = calculateTaxLine(input);
      const credit = calculateTaxLine({ ...input, amountMinor: -amount });
      expect(debit.netMinor + debit.taxMinor).toBe(amount);
      expect(debit.recoverableMinor + debit.nonRecoverableMinor).toBe(debit.taxMinor);
      expect(debit.netMinor).toBeGreaterThanOrEqual(0);
      expect(credit.taxMinor + debit.taxMinor).toBe(0);
      expect(credit.recoverableMinor + debit.recoverableMinor).toBe(0);
    }
  });

  test('rejects invalid rate and recovery eligibility', () => {
    expect(() => calculateTaxLine(sale([{ ...gst, rateMilliPercent: -1 }]))).toThrow('safe integer');
    expect(() => calculateTaxLine(sale([{ ...gst, recoveryBasisPoints: 10001 }]))).toThrow('safe integer');
    expect(() => calculateTaxLine(sale([{ ...gst, recoveryBasisPoints: 10000 }]))).toThrow('Recovery');
    expect(() => calculateTaxLine({ ...sale([{ ...gst, kind: 'PST', recoveryBasisPoints: 10000 }]), direction: 'purchase' })).toThrow('Recovery');
  });

  test('does not mutate input or component decisions', () => {
    const component = Object.freeze({ ...gst });
    const input = Object.freeze({ ...sale(), components: Object.freeze([component]) });
    expect(calculateTaxLine(input).taxMinor).toBe(500);
    expect(input.components[0]).toEqual(gst);
  });
});
