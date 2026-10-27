/**
 * Phase 1: the tax stamp a tax-enabled CategorizationRule leaves on a
 * transaction it categorizes. The stamp is a single split in the exact
 * shape the banking splits posting path already consumes, so posting a
 * rule-categorized row splits tax identically to a manually split row.
 * Rules without tax enabled return null (behaviour unchanged).
 */
import type { SplitLine } from './splits';

export interface RuleTaxFields {
  taxEnabled: boolean;
  taxProvince: string | null;
  taxInclusive: boolean;
  taxRecoverable: boolean;
  /**
   * Fractional recovery 0–100, or null/absent for boolean semantics.
   * At runtime this may arrive as a Prisma Decimal (the DB column is
   * Decimal(5,2)) — it is normalised to a plain number for the split JSON.
   */
  taxRecoveryPercent?: number | null | { toString(): string };
}

export function buildRuleTaxSplit(
  rule: RuleTaxFields,
  input: { categoryCode: string; amount: number },
): SplitLine | null {
  if (!rule.taxEnabled) return null;
  const recoveryPercent =
    rule.taxRecoveryPercent === null || rule.taxRecoveryPercent === undefined
      ? null
      : Number(rule.taxRecoveryPercent);
  return {
    categoryCode: input.categoryCode,
    amount: Math.abs(input.amount),
    taxCode: rule.taxProvince ? `Tax — ${rule.taxProvince}` : null,
    taxRate: null,
    taxInclusive: rule.taxInclusive,
    taxProvince: rule.taxProvince,
    taxRecoverable: rule.taxRecoverable,
    // Only stamped when set, so legacy splits stay byte-identical.
    ...(recoveryPercent !== null ? { taxRecoveryPercent: recoveryPercent } : {}),
  };
}
