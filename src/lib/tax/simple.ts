/**
 * Phase 1 "simple path" tax for bank postings, categorization-rule postings
 * and manual journals. All arithmetic is delegated to the reviewed pure
 * engine (src/lib/tax/engine.ts); rates come from src/lib/taxes.ts (the
 * province table with effective-date history) — never hardcode a rate here.
 *
 * Scope (see docs + audit-2026-10-26/phase1-gst-design.md): one province of
 * supply per line (place-of-supply defaulting to the company province),
 * treatment implicitly `taxable` at that province's rates. GST/HST (and QST)
 * recoverability defaults to all-or-nothing per purchase line, but a line
 * may carry a fractional `recoveryPercent` (Phase 1 cleanup, partial
 * recovery — e.g. 50 for meals & entertainment) which then wins over the
 * boolean. PST/RST are never recoverable (the engine enforces this).
 * Zero-rated / exempt / out-of-scope
 * lines simply carry no tax spec in this path; the reviewed document path
 * (posting-service + snapshots) remains the evidenced-treatment tool.
 */
import { calculateTaxLine, type TaxComponentDecision, type TaxKind } from './engine';
import { getTaxRate, type Province } from '@/lib/taxes';

export type SimplePriceMode = 'inclusive' | 'exclusive';
export type SimpleDirection = 'sale' | 'purchase';

export interface SimpleTaxSpec {
  province: Province;
  priceMode: SimplePriceMode;
  /** Purchases only: claim the GST/HST (and QST) component as an ITC/ITR. Default true. Ignored for sales. */
  recoverable?: boolean;
  /**
   * Purchases only: fractional recovery, 0–100 (may be fractional, e.g.
   * 50 or 50.5). When present (not undefined/null) it WINS over
   * `recoverable`; when absent, the boolean applies (true → 100%,
   * false → 0%), and when both are absent behaviour is exactly the
   * pre-partial-recovery behaviour (100%). Out-of-range or non-finite
   * values throw a clear error (no clamping — a silently clamped ITC
   * fraction would misstate the return). Ignored for sales.
   */
  recoveryPercent?: number | null;
  /** Tax-point / transaction date for the effective-rate lookup. Defaults to today. */
  date?: Date | string;
}

export interface SimpleTaxComponent {
  kind: TaxKind;
  ratePct: number;
  tax: number;
  recoverable: number;
  nonrecoverable: number;
  output: number;
}

export interface SimpleTaxResult {
  net: number;
  tax: number;
  gross: number;
  /** GST/HST/QST the purchaser can claim (purchases, recoverable=true). */
  recoverableTax: number;
  /** Tax expensed into the line's own account (all PST/RST + non-recovered GST/HST/QST). */
  nonrecoverableTax: number;
  /** GST/HST collected on a sale — the GST/HST-return line-103 component. */
  outputGstHst: number;
  /** PST/RST collected on a sale — provincial payable, never in line 103. */
  outputPstRst: number;
  /** QST collected on a sale — Revenu Québec, excluded from the GST/HST return. */
  outputQst: number;
  components: SimpleTaxComponent[];
}

const toMinor = (n: number): number => Math.round(n * 100);
const toMajor = (n: number): number => n / 100;

/**
 * Component decisions for a province, from the shared rate table.
 * HST provinces yield a single HST component; QC's `pst` field in taxes.ts
 * is QST (9.975%, on the price excluding GST — the engine's same-base math
 * matches); BC/SK/MB yield GST + PST/RST with recovery forced to zero.
 */
/**
 * Recovery basis points (10000 = 100%) for GST/HST + QST components.
 * `recoveryPercent`, when present, wins over the `recoverable` boolean.
 * Throws on out-of-range / non-finite percents (see SimpleTaxSpec).
 */
export function recoveryBasisPoints(recoverable: boolean, recoveryPercent?: number | null): number {
  if (recoveryPercent !== undefined && recoveryPercent !== null) {
    if (typeof recoveryPercent !== 'number' || !Number.isFinite(recoveryPercent) || recoveryPercent < 0 || recoveryPercent > 100) {
      throw new Error(`recoveryPercent must be a number between 0 and 100 (got ${String(recoveryPercent)})`);
    }
    return Math.round(recoveryPercent * 100);
  }
  return recoverable ? 10000 : 0;
}

export function provinceComponents(
  province: Province,
  direction: SimpleDirection,
  recoverable: boolean,
  date?: Date | string,
  recoveryPercent?: number | null,
): TaxComponentDecision[] {
  const rates = getTaxRate(province, date ?? new Date());
  // Validate the percent even for sales (where recovery is forced to 0 by
  // the engine) so a malformed value fails loudly instead of being ignored.
  const purchaseRecovery = recoveryBasisPoints(recoverable, recoveryPercent);
  const recovery = direction === 'purchase' ? purchaseRecovery : 0;
  const out: TaxComponentDecision[] = [];
  if (rates.hst > 0) {
    out.push({ kind: 'HST', treatment: 'taxable', rateMilliPercent: Math.round(rates.hst * 1000), recoveryBasisPoints: recovery });
    return out;
  }
  if (rates.gst > 0) {
    out.push({ kind: 'GST', treatment: 'taxable', rateMilliPercent: Math.round(rates.gst * 1000), recoveryBasisPoints: recovery });
  }
  if (rates.pst > 0) {
    const kind: TaxKind = province === 'QC' ? 'QST' : province === 'MB' ? 'RST' : 'PST';
    out.push({
      kind,
      treatment: 'taxable',
      rateMilliPercent: Math.round(rates.pst * 1000),
      // QST recovery (ITR) follows the recoverable flag; PST/RST never recover.
      recoveryBasisPoints: kind === 'QST' ? recovery : 0,
    });
  }
  return out;
}

