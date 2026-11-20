/**
 * In-app calculator engine (improvement plan Phase 1, item 5).
 *
 * Expected values are hand-computed. Money is integer micro units
 * (1 = 1e-6 dollars) in the engine, so 100.00 is 100_000_000 below.
 * Tax expectations follow invoice rounding: the tax amount rounds to
 * the cent, which is what makes +Tax / −Tax round-trip exactly.
 */
import {
  CalculatorEngine,
  addTaxMicro,
  applyOperatorMicro,
  formatMicro,
  formatRateMilliPct,
  microToPlainString,
  parseDecimalToMicro,
  removeTaxMicro,
} from '@/lib/calculator';

/** Type a string of digits/points into the engine, one key at a time. */
function type(calc: CalculatorEngine, text: string): void {
  for (const ch of text) {
    if (ch === '.') calc.inputDecimalPoint();
    else calc.inputDigit(ch);
  }
}

describe('decimal parsing and formatting — exact, no float error', () => {
  it('parses decimal strings digit-by-digit into micro units', () => {
    expect(parseDecimalToMicro('0.1')).toBe(100_000);
    expect(parseDecimalToMicro('0.2')).toBe(200_000);
    expect(parseDecimalToMicro('12.30')).toBe(12_300_000);
    expect(parseDecimalToMicro('-7')).toBe(-7_000_000);
    expect(parseDecimalToMicro('0.')).toBe(0);
    expect(parseDecimalToMicro('19.99')).toBe(19_990_000);
  });

  it('formats micro units grouped with trimmed decimals', () => {
    expect(formatMicro(0)).toBe('0');
    expect(formatMicro(300_000)).toBe('0.3');
    expect(formatMicro(1_234_567_500_000)).toBe('1,234,567.5');
    expect(formatMicro(-2_500_000)).toBe('-2.5');
    expect(formatMicro(989_999_999_010_000)).toBe('989,999,999.01');
    expect(microToPlainString(1_234_567_500_000)).toBe('1234567.5');
  });

  it('adds 0.1 + 0.2 to exactly 0.3', () => {
    expect(applyOperatorMicro('add', parseDecimalToMicro('0.1'), parseDecimalToMicro('0.2'))).toBe(300_000);
  });

  it('multiplies large values exactly through the BigInt path', () => {
    // 9,999,999.99 × 99 = 989,999,999.01
    const result = applyOperatorMicro('multiply', parseDecimalToMicro('9999999.99'), parseDecimalToMicro('99'));
    expect(result).toBe(989_999_999_010_000);
  });

  it('divides with micro precision, rounding the last place', () => {
    // 10 ÷ 3 = 3.3333333… → 3.333333
    expect(applyOperatorMicro('divide', parseDecimalToMicro('10'), parseDecimalToMicro('3'))).toBe(3_333_333);
    expect(() => applyOperatorMicro('divide', 1_000_000, 0)).toThrow(RangeError);
  });
});

describe('entry editing', () => {
  it('replaces a lone leading zero and guards the decimal point', () => {
    const calc = new CalculatorEngine();
    type(calc, '05');
    expect(calc.getState().display).toBe('5');
    calc.clearAll();
    type(calc, '0.5');
    expect(calc.getState().display).toBe('0.5');
    calc.clearAll();
    type(calc, '1..2');
    expect(calc.getState().display).toBe('1.2');
  });

  it('backspace edits the entry and floors at 0', () => {
    const calc = new CalculatorEngine();
    type(calc, '123');
    calc.backspace();
    expect(calc.getState().display).toBe('12');
    calc.backspace();
    calc.backspace();
    expect(calc.getState().display).toBe('0');
  });

  it('toggle sign flips the entry and a bare result', () => {
    const calc = new CalculatorEngine();
    type(calc, '25');
    calc.toggleSign();
    expect(calc.getState().display).toBe('-25');
    calc.toggleSign();
    expect(calc.getState().display).toBe('25');

    calc.clearAll();
    type(calc, '5');
    calc.setOperator('add');
    type(calc, '3');
    calc.equals();
    expect(calc.getState().display).toBe('8');
    calc.toggleSign();
    expect(calc.getState().display).toBe('-8');
    calc.setOperator('add');
    type(calc, '2');
    calc.equals();
    expect(calc.getState().display).toBe('-6');
  });

  it('CE clears only the entry mid-chain; the chain survives', () => {
    const calc = new CalculatorEngine();
    type(calc, '100');
    calc.setOperator('add');
    type(calc, '23');
    calc.clearEntry();
    expect(calc.getState().display).toBe('100');
    type(calc, '7');
    calc.equals();
    expect(calc.getState().display).toBe('107');
  });
});

