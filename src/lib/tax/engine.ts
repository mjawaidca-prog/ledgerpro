/**
 * Unwired P1 arithmetic foundation, not a tax-eligibility or place-of-supply resolver.
 * Callers must supply reviewed, versioned component decisions for each line.
 * Amounts are signed integer minor units, already rounded after quantity/discount.
 * Rates use thousandths of a percentage point: 5% = 5000, 9.975% = 9975.
 */
export type TaxKind = 'GST' | 'HST' | 'PST' | 'RST' | 'QST';
export type TaxTreatment = 'taxable' | 'zero_rated' | 'exempt' | 'out_of_scope';

export interface TaxComponentDecision {
  kind: TaxKind;
  treatment: TaxTreatment;
  rateMilliPercent: number;
  /** Reviewed purchase recovery fraction: 10000 = 100%; sales must use zero. */
  recoveryBasisPoints: number;
}

export interface TaxLineInput {
  amountMinor: number;
  priceMode: 'exclusive' | 'inclusive';
  direction: 'sale' | 'purchase';
  components: readonly TaxComponentDecision[];
}

export interface CalculatedTaxComponent extends TaxComponentDecision {
  taxMinor: number;
  recoverableMinor: number;
  nonRecoverableMinor: number;
  outputTaxMinor: number;
}

export interface TaxLineResult {
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  recoverableMinor: number;
  nonRecoverableMinor: number;
  outputTaxMinor: number;
  components: CalculatedTaxComponent[];
}

const RATE_SCALE = BigInt(100000);
const RECOVERY_SCALE = BigInt(10000);
const ZERO = BigInt(0);
const TWO = BigInt(2);

function integer(value: number, name: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a safe integer between ${min} and ${max}`);
  }
}

function checkedNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Tax calculation exceeds safe integer range');
  return result;
}

/** Symmetric half-away-from-zero rounding makes credits exact sign reversals. */
function roundRatio(numerator: bigint, denominator: bigint): number {
  const absolute = numerator < ZERO ? -numerator : numerator;
  const rounded = (absolute * TWO + denominator) / (denominator * TWO);
  return checkedNumber(numerator < ZERO ? -rounded : rounded);
}

function sum(values: readonly number[]): number {
  return checkedNumber(values.reduce((total, value) => total + BigInt(value), ZERO));
}

/**
 * Each applicable tax is calculated on the same base (no compound taxes).
 * Inclusive prices: round each gross-derived component, assign residual to net.
 * This explicit rounding policy requires accountant sign-off before integration.
 * This function never changes existing taxes.ts callers or creates GL entries.
 */
export function calculateTaxLine(input: TaxLineInput): TaxLineResult {
  integer(input.amountMinor, 'amountMinor', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  if (!['exclusive', 'inclusive'].includes(input.priceMode)) throw new Error('Invalid price mode');
  if (!['sale', 'purchase'].includes(input.direction)) throw new Error('Invalid direction');
  if (!Array.isArray(input.components) || input.components.length === 0) {
    throw new Error('Explicit tax treatment is required');
  }
  const kinds = new Set<TaxKind>();
  for (const component of input.components) {
    if (!['GST', 'HST', 'PST', 'RST', 'QST'].includes(component.kind)) throw new Error('Invalid tax kind');
    if (!['taxable', 'zero_rated', 'exempt', 'out_of_scope'].includes(component.treatment)) {
      throw new Error('Invalid tax treatment');
    }
    if (kinds.has(component.kind)) throw new Error('Duplicate tax component');
    kinds.add(component.kind);
    integer(component.rateMilliPercent, 'rateMilliPercent', 0, 100000);
    integer(component.recoveryBasisPoints, 'recoveryBasisPoints', 0, 10000);
    if (component.treatment !== 'taxable' && component.rateMilliPercent !== 0) {
      throw new Error('Non-taxable component decisions must have a zero rate');
    }
    if (component.treatment === 'taxable' && component.rateMilliPercent === 0) {
      throw new Error('Use zero_rated for a zero-rate taxable supply');
    }
    if (component.recoveryBasisPoints !== 0 && (input.direction === 'sale' ||
      component.treatment !== 'taxable' || ['PST', 'RST'].includes(component.kind))) {
      throw new Error('Recovery is only supported for taxable purchase GST/HST/QST');
    }
  }
  if (kinds.has('HST') && kinds.size !== 1) throw new Error('HST cannot be combined with other components');
  if (['PST', 'RST', 'QST'].filter(kind => kinds.has(kind as TaxKind)).length > 1) {
    throw new Error('A line must not combine multiple provincial tax regimes');
  }

  const rate = sum(input.components.map(component => component.rateMilliPercent));
  const denominator = input.priceMode === 'inclusive' ? RATE_SCALE + BigInt(rate) : RATE_SCALE;
  const components = input.components.map(component => {
    const taxMinor = roundRatio(BigInt(input.amountMinor) * BigInt(component.rateMilliPercent), denominator);
    const recoverableMinor = roundRatio(BigInt(taxMinor) * BigInt(component.recoveryBasisPoints), RECOVERY_SCALE);
    return {
      ...component,
      taxMinor,
      recoverableMinor,
      nonRecoverableMinor: input.direction === 'purchase' ? taxMinor - recoverableMinor : 0,
      outputTaxMinor: input.direction === 'sale' ? taxMinor : 0,
    };
  });
  const taxMinor = sum(components.map(component => component.taxMinor));
  const netMinor = input.priceMode === 'inclusive' ? sum([input.amountMinor, -taxMinor]) : input.amountMinor;
  return {
    netMinor,
    taxMinor,
    grossMinor: input.priceMode === 'inclusive' ? input.amountMinor : sum([netMinor, taxMinor]),
    recoverableMinor: sum(components.map(component => component.recoverableMinor)),
    nonRecoverableMinor: sum(components.map(component => component.nonRecoverableMinor)),
    outputTaxMinor: sum(components.map(component => component.outputTaxMinor)),
    components,
  };
}
