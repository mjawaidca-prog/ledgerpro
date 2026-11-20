/**
 * In-app calculator engine — a pure state machine, no DOM, no I/O.
 *
 * Improvement plan Phase 1, item 5. The panel in
 * `src/components/shell/CalculatorPanel.tsx` is a thin shell over this
 * engine; every behaviour (chaining, percent semantics, tax keys, tape)
 * lives here so it is unit-testable without a browser.
 *
 * Conventions:
 *   - All money values are integer MICRO units (1 unit = 1e-6 of a
 *     dollar). Entry parsing is digit-by-digit and multiplication /
 *     division go through BigInt intermediates, so decimal arithmetic
 *     is exact — 0.1 + 0.2 is 0.3, never 0.30000000000000004.
 *   - Operations are strictly LEFT-TO-RIGHT (desk-calculator semantics):
 *     2 + 3 × 4 is 20, not 14. There is no operator precedence.
 *   - Tax rates are integer MILLI-PERCENT (rate% × 1000): 5% → 5000,
 *     13% → 13000, 14.975% → 14975. Tax amounts round to the CENT, the
 *     way an invoice rounds them, so +Tax / −Tax round-trip exactly.
 *   - Percent follows the classic calculator rule: with a pending + or −
 *     it converts the entry to that percentage OF the accumulator
 *     (200 + 10 % → 20, then = → 220); with a pending × or ÷, or no
 *     pending operation, it divides the entry by 100 (200 × 10 % → 0.1,
 *     then = → 20).
 */

export type CalcOperator = 'add' | 'subtract' | 'multiply' | 'divide';

export interface TapeEntry {
  id: number;
  /** Human-readable computation, e.g. "100 + 23" or "19.99 +Tax 13%". */
  expression: string;
  /** Result in micro units. Clicking it in the panel recalls the value. */
  resultMicro: number;
}

export interface CalculatorSnapshot {
  /** What the big display shows: the entry verbatim while typing, else the formatted current value, else "Error". */
  display: string;
  /** Small preview line, e.g. "100 +" while a chain is in progress. */
  expression: string;
  /** Current value in micro units (the parsed entry while typing). */
  displayMicro: number;
  error: boolean;
  tape: TapeEntry[];
}

const MICRO = 1_000_000;
// BigInt constructor calls, not literals — the repo targets ES2017
// (same convention as src/lib/tax/engine.ts).
const ZERO_BIG = BigInt(0);
const ONE_BIG = BigInt(1);
const TWO_BIG = BigInt(2);
const HUNDRED_BIG = BigInt(100);
const TEN_THOUSAND_BIG = BigInt(10_000);
const MICRO_BIG = BigInt(MICRO);
/** 100% expressed in milli-percent × the micro scale factor for tax math. */
const TAX_BASE = BigInt(100_000);
const MAX_TAPE_ENTRIES = 50;
/** 9 integer digits keeps every micro value under 2^53, so integers stay exact. */
const MAX_INTEGER_DIGITS = 9;
const MAX_FRACTION_DIGITS = 6;

/** BigInt division rounding half away from zero (the accounting round). */
function divRound(numer: bigint, denom: bigint): bigint {
  const negative = numer < ZERO_BIG !== denom < ZERO_BIG;
  const an = numer < ZERO_BIG ? -numer : numer;
  const ad = denom < ZERO_BIG ? -denom : denom;
  let q = an / ad;
  const r = an % ad;
  if (r * TWO_BIG >= ad) q += ONE_BIG;
  return negative ? -q : q;
}

function checked(micro: bigint): number {
  if (micro > BigInt(Number.MAX_SAFE_INTEGER) || micro < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('calculator overflow');
  }
  return Number(micro);
}

/**
 * Parse a decimal string exactly into micro units. Accepts the shapes the
 * entry editor can produce ("-12.30", "0.", "7") — never float math.
 */
export function parseDecimalToMicro(text: string): number {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [intPart = '', fracPart = ''] = body.split('.');
  const frac = (fracPart + '000000').slice(0, MAX_FRACTION_DIGITS);
  const micro = BigInt(intPart || '0') * MICRO_BIG + BigInt(frac || '0');
  return Number(negative ? -micro : micro);
}

