/**
 * Bank rules — pure matching, no DB. Ordered ascending, first-match-wins.
 * A rule with `setCategoryCode: null` means "Leave for matching" — it still
 * hits and sets its other fields. Auto-post defaults off: a rule that only
 * fills the category still leaves the row in the queue for a human.
 */

export interface BankRuleLike {
  id: string;
  name: string;
  order: number;
  op: 'contains' | 'is' | 'starts_with';
  value: string;
  anyOf: string[];
  scope: { accountIds: string[] | 'all'; direction: 'in' | 'out' | 'both' };
  setCategoryCode: string | null;
  setTaxCode: string | null;
  setTaxRate: number | null;
  setTaxInclusive: boolean;
  setContactId: string | null;
  autoPost: boolean;
  enabled: boolean;
}

export interface RuleRow {
  description: string;
  amount: number;
  accountId: string;
}

export interface RuleHit {
  rule: BankRuleLike;
  categoryCode: string | null;
  taxCode: string | null;
  taxRate: number | null;
  taxInclusive: boolean;
  contactId: string | null;
  autoPost: boolean;
}

export function ruleMatches(rule: BankRuleLike, row: RuleRow): boolean {
  if (!rule.enabled) return false;

  // Scope: account + direction.
  if (rule.scope.accountIds !== 'all' && !rule.scope.accountIds.includes(row.accountId)) return false;
  const direction = row.amount > 0 ? 'in' : 'out';
  if (rule.scope.direction !== 'both' && rule.scope.direction !== direction) return false;

  const desc = row.description.toUpperCase().trim();
  const candidates = [rule.value, ...(rule.anyOf ?? [])].map((v) => v.toUpperCase().trim());

  return candidates.some((value) => {
    if (!value) return false;
    switch (rule.op) {
      case 'is':
        return desc === value;
      case 'starts_with':
        return desc.startsWith(value);
      case 'contains':
      default:
        return desc.includes(value);
    }
  });
}

export function applyRules(rules: BankRuleLike[], row: RuleRow): RuleHit | null {
  const ordered = [...rules].filter((r) => r.enabled).sort((a, b) => a.order - b.order);
  for (const rule of ordered) {
    if (!ruleMatches(rule, row)) continue;
    return {
      rule,
      categoryCode: rule.setCategoryCode,
      taxCode: rule.setTaxCode,
      taxRate: rule.setTaxRate,
      taxInclusive: rule.setTaxInclusive,
      contactId: rule.setContactId,
      autoPost: rule.autoPost,
    };
  }
  return null;
}