describe('chained operations — left-to-right, taped', () => {
  it('folds each pending operation as the next operator is pressed', () => {
    const calc = new CalculatorEngine();
    type(calc, '2');
    calc.setOperator('add');
    type(calc, '3');
    calc.setOperator('add');
    let state = calc.getState();
    expect(state.display).toBe('5');
    expect(state.expression).toBe('5 +');
    expect(state.tape).toEqual([{ id: 1, expression: '2 + 3', resultMicro: 5_000_000 }]);

    type(calc, '4');
    calc.equals();
    state = calc.getState();
    expect(state.display).toBe('9');
    expect(state.tape).toEqual([
      { id: 1, expression: '2 + 3', resultMicro: 5_000_000 },
      { id: 2, expression: '5 + 4', resultMicro: 9_000_000 },
    ]);
  });

  it('is strictly left-to-right: 2 + 3 × 4 is 20, not 14', () => {
    const calc = new CalculatorEngine();
    type(calc, '2');
    calc.setOperator('add');
    type(calc, '3');
    calc.setOperator('multiply');
    type(calc, '4');
    calc.equals();
    expect(calc.getState().display).toBe('20');
  });

  it('"5 + =" reuses the accumulator as the second operand', () => {
    const calc = new CalculatorEngine();
    type(calc, '5');
    calc.setOperator('add');
    calc.equals();
    expect(calc.getState().display).toBe('10');
  });

  it('repeat-equals reapplies the last operation', () => {
    const calc = new CalculatorEngine();
    type(calc, '5');
    calc.setOperator('add');
    type(calc, '3');
    calc.equals();
    calc.equals();
    calc.equals();
    expect(calc.getState().display).toBe('14');
    expect(calc.getState().tape.map((t) => t.resultMicro)).toEqual([8_000_000, 11_000_000, 14_000_000]);
  });

  it('typing a digit after equals starts a fresh calculation', () => {
    const calc = new CalculatorEngine();
    type(calc, '5');
    calc.setOperator('add');
    type(calc, '3');
    calc.equals();
    type(calc, '2');
    calc.setOperator('multiply');
    type(calc, '10');
    calc.equals();
    expect(calc.getState().display).toBe('20');
  });
});

describe('percent semantics', () => {
  it('standalone percent divides by 100', () => {
    const calc = new CalculatorEngine();
    type(calc, '50');
    calc.percent();
    expect(calc.getState().display).toBe('0.5');
  });

  it('with a pending + it takes a percentage OF the accumulator: 200 + 10% = 220', () => {
    const calc = new CalculatorEngine();
    type(calc, '200');
    calc.setOperator('add');
    type(calc, '10');
    calc.percent();
    expect(calc.getState().display).toBe('20');
    calc.equals();
    expect(calc.getState().display).toBe('220');
    expect(calc.getState().tape).toEqual([{ id: 1, expression: '200 + 20', resultMicro: 220_000_000 }]);
  });

  it('with a pending − it takes a percentage OF the accumulator: 200 − 10% = 180', () => {
    const calc = new CalculatorEngine();
    type(calc, '200');
    calc.setOperator('subtract');
    type(calc, '10');
    calc.percent();
    calc.equals();
    expect(calc.getState().display).toBe('180');
  });

  it('with a pending × it divides the entry by 100: 200 × 10% = 20', () => {
    const calc = new CalculatorEngine();
    type(calc, '200');
    calc.setOperator('multiply');
    type(calc, '10');
    calc.percent();
    expect(calc.getState().display).toBe('0.1');
    calc.equals();
    expect(calc.getState().display).toBe('20');
  });
});

