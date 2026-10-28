/**
 * Receipt suggestions — category + tax, built ONLY from machinery the
 * product already trusts:
 *
 * - Category: the company's own rules, evaluated with the shared engines —
 *   Settings → Categorization rules first (`matchCategorizationRule`,
 *   priority order), then Banking → Rules (`applyRules`, first-match-wins).
 *   That is the same precedence statement import uses (bank rules stamp
 *   first there; here a categorization rule is preferred because it maps
 *   to a category id directly and can carry a tax stamp).
 * - Tax: the suggestion is a province (the company's province of supply),
 *   NOT a hand-computed split. At posting time the Phase 1 simple path
 *   expands the province into its components — recoverable GST/HST to the
 *   ITC account (2310), QST to 2350, PST/RST non-recoverable — exactly as
 *   it does for a rule-stamped row. The dollar figure shown to the user is
 *   the receipt's own tax line when OCR found one, else an inclusive
 *   back-out estimate at the province's combined rate.
 *
 * Pure: callers load the rules; this file never touches the DB.
 */
import { applyRules, type BankRuleLike } from '@/lib/banking/rules';
import {
  matchCategorizationRule,
  type CategorizationRuleRecord,
} from '@/lib/banking/categorization-apply';
import { inclusiveTaxAmount, type SplitLine } from '@/lib/banking/splits';
import { getTaxRate, type Province } from '@/lib/taxes';

export interface ReceiptSuggestionInput {
  merchant: string | null;
  /** Positive receipt total (money out). */
  total: number | null;
  /** Company province — the default province of supply (e.g. "AB"). */
  province: string | null;
  /** Tax printed on the receipt, when the parser found it. */
  receiptTaxAmount: number | null;
  categorizationRules: CategorizationRuleRecord[];
  bankRules: BankRuleLike[];
  /** Bank account the receipt will attach to, when known (rule scope). */
  accountId?: string | null;
}

export interface ReceiptSuggestion {
  categoryId: string | null;
  categoryCode: string | null;
  source: 'categorization_rule' | 'bank_rule' | null;
  ruleId: string | null;
  ruleName: string | null;
  /** Province to stamp on the split; null when no province is known. */
  taxProvince: string | null;
  /** Combined province rate (percent) for display, when known. */
  provinceRatePct: number | null;
  /** Receipt tax if printed, else the inclusive back-out estimate. */
  estimatedTaxAmount: number | null;
}

export function suggestForReceipt(input: ReceiptSuggestionInput): ReceiptSuggestion {
  const merchant = (input.merchant ?? '').trim();
  const total = input.total ?? 0;

  let categoryId: string | null = null;
  let categoryCode: string | null = null;
  let source: ReceiptSuggestion['source'] = null;
  let ruleId: string | null = null;
  let ruleName: string | null = null;

  if (merchant) {
    // Categorization rules: priority order (highest first), as the loader
    // returns them; sort a copy so callers cannot pass them unordered.
    const ordered = [...input.categorizationRules].sort((a, b) => (b as any).priority - (a as any).priority);
    const hit = matchCategorizationRule(ordered as CategorizationRuleRecord[], {
      id: '',
      description: merchant,
      merchant,
      rawStatementText: merchant,
      amount: -Math.abs(total),
    });
    if (hit) {
      categoryId = hit.categoryId;
      categoryCode = hit.category.code;
      source = 'categorization_rule';
      ruleId = hit.id;
      ruleName = hit.name;
    } else {
      const bankHit = applyRules(input.bankRules, {
        description: merchant,
        amount: -Math.abs(total),
        accountId: input.accountId ?? '',
      });
      if (bankHit && bankHit.categoryCode) {
        categoryCode = bankHit.categoryCode;
        source = 'bank_rule';
        ruleId = bankHit.rule.id;
        ruleName = bankHit.rule.name;
      }
    }
  }

  const province = input.province && input.province.length === 2 ? input.province : null;
  let provinceRatePct: number | null = null;
  if (province) {
    try {
      provinceRatePct = getTaxRate(province as Province).totalRate;
    } catch {
      provinceRatePct = null;
    }
  }

  const estimatedTaxAmount =
    input.receiptTaxAmount ??
    (total > 0 && provinceRatePct ? inclusiveTaxAmount(total, provinceRatePct) : null);

  return {
    categoryId,
    categoryCode,
    source,
    ruleId,
    ruleName,
    taxProvince: province,
    provinceRatePct,
    estimatedTaxAmount,
  };
}

/**
 * The single split line the confirm action sends to the EXISTING split
 * endpoint — the same shape `buildRuleTaxSplit` stamps for a tax-enabled
 * categorization rule, so a receipt-confirmed row posts identically to a
 * rule-categorized row. Amount is the transaction's |amount| (the caller
 * passes it; it must equal the bank row to the cent, split route enforces).
 */
export function buildReceiptSplit(input: {
  categoryCode: string;
  amount: number;
  taxProvince: string | null;
}): SplitLine {
  return {
    categoryCode: input.categoryCode,
    amount: Math.abs(input.amount),
    taxCode: input.taxProvince ? `Tax — ${input.taxProvince}` : null,
    taxRate: null,
    taxInclusive: true,
    ...(input.taxProvince
      ? { taxProvince: input.taxProvince, taxRecoverable: true }
      : {}),
  };
}