/** Grouped display form: 1234567500000 micro → "1,234,567.5" (decimals trimmed, max 6 places). */
export function formatMicro(micro: number): string {
  const negative = micro < 0;
  const abs = Math.abs(micro);
  const intPart = Math.floor(abs / MICRO);
  const fracPart = abs % MICRO;
  const grouped = intPart.toLocaleString('en-US');
  if (fracPart === 0) return (negative ? '-' : '') + grouped;
  const frac = String(fracPart).padStart(MAX_FRACTION_DIGITS, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${grouped}.${frac}`;
}

/** Ungrouped plain form ("-1234.5") — for loading a value into the entry and for clipboard copy. */
export function microToPlainString(micro: number): string {
  return formatMicro(micro).replace(/,/g, '');
}

export function applyOperatorMicro(op: CalcOperator, aMicro: number, bMicro: number): number {
  switch (op) {
    case 'add':
      return checked(BigInt(aMicro) + BigInt(bMicro));
    case 'subtract':
      return checked(BigInt(aMicro) - BigInt(bMicro));
    case 'multiply':
      return checked(divRound(BigInt(aMicro) * BigInt(bMicro), MICRO_BIG));
    case 'divide':
      if (bMicro === 0) throw new RangeError('division by zero');
      return checked(divRound(BigInt(aMicro) * MICRO_BIG, BigInt(bMicro)));
  }
}

/** Tax amount in whole cents for a micro value at a milli-percent rate. */
function taxCentsFor(micro: number, rateMilliPct: number): bigint {
  // micro × rate / 100000 = tax in micro; ÷ 10000 more converts micro → cents.
  return divRound(BigInt(micro) * BigInt(rateMilliPct), TAX_BASE * TEN_THOUSAND_BIG);
}

/** Gross = net + tax, with the tax rounded to the cent. Exact inverse of removeTaxMicro for cent-valued amounts. */
export function addTaxMicro(netMicro: number, rateMilliPct: number): number {
  const taxMicro = taxCentsFor(netMicro, rateMilliPct) * TEN_THOUSAND_BIG;
  return checked(BigInt(netMicro) + taxMicro);
}

/** Net = gross with the tax backed out, rounded to the cent. */
export function removeTaxMicro(grossMicro: number, rateMilliPct: number): number {
  const grossCents = divRound(BigInt(grossMicro), TEN_THOUSAND_BIG);
  const netCents = divRound(grossCents * TAX_BASE, TAX_BASE + BigInt(rateMilliPct));
  return checked(netCents * TEN_THOUSAND_BIG);
}

/** Milli-percent → display label: 5000 → "5%", 14975 → "14.975%". */
export function formatRateMilliPct(rateMilliPct: number): string {
  const whole = Math.floor(rateMilliPct / 1000);
  const frac = rateMilliPct % 1000;
  if (frac === 0) return `${whole}%`;
  const fracText = String(frac).padStart(3, '0').replace(/0+$/, '');
  return `${whole}.${fracText}%`;
}

const OPERATOR_SYMBOLS: Record<CalcOperator, string> = {
  add: '+',
  subtract: '−',
  multiply: '×',
  divide: '÷',
};

export function operatorSymbol(op: CalcOperator): string {
  return OPERATOR_SYMBOLS[op];
}

export class CalculatorEngine {
  private entry: string | null = null;
  private accumulatorMicro: number | null = null;
  private pendingOperator: CalcOperator | null = null;
  private resultMicro: number | null = null;
  private lastOperator: CalcOperator | null = null;
  private lastOperandMicro: number | null = null;
  private justEvaluated = false;
  private error = false;
  private tape: TapeEntry[] = [];
  private nextTapeId = 1;

  // ── entry editing ────────────────────────────────────────────────

  inputDigit(digit: string): void {
    if (this.error) this.resetAll();
    if (this.entry === null) {
      if (this.justEvaluated) this.resetChain();
      this.entry = digit;
      return;
    }
    const [intPart, fracPart] = this.entry.replace('-', '').split('.');
    if (fracPart !== undefined) {
      if (fracPart.length >= MAX_FRACTION_DIGITS) return;
    } else if (intPart.length >= MAX_INTEGER_DIGITS) {
      return;
    }
    // A lone leading zero is replaced, not extended ("0" then "5" → "5").
    if (this.entry === '0') this.entry = digit;
    else if (this.entry === '-0') this.entry = `-${digit}`;
    else this.entry += digit;
  }

  inputDecimalPoint(): void {
    if (this.error) this.resetAll();
    if (this.entry === null) {
      if (this.justEvaluated) this.resetChain();
      this.entry = '0.';
      return;
    }
    if (!this.entry.includes('.')) this.entry += '.';
  }

  toggleSign(): void {
    if (this.error) return;
    if (this.entry !== null) {
      this.entry = this.entry.startsWith('-') ? this.entry.slice(1) : `-${this.entry}`;
      return;
    }
    // Nothing being typed: mid-chain it negates the accumulator (what the
    // display is showing); on a bare result it loads the negated result as
    // a fresh entry.
    if (this.pendingOperator !== null && this.accumulatorMicro !== null) {
      this.accumulatorMicro = -this.accumulatorMicro;
      return;
    }
    if (this.resultMicro !== null && this.resultMicro !== 0) {
      this.entry = microToPlainString(-this.resultMicro);
      this.resultMicro = null;
      this.justEvaluated = false;
      this.lastOperator = null;
      this.lastOperandMicro = null;
    }
  }

  backspace(): void {
    if (this.error || this.entry === null) return;
    this.entry = this.entry.slice(0, -1);
    if (this.entry === '' || this.entry === '-') this.entry = '0';
  }

  /** CE: clear the entry being typed; pressed on a result, clears the chain too. Tape is kept. */
  clearEntry(): void {
    if (this.error) {
      this.resetAll();
      return;
    }
    if (this.entry !== null) {
      this.entry = null;
      return;
    }
    this.resetChain();
    this.resultMicro = null;
  }

  /** AC: clear everything except the tape. */
  clearAll(): void {
    this.resetAll();
  }

  clearTape(): void {
    this.tape = [];
  }

  // ── operations ───────────────────────────────────────────────────

  setOperator(op: CalcOperator): void {
    if (this.error) return;
    if (this.entry !== null) {
      const operand = parseDecimalToMicro(this.entry);
      if (this.accumulatorMicro !== null && this.pendingOperator !== null) {
        // Chaining: fold the pending operation in first, tape the result.
        const result = this.compute(this.pendingOperator, this.accumulatorMicro, operand);
        if (result === null) return;
        this.pushTape(`${formatMicro(this.accumulatorMicro)} ${operatorSymbol(this.pendingOperator)} ${formatMicro(operand)}`, result);
        this.accumulatorMicro = result;
      } else {
        this.accumulatorMicro = operand;
      }
      this.entry = null;
    } else if (this.accumulatorMicro === null) {
      // Operator pressed on a bare result (or at start): chain from it.
      this.accumulatorMicro = this.resultMicro ?? 0;
    }
    this.pendingOperator = op;
    this.resultMicro = null;
    this.justEvaluated = false;
    this.lastOperator = null;
    this.lastOperandMicro = null;
  }

  equals(): void {
    if (this.error) return;
    if (this.accumulatorMicro !== null && this.pendingOperator !== null) {
      // "5 + =" reuses the accumulator as the second operand.
      const operand = this.entry !== null ? parseDecimalToMicro(this.entry) : this.accumulatorMicro;
      const result = this.compute(this.pendingOperator, this.accumulatorMicro, operand);
      if (result === null) return;
      this.pushTape(`${formatMicro(this.accumulatorMicro)} ${operatorSymbol(this.pendingOperator)} ${formatMicro(operand)}`, result);
      this.lastOperator = this.pendingOperator;
      this.lastOperandMicro = operand;
      this.resultMicro = result;
      this.accumulatorMicro = null;
      this.pendingOperator = null;
      this.entry = null;
      this.justEvaluated = true;
      return;
    }
    if (this.justEvaluated && this.lastOperator !== null && this.lastOperandMicro !== null && this.resultMicro !== null) {
      // Repeat-equals: apply the last operation to the result again.
      const result = this.compute(this.lastOperator, this.resultMicro, this.lastOperandMicro);
      if (result === null) return;
      this.pushTape(`${formatMicro(this.resultMicro)} ${operatorSymbol(this.lastOperator)} ${formatMicro(this.lastOperandMicro)}`, result);
      this.resultMicro = result;
      return;
    }
    if (this.entry !== null) {
      // "=" on a lone number just commits it.
      this.resultMicro = parseDecimalToMicro(this.entry);
      this.entry = null;
      this.justEvaluated = true;
    }
  }

  percent(): void {
    if (this.error) return;
    const value = this.entry !== null ? parseDecimalToMicro(this.entry) : this.currentMicro();
    let converted: number;
    try {
      if (
        (this.pendingOperator === 'add' || this.pendingOperator === 'subtract') &&
        this.accumulatorMicro !== null
      ) {
        // Percentage OF the accumulator: acc × value / 100.
        converted = checked(divRound(BigInt(this.accumulatorMicro) * BigInt(value), HUNDRED_BIG * MICRO_BIG));
      } else {
        converted = checked(divRound(BigInt(value), HUNDRED_BIG));
      }
    } catch {
      this.enterError();
      return;
    }
    this.entry = microToPlainString(converted);
    this.justEvaluated = false;
  }

  addTax(rateMilliPct: number): void {
    this.applyTax(rateMilliPct, 'add');
  }

  removeTax(rateMilliPct: number): void {
    this.applyTax(rateMilliPct, 'remove');
  }

  /** Load a value (e.g. a clicked tape result) as the current entry. */
  recall(micro: number): void {
    if (this.error) this.resetAll();
    if (this.justEvaluated) this.resetChain();
    this.entry = microToPlainString(micro);
    this.justEvaluated = false;
  }

  // ── snapshot ─────────────────────────────────────────────────────

  getState(): CalculatorSnapshot {
    const displayMicro = this.entry !== null ? parseDecimalToMicro(this.entry) : this.currentMicro();
    return {
      display: this.error ? 'Error' : this.entry !== null ? this.entry : formatMicro(displayMicro),
      expression: this.error
        ? ''
        : this.accumulatorMicro !== null && this.pendingOperator !== null
          ? `${formatMicro(this.accumulatorMicro)} ${operatorSymbol(this.pendingOperator)}`
          : '',
      displayMicro,
      error: this.error,
      tape: [...this.tape],
    };
  }

  // ── internals ────────────────────────────────────────────────────

  private applyTax(rateMilliPct: number, direction: 'add' | 'remove'): void {
    if (this.error) return;
    const base = this.entry !== null ? parseDecimalToMicro(this.entry) : this.currentMicro();
    let result: number;
    try {
      result = direction === 'add' ? addTaxMicro(base, rateMilliPct) : removeTaxMicro(base, rateMilliPct);
    } catch {
      this.enterError();
      return;
    }
    this.pushTape(
      `${formatMicro(base)} ${direction === 'add' ? '+Tax' : '−Tax'} ${formatRateMilliPct(rateMilliPct)}`,
      result,
    );
    // The taxed value becomes the current entry so the user can keep
    // calculating with it; any pending chain is left untouched.
    this.entry = microToPlainString(result);
    this.justEvaluated = false;
    this.lastOperator = null;
    this.lastOperandMicro = null;
  }

  private compute(op: CalcOperator, a: number, b: number): number | null {
    try {
      return applyOperatorMicro(op, a, b);
    } catch {
      this.enterError();
      return null;
    }
  }

  private currentMicro(): number {
    if (this.pendingOperator !== null && this.accumulatorMicro !== null) return this.accumulatorMicro;
    return this.resultMicro ?? this.accumulatorMicro ?? 0;
  }

  private pushTape(expression: string, resultMicro: number): void {
    this.tape.push({ id: this.nextTapeId++, expression, resultMicro });
    if (this.tape.length > MAX_TAPE_ENTRIES) {
      this.tape = this.tape.slice(this.tape.length - MAX_TAPE_ENTRIES);
    }
  }

  private resetChain(): void {
    this.accumulatorMicro = null;
    this.pendingOperator = null;
    this.lastOperator = null;
    this.lastOperandMicro = null;
    this.justEvaluated = false;
  }

  private resetAll(): void {
    this.entry = null;
    this.resultMicro = null;
    this.error = false;
    this.resetChain();
  }

  private enterError(): void {
    this.error = true;
    this.entry = null;
  }
}
