/**
 * GIFI code suggestions for user-created accounts (Slice 3 of the
 * chart-of-accounts GIFI plan, §4.3).
 *
 * Suggestions are a convenience, NEVER an assignment: this module only
 * computes candidates. A code reaches an account only when the user
 * picks it — in the picker, where suggestions are pinned under a
 * "Suggested — tap to use" label, or in the readiness worklist — and
 * saves the form. Nothing here writes anything.
 *
 * Two rules, in order:
 *  1. TEMPLATE TWIN — the account's name matches a pre-coded template
 *     account's name (same account type), or a known synonym of one
 *     ("Meals" ≈ the template's "Meals & Entertainment"). The twin
 *     table below mirrors the coded accounts of DEFAULT_CHART_OF_
 *     ACCOUNTS and CORPORATION_CHART_OF_ACCOUNTS in
 *     src/lib/default-coa.ts; it is duplicated here (rather than
 *     imported) because that module pulls in the server db client and
 *     this one must stay client-safe. A unit test cross-checks every
 *     coded template account against this table, so the two cannot
 *     drift apart silently.
 *  2. KEYWORD RULES — a small hand-kept list keyed on words
 *     accountants actually use in account names ("rent", "insurance",
 *     "bank charges"…). A rule may offer a shortlist (rent → 8910 with
 *     8911/8914); the user chooses.
 *
 * Every candidate is filtered to assignable codes whose catalogue
 * section fits the account type (an expense account is never suggested
 * an asset code) — the same sections the picker defaults to. Design-
 * exempt accounts (Retained Earnings, Opening Balance Equity, owner's
 * capital/draw) get no suggestions: they stay uncoded on purpose.
 */

import { getGifiEntry, gifiOptionsForAccountType, isPickableGifiCode } from '@/lib/gifi';
import { isGifiDesignExempt, normalizeAccountName } from '@/lib/gifi-readiness';

export interface GifiSuggestion {
  code: string;
  /** Official CRA description, for display next to the code. */
  description: string;
  source: 'template' | 'keyword';
  /** Plain-language why, e.g. 'Matches the template account "Insurance"'. */
  reason: string;
}

export interface GifiSuggestionInput {
  name: string;
  type: string;
  detailType?: string | null;
  subType?: string | null;
  gifiCode?: string | null;
}

const MAX_SUGGESTIONS = 3;

// ── Rule 1: template twins ───────────────────────────────────────────
// [normalized template name, account type, GIFI code] — mirrors the
// coded accounts of both chart templates (see header note).

const TEMPLATE_TWINS: readonly (readonly [string, string, string])[] = [
  ['bank accounts', 'asset', '1002'],
  ['business checking', 'asset', '1002'],
  ['business savings', 'asset', '1002'],
  ['undeposited funds', 'asset', '1007'],
  ['petty cash', 'asset', '1001'],
  ['accounts receivable', 'asset', '1062'],
  ['prepaid expenses', 'asset', '1484'],
  ['furniture & equipment', 'asset', '1787'],
  ['due from shareholder', 'asset', '1301'],
  ['credit cards', 'liability', '2707'],
  ['business credit card', 'liability', '2707'],
  ['accounts payable', 'liability', '2620'],
  ['sales tax payable', 'liability', '2680'],
  ['gst/hst recoverable — input tax credits', 'asset', '1480'],
  ['provincial sales tax payable', 'liability', '2680'],
  ['qst payable', 'liability', '2680'],
  ['qst recoverable — input tax refunds', 'asset', '1480'],
  ['payroll liabilities', 'liability', '2627'],
  ['cpp payable', 'liability', '2627'],
  ['ei payable', 'liability', '2627'],
  ['income tax payable', 'liability', '2627'],
  ['wages payable', 'liability', '2624'],
  ['loans payable', 'liability', '3140'],
  ['due to shareholder', 'liability', '2781'],
  ['share capital', 'equity', '3500'],
  ['product sales', 'income', '8000'],
  ['service revenue', 'income', '8000'],
  ['other income', 'income', '8230'],
  ['fx gain (realized)', 'income', '8230'],
  ['fx gain/loss (unrealized)', 'income', '8230'],
  ['fx rounding', 'income', '8230'],
  ['cost of goods sold', 'expense', '8320'],
  ['software & subscriptions', 'expense', '8810'],
  ['professional fees', 'expense', '8860'],
  ['rent & lease', 'expense', '8910'],
  ['marketing', 'expense', '8520'],
  ['travel', 'expense', '9200'],
  ['utilities', 'expense', '9220'],
  ['meals & entertainment', 'expense', '8523'],
  ['office supplies', 'expense', '8810'],
  ['bank fees', 'expense', '8715'],
  ['insurance', 'expense', '8690'],
  ['payroll expense', 'expense', '9060'],
  ['repairs & maintenance', 'expense', '8960'],
  ['employer payroll taxes expense', 'expense', '8622'],
];

