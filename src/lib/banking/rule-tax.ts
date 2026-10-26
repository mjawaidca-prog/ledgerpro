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
}

export function buildRuleTaxSplit(
  rule: RuleTaxFields,
  input: { categoryCode: string; amount: number },
): SplitLine | null {
  if (!rule.taxEnabled) return null;
  return {
    categoryCode: input.categoryCode,
    amount: Math.abs(input.amount),
    taxCode: rule.taxProvince ? `Tax — ${rule.taxProvince}` : null,
    taxRate: null,
    taxInclusive: rule.taxInclusive,
    taxProvince: rule.taxProvince,
    taxRecoverable: rule.taxRecoverable,
  };
}