describe('tax keys', () => {
  it('addTax rounds the tax to the cent; removeTax backs it out exactly', () => {
    expect(addTaxMicro(100_000_000, 5000)).toBe(105_000_000); // 100.00 + 5% GST
    expect(removeTaxMicro(105_000_000, 5000)).toBe(100_000_000);
    // 19.99 × 13% = 2.5987 → tax rounds to 2.60 → gross 22.59, and back.
    expect(addTaxMicro(19_990_000, 13_000)).toBe(22_590_000);
    expect(removeTaxMicro(22_590_000, 13_000)).toBe(19_990_000);
  });

  it('round-trips at a three-decimal combined rate (14.975%)', () => {
    // 100.00 × 14.975% = 14.975 → tax rounds to 14.98 → gross 114.98, and back to 100.00.
    expect(addTaxMicro(100_000_000, 14_975)).toBe(114_980_000);
    expect(removeTaxMicro(114_980_000, 14_975)).toBe(100_000_000);
  });

  it('engine +Tax tapes the computation and leaves the gross as the entry', () => {
    const calc = new CalculatorEngine();
    type(calc, '100');
    calc.addTax(5000);
    let state = calc.getState();
    expect(state.display).toBe('105');
    expect(state.tape).toEqual([{ id: 1, expression: '100 +Tax 5%', resultMicro: 105_000_000 }]);

    calc.removeTax(5000);
    state = calc.getState();
    expect(state.display).toBe('100');
    expect(state.tape[1]).toEqual({ id: 2, expression: '105 −Tax 5%', resultMicro: 100_000_000 });
  });

  it('formats milli-percent rates for labels', () => {
    expect(formatRateMilliPct(5000)).toBe('5%');
    expect(formatRateMilliPct(13_000)).toBe('13%');
    expect(formatRateMilliPct(14_975)).toBe('14.975%');
  });
});

describe('tape behaviour', () => {
  it('recalling a tape result loads it as the current entry', () => {
    const calc = new CalculatorEngine();
    type(calc, '2');
    calc.setOperator('add');
    type(calc, '3');
    calc.equals();
    calc.clearAll();
    expect(calc.getState().display).toBe('0');
    expect(calc.getState().tape).toHaveLength(1); // AC keeps the tape

    calc.recall(calc.getState().tape[0].resultMicro);
    expect(calc.getState().display).toBe('5');
    calc.setOperator('add');
    type(calc, '5');
    calc.equals();
    expect(calc.getState().display).toBe('10');
  });

  it('caps the tape at 50 entries, dropping the oldest', () => {
    const calc = new CalculatorEngine();
    for (let i = 0; i < 60; i++) {
      type(calc, '1');
      calc.setOperator('add');
      calc.equals();
    }
    const tape = calc.getState().tape;
    expect(tape).toHaveLength(50);
    expect(tape[0].id).toBe(11);
    expect(tape[tape.length - 1].id).toBe(60);
  });

  it('clearTape empties the tape without touching the calculation', () => {
    const calc = new CalculatorEngine();
    type(calc, '2');
    calc.setOperator('add');
    type(calc, '3');
    calc.equals();
    calc.clearTape();
    expect(calc.getState().tape).toEqual([]);
    expect(calc.getState().display).toBe('5');
  });
});

describe('error handling', () => {
  it('division by zero shows Error and the next digit starts fresh', () => {
    const calc = new CalculatorEngine();
    type(calc, '5');
    calc.setOperator('divide');
    type(calc, '0');
    calc.equals();
    expect(calc.getState().error).toBe(true);
    expect(calc.getState().display).toBe('Error');

    type(calc, '7');
    expect(calc.getState().error).toBe(false);
    expect(calc.getState().display).toBe('7');
  });

  it('overflow shows Error instead of a wrong number', () => {
    const calc = new CalculatorEngine();
    type(calc, '999999999');
    calc.setOperator('multiply');
    type(calc, '999999999');
    calc.equals();
    expect(calc.getState().error).toBe(true);
    expect(calc.getState().display).toBe('Error');
  });
});