/** Known synonyms: account names users write that mean a template account. */
const NAME_SYNONYMS: Readonly<Record<string, string>> = {
  'meals': 'meals & entertainment',
  'meals and entertainment': 'meals & entertainment',
  'furniture and equipment': 'furniture & equipment',
  'subscriptions': 'software & subscriptions',
  'dues & subscriptions': 'software & subscriptions',
  'office expense': 'office supplies',
  'office expenses': 'office supplies',
  'rent': 'rent & lease',
  'lease': 'rent & lease',
};

// ── Rule 2: keyword shortlists ───────────────────────────────────────
// Matched in order against the normalized account name; the first
// matching rules contribute their codes (deduplicated, type-filtered).

interface KeywordRule {
  /** Any one of these substrings in the normalized name triggers the rule. */
  keywords: readonly string[];
  codes: readonly string[];
  reason: string;
}

const KEYWORD_RULES: readonly KeywordRule[] = [
  // Contra accounts first: "Accumulated Amortization — Furniture" must
  // land on the furniture contra code, not on a generic keyword.
  { keywords: ['accumulated amortization', 'accumulated depreciation', 'accumulated amortisation'], codes: ['1741'], reason: 'Accumulated amortization/depreciation accounts take a contra-asset code' },
  { keywords: ['vehicle', 'automobile', 'motor'], codes: ['1742', '1783'], reason: 'Vehicle accounts' },
  { keywords: ['recoverable', 'input tax credit', 'input tax refund'], codes: ['1480'], reason: 'Recoverable taxes are an asset (input tax credits/refunds)' },
  { keywords: ['sales tax', 'gst', 'hst', 'qst', 'pst', 'rst'], codes: ['2680'], reason: 'Sales taxes collected are taxes payable' },
  { keywords: ['shareholder'], codes: ['1301', '2781'], reason: 'Shareholder loan accounts' },
  { keywords: ['share capital', 'common shares'], codes: ['3500'], reason: 'Share capital' },
  { keywords: ['credit card'], codes: ['2707'], reason: 'Credit card balances' },
  { keywords: ['wages payable', 'salary payable', 'salaries payable'], codes: ['2624'], reason: 'Wages owing' },
  { keywords: ['cpp', 'ei payable', 'employee deduction', 'source deduction', 'payroll liabilit', 'payroll deduction'], codes: ['2627'], reason: 'Payroll deductions payable' },
  { keywords: ['accounts receivable', 'trade receivable', 'receivable'], codes: ['1062'], reason: 'Trade receivables' },
  { keywords: ['accounts payable', 'trade payable', 'payable'], codes: ['2620'], reason: 'Payables' },
  { keywords: ['prepaid'], codes: ['1484'], reason: 'Prepaid expenses' },
  { keywords: ['undeposited'], codes: ['1007'], reason: 'Undeposited funds' },
  { keywords: ['petty cash'], codes: ['1001'], reason: 'Cash on hand' },
  { keywords: ['loan', 'mortgage', 'debt'], codes: ['3140'], reason: 'Borrowings are long-term debt' },
  { keywords: ['employer'], codes: ['8622'], reason: "Employer's portion of employee benefits" },
  { keywords: ['salar', 'wage', 'payroll'], codes: ['9060'], reason: 'Salaries and wages' },
  { keywords: ['legal'], codes: ['8861', '8860'], reason: 'Legal fees' },
  { keywords: ['accounting fee', 'bookkeeping'], codes: ['8862', '8860'], reason: 'Accounting fees' },
  { keywords: ['professional'], codes: ['8860', '8861', '8862'], reason: 'Professional fees' },
  { keywords: ['rent', 'lease'], codes: ['8910', '8911', '8914'], reason: 'Rent — pick the generic or the real-estate/equipment detail' },
  { keywords: ['insurance'], codes: ['8690'], reason: 'Insurance' },
  { keywords: ['interest'], codes: ['8710', '8715'], reason: 'Interest and bank charges' },
  { keywords: ['bank fee', 'bank charge', 'bank fees', 'bank charges'], codes: ['8715', '8710'], reason: 'Bank charges' },
  { keywords: ['advertis', 'marketing', 'promotion'], codes: ['8520'], reason: 'Advertising and promotion' },
  { keywords: ['meals', 'entertainment'], codes: ['8523'], reason: 'Meals and entertainment' },
  { keywords: ['utilit'], codes: ['9220'], reason: 'Utilities' },
  { keywords: ['travel'], codes: ['9200'], reason: 'Travel expenses' },
  { keywords: ['repair', 'maintenance'], codes: ['8960'], reason: 'Repairs and maintenance' },
  { keywords: ['software', 'subscription', 'office'], codes: ['8810'], reason: 'Office expenses' },
  { keywords: ['revenue', 'sales'], codes: ['8000'], reason: 'Sales of goods and services' },
  { keywords: ['other income'], codes: ['8230'], reason: 'Other revenue' },
  { keywords: ['cost of goods', 'cogs', 'cost of sales'], codes: ['8320'], reason: 'Cost of materials' },
];