/**
 * Compute the tax split for one line whose `amount` is in major units
 * (dollars). Inclusive: amount is the gross (tax = amount × rate/(100+rate)
 * per component via the engine). Exclusive: amount is the net.
 * Rounding: per component, half away from zero, inside the engine.
 */
export function computeSimpleLineTax(amount: number, spec: SimpleTaxSpec & { direction: SimpleDirection }): SimpleTaxResult {
  const components = provinceComponents(spec.province, spec.direction, spec.recoverable ?? true, spec.date, spec.recoveryPercent);
  if (components.length === 0) {
    // Province with no applicable components (defensive; every province has GST/HST today).
    return { net: amount, tax: 0, gross: amount, recoverableTax: 0, nonrecoverableTax: 0, outputGstHst: 0, outputPstRst: 0, outputQst: 0, components: [] };
  }
  const r = calculateTaxLine({
    amountMinor: toMinor(amount),
    priceMode: spec.priceMode,
    direction: spec.direction,
    components,
  });
  const byKind = (kinds: TaxKind[], pick: (c: (typeof r.components)[number]) => number) =>
    toMajor(r.components.filter((c) => kinds.includes(c.kind)).reduce((s, c) => s + pick(c), 0));
  return {
    net: toMajor(r.netMinor),
    tax: toMajor(r.taxMinor),
    gross: toMajor(r.grossMinor),
    recoverableTax: toMajor(r.recoverableMinor),
    nonrecoverableTax: toMajor(r.nonRecoverableMinor),
    outputGstHst: byKind(['GST', 'HST'], (c) => c.outputTaxMinor),
    outputPstRst: byKind(['PST', 'RST'], (c) => c.outputTaxMinor),
    outputQst: byKind(['QST'], (c) => c.outputTaxMinor),
    components: r.components.map((c) => ({
      kind: c.kind,
      ratePct: c.rateMilliPercent / 1000,
      tax: toMajor(c.taxMinor),
      recoverable: toMajor(c.recoverableMinor),
      nonrecoverable: toMajor(c.nonRecoverableMinor),
      output: toMajor(c.outputTaxMinor),
    })),
  };
}

/** Default GL codes for the simple path (config mappings override these). */
export const SIMPLE_TAX_ACCOUNT_CODES = {
  output: '2300', // Sales Tax Payable (existing default COA account)
  recoverable: '2310', // GST/HST Recoverable — Input Tax Credits (Phase 1 default COA)
  pstPayable: '2330', // Provincial Sales Tax Payable (Phase 1 default COA)
  qstOutput: '2340', // QST Payable (Phase 1 cleanup default COA)
  qstRecoverable: '2350', // QST Recoverable — Input Tax Refunds (Phase 1 cleanup default COA)
} as const;

export interface ResolvedTaxAccounts {
  output: string;
  recoverable: string;
  pstPayable: string;
  qstOutput: string;
  qstRecoverable: string;
}

/**
 * Resolve the GL accounts a simple-path posting must use. Company tax
 * configuration mappings win; otherwise the default codes. `availableCodes`
 * is the company's COA code set — the caller (posting path) ensures 2310 /
 * 2330 exist before posting recoverable / PST amounts (see accounts.ts);
 * resolution itself is pure.
 */
export function resolveSimpleTaxAccounts(input: {
  configuration?: {
    gstHstOutputAccount?: { code: string } | null;
    gstHstRecoverableAccount?: { code: string } | null;
    pstRstPayableAccount?: { code: string } | null;
    qstOutputAccount?: { code: string } | null;
    qstRecoverableAccount?: { code: string } | null;
  } | null;
}): ResolvedTaxAccounts {
  const c = input.configuration;
  return {
    output: c?.gstHstOutputAccount?.code ?? SIMPLE_TAX_ACCOUNT_CODES.output,
    recoverable: c?.gstHstRecoverableAccount?.code ?? SIMPLE_TAX_ACCOUNT_CODES.recoverable,
    pstPayable: c?.pstRstPayableAccount?.code ?? SIMPLE_TAX_ACCOUNT_CODES.pstPayable,
    // QST defaults are its OWN accounts (2340/2350), not the GST/HST pair:
    // before the QST-return cleanup, unmapped QST fell back to 2300/2310
    // and mixed into the GST/HST balances. Config mappings still win.
    qstOutput: c?.qstOutputAccount?.code ?? SIMPLE_TAX_ACCOUNT_CODES.qstOutput,
    qstRecoverable: c?.qstRecoverableAccount?.code ?? SIMPLE_TAX_ACCOUNT_CODES.qstRecoverable,
  };
}
