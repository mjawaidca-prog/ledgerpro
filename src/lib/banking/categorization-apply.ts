/**
 * Shared engine for Settings → Categorization rules.
 *
 * Extracted from POST /api/categorization-rules/apply so the manual Apply
 * endpoint and the statement-import commit path run the EXACT same
 * matching / tax-stamp / bookkeeping semantics — no divergent copy.
 *
 * Matching (unchanged from the original route): rules are evaluated in
 * priority order (highest first); the first matching rule wins and the
 * transaction is stamped with the rule's category, status 'categorized',
 * and — for tax-enabled rules — a single tax split built by
 * buildRuleTaxSplit, so posting the row splits tax identically to a
 * manually split row. The winning rule's matchCount / lastMatchedAt are
 * bumped, exactly as the manual apply has always done.
 */
import { Prisma } from '@prisma/client';
import { buildRuleTaxSplit, type RuleTaxFields } from './rule-tax';
import type { SplitLine } from './splits';
import { findFiledLockForDate } from '@/lib/tax/filed-lock';

/** A CategorizationRule row with its category code resolved. */
export interface CategorizationRuleRecord extends RuleTaxFields {
  id: string;
  name: string;
  pattern: string;
  patternType: string;
  minAmount: unknown;
  maxAmount: unknown;
  categoryId: string;
  category: { code: string };
}

/** The transaction fields the matcher and stamper read. */
export interface CategorizationTarget {
  id: string;
  description: string;
  merchant: string | null;
  rawStatementText: string | null;
  amount: number;
  /** Needed only for the filed-period lock probe (import path). */
  date?: Date | string;
}

export interface CategorizationApplySummary {
  matched: number;
  activeRuleCount: number;
  ruleNames: string[];
  skippedLocked: number;
}

/** The one and only CategorizationRule matcher (first-match-wins upstream). */
export function categorizationRuleMatches(rule: CategorizationRuleRecord, tx: CategorizationTarget): boolean {
  switch (rule.patternType) {
    case 'merchant_match':
      return (tx.merchant?.toLowerCase().trim() || '') === rule.pattern.toLowerCase().trim();
    case 'description_contains': {
      // Search description + merchant + rawStatementText
      const searchText = [
        tx.description || '',
        tx.merchant || '',
        tx.rawStatementText || '',
      ].join(' ').toLowerCase().trim();
      const searchPattern = rule.pattern.toLowerCase().trim();
      return searchText.includes(searchPattern);
    }
    case 'amount_range': {
      const txAmt = Math.abs(Number(tx.amount));
      const min = rule.minAmount ? Number(rule.minAmount) : 0;
      const max = rule.maxAmount ? Number(rule.maxAmount) : Infinity;
      return txAmt >= min && txAmt <= max;
    }
    case 'regex':
      try {
        return new RegExp(rule.pattern, 'i').test(tx.description);
      } catch { return false; }
    default:
      return false;
  }
}

/** First rule (priority order) matching the transaction, or null. */
export function matchCategorizationRule(
  rules: CategorizationRuleRecord[],
  tx: CategorizationTarget,
): CategorizationRuleRecord | null {
  for (const rule of rules) {
    if (categorizationRuleMatches(rule, tx)) return rule;
  }
  return null;
}

/** Load a company's active rules in evaluation order (priority desc). */
export async function loadActiveCategorizationRules(
  client: any,
  companyId: string,
): Promise<CategorizationRuleRecord[]> {
  const rules = await client.categorizationRule.findMany({
    where: { companyId, active: true },
    orderBy: { priority: 'desc' },
    include: { category: { select: { code: true } } },
  });
  return rules as CategorizationRuleRecord[];
}

/**
 * True when stamping `split` on a row dated `date` would put a tax line
 * inside a filed GST/HST period — the filed-period hard lock's
 * non-throwing probe. Shared by the mutating apply (skip the row) and
 * the import dry-run (don't promise the match), so preview == commit.
 * Never throws: a probe failure reads as "not blocked".
 */
export async function taxStampBlockedByFiledLock(
  client: any,
  input: { companyId: string; categoryCode: string; split: SplitLine | null; date?: Date | string },
): Promise<boolean> {
  if (!input.split || !input.date) return false;
  const locked = await findFiledLockForDate(
    {
      companyId: input.companyId,
      date: input.date,
      lines: [{ accountCode: input.categoryCode, hasTaxSpec: true, taxProvince: input.split.taxProvince }],
    },
    client,
  ).catch(() => null);
  return locked !== null;
}

/**
 * Run the rules over the given transactions, stamping matches in place.
 *
 * `client` is any Prisma-like client (the app db, or the import's
 * transaction client) — the caller owns the surrounding transaction.
 *
 * When `skipTaxRowsInFiledPeriods` is set (import path), a match whose
 * tax stamp would expand onto the tax accounts is probed against the
 * filed-period hard lock (findFiledLockForDate, the non-throwing probe):
 * a row dated inside a filed GST/HST period is left uncategorized and
 * counted in `skippedLocked` instead of being stamped — the lock must
 * never fail the surrounding import. Non-tax matches are never skipped:
 * categorizing alone cannot move the filed figures, and the lock still
 * guards the eventual posting in postBankRow.
 */
export async function applyCategorizationRules(
  client: any,
  input: {
    companyId: string;
    transactions: CategorizationTarget[];
    rules?: CategorizationRuleRecord[];
    skipTaxRowsInFiledPeriods?: boolean;
  },
): Promise<CategorizationApplySummary> {
  const rules = input.rules ?? (await loadActiveCategorizationRules(client, input.companyId));
  const summary: CategorizationApplySummary = {
    matched: 0,
    activeRuleCount: rules.length,
    ruleNames: [],
    skippedLocked: 0,
  };
  if (rules.length === 0 || input.transactions.length === 0) return summary;

  const ruleNames = new Set<string>();

  for (const tx of input.transactions) {
    const rule = matchCategorizationRule(rules, tx);
    if (!rule) continue;

    // A tax-enabled rule also stamps its tax treatment as a single split,
    // so posting this row splits tax exactly like a manually split row.
    // Non-tax rules leave splits untouched.
    const split = buildRuleTaxSplit(rule, { categoryCode: rule.category.code, amount: Number(tx.amount) });

    if (split && input.skipTaxRowsInFiledPeriods) {
      const blocked = await taxStampBlockedByFiledLock(client, {
        companyId: input.companyId,
        categoryCode: rule.category.code,
        split,
        date: tx.date,
      });
      if (blocked) {
        summary.skippedLocked++;
        continue;
      }
    }

    await client.transaction.update({
      where: { id: tx.id },
      data: {
        categoryId: rule.categoryId,
        status: 'categorized',
        ...(split ? { splits: [split] as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    await client.categorizationRule.update({
      where: { id: rule.id },
      data: { matchCount: { increment: 1 }, lastMatchedAt: new Date() },
    });
    summary.matched++;
    ruleNames.add(rule.name);
  }

  summary.ruleNames = [...ruleNames];
  return summary;
}