/**
 * Contra refinement: an "accumulated amortization/depreciation" account
 * gets the contra code for its asset family when the name names one.
 */
function contraCodeFor(normalizedName: string): string | null {
  if (normalizedName.includes('vehicle') || normalizedName.includes('motor')) return '1743';
  if (normalizedName.includes('furniture') || normalizedName.includes('fixture')) return '1788';
  if (normalizedName.includes('building')) return '1681';
  return null;
}

function fitsAccountType(code: string, accountType: string): boolean {
  const entry = getGifiEntry(code);
  if (!entry || !isPickableGifiCode(code)) return false;
  const scoped = gifiOptionsForAccountType(accountType);
  // Unknown account types get the full pickable list from
  // gifiOptionsForAccountType, so this stays permissive there.
  return scoped.some((e) => e.code === code);
}

function toSuggestion(code: string, source: GifiSuggestion['source'], reason: string): GifiSuggestion | null {
  const entry = getGifiEntry(code);
  if (!entry) return null;
  return { code, description: entry.description, source, reason };
}

/**
 * Suggested GIFI codes for an account — candidates only, best first.
 * An account that already carries a valid code gets no suggestions
 * (there is nothing to fix), and design-exempt accounts get none
 * (they stay uncoded on purpose).
 */
export function suggestGifiCodes(input: GifiSuggestionInput): GifiSuggestion[] {
  if (isGifiDesignExempt({ ...input, code: '' })) return [];
  const stored = (input.gifiCode ?? '').trim();
  if (stored !== '' && isPickableGifiCode(stored)) return [];

  const normalized = normalizeAccountName(input.name);
  if (!normalized) return [];

  // Rule 1 — template twin (exact name, or a known synonym of one).
  const twinName = NAME_SYNONYMS[normalized] ?? normalized;
  for (const [twin, type, code] of TEMPLATE_TWINS) {
    if (twin === twinName && type === input.type) {
      const s = toSuggestion(code, 'template', `Matches the template account “${twin}”`);
      return s ? [s] : [];
    }
  }

  // Rule 2 — keyword shortlists.
  const out: GifiSuggestion[] = [];
  const seen = new Set<string>();
  const push = (code: string, reason: string) => {
    if (seen.has(code) || out.length >= MAX_SUGGESTIONS) return;
    if (!fitsAccountType(code, input.type)) return;
    const s = toSuggestion(code, 'keyword', reason);
    if (!s) return;
    seen.add(code);
    out.push(s);
  };

  const contra = normalized.includes('accumulated') ? contraCodeFor(normalized) : null;
  if (contra) push(contra, 'Accumulated amortization/depreciation accounts take the contra code for their asset family');

  for (const rule of KEYWORD_RULES) {
    if (out.length >= MAX_SUGGESTIONS) break;
    if (rule.keywords.some((k) => normalized.includes(k))) {
      for (const code of rule.codes) push(code, rule.reason);
    }
  }

  return out;
}
