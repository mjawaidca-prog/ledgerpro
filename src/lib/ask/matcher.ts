/**
 * Ask-your-books — the deterministic matcher (Phase 3 item 4, pure).
 *
 * Turns a plain-language question into a library selection using
 * keyword anchors and phrase extraction. It ALWAYS works (no API key,
 * no network) and it is deliberately conservative:
 *
 *  - advice-seeking, predictions, and commands (delete / pay / file)
 *    refuse up front — they are not questions the library can ground;
 *  - an intent fires only when its anchor words are present, checked
 *    in a fixed priority order so specific subjects (payroll, GST,
 *    CCA, loans) beat the generic spend/revenue anchors they overlap;
 *  - anything ambiguous returns null, and the service falls back to
 *    the LLM selector (when configured) or an honest refusal.
 *
 * The matcher's output still passes through validateSelection before
 * anything executes — the matcher proposes, the validator disposes.
 */

import { resolveMonthPeriod, type PeriodContext } from './periods';
import type { PeriodInput, Selection } from './intents';

// ── Refusal pre-check: not a groundable question ─────────────────────

const NOT_A_QUESTION =
  /\b(should (i|we)|advise|advice|recommend|delete|remove|erase|pay (the|our|this)|file (my|our|the)|predict|forecast|will (we|our|revenue|sales)|going to|going forward|invest|hire|fire)\b/;

// ── Period phrases ───────────────────────────────────────────────────

const MONTH_LOOKUP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

interface PeriodExtraction {
  period: PeriodInput;
  /** The question text with the period phrase removed (for category extraction). */
  rest: string;
}

const NAMED_PHRASES: { pattern: RegExp; named: (ctx: PeriodContext) => string }[] = [
  { pattern: /\blast 30 days\b/, named: () => 'last_30_days' },
  { pattern: /\blast 90 days\b/, named: () => 'last_90_days' },
  { pattern: /\blast 12 months\b/, named: () => 'last_12_months' },
  { pattern: /\bpast 30 days\b/, named: () => 'last_30_days' },
  { pattern: /\bpast 90 days\b/, named: () => 'last_90_days' },
  { pattern: /\bthis quarter\b/, named: () => 'this_quarter' },
  { pattern: /\blast quarter\b/, named: () => 'last_quarter' },
  { pattern: /\bthis month\b/, named: () => 'this_month' },
  { pattern: /\blast month\b/, named: () => 'last_month' },
  { pattern: /\bthis fiscal year\b/, named: (ctx) => (ctx.fiscalYearStart ? 'this_fiscal_year' : 'this_calendar_year') },
  { pattern: /\blast fiscal year\b/, named: (ctx) => (ctx.fiscalYearStart ? 'last_fiscal_year' : 'last_calendar_year') },
  { pattern: /\b(year to date|ytd)\b/, named: (ctx) => (ctx.fiscalYearStart ? 'this_fiscal_year' : 'this_calendar_year') },
  { pattern: /\bthis year\b/, named: (ctx) => (ctx.fiscalYearStart ? 'this_fiscal_year' : 'this_calendar_year') },
  { pattern: /\blast year\b/, named: (ctx) => (ctx.fiscalYearStart ? 'last_fiscal_year' : 'last_calendar_year') },
];

function extractPeriod(text: string, ctx: PeriodContext): { extraction: PeriodExtraction | null; text: string } {
  // Named phrases — first occurrence in the text wins.
  let best: { index: number; length: number; named: string } | null = null;
  for (const entry of NAMED_PHRASES) {
    const m = entry.pattern.exec(text);
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index, length: m[0].length, named: entry.named(ctx) };
    }
  }
  if (best) {
    const rest = `${text.slice(0, best.index)} ${text.slice(best.index + best.length)}`.replace(/\s+/g, ' ').trim();
    return { extraction: { period: { named: best.named }, rest }, text: rest };
  }
  // "in March 2026" / "March 2026" / "March"
  const monthMatch = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/.exec(text)
    ?? /\bin (january|february|march|april|may|june|july|august|september|october|november|december)\b/.exec(text)
    ?? /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.exec(text);
  if (monthMatch) {
    const month1 = MONTH_LOOKUP[monthMatch[1]];
    const year = monthMatch[2] ? Number(monthMatch[2]) : null;
    const resolved = resolveMonthPeriod(month1, year, ctx);
    const rest = `${text.slice(0, monthMatch.index)} ${text.slice(monthMatch.index + monthMatch[0].length)}`.replace(/\s+/g, ' ').trim();
    return { extraction: { period: { start: resolved.start, end: resolved.end }, rest }, text: rest };
  }
  return { extraction: null, text };
}

// ── Parameter extraction ─────────────────────────────────────────────

function extractDays(text: string): number | null {
  const m =
    /\b(?:over|older than|more than|past|at least)\s+(\d{1,4})\s+days?\b/.exec(text) ??
    /\b(\d{1,4})\s*\+?\s+days?\s+(?:overdue|old|or older)\b/.exec(text);
  return m ? Number(m[1]) : null;
}

function extractLimit(text: string): number | null {
  const m = /\btop\s+(\d{1,2})\b/.exec(text);
  return m ? Number(m[1]) : null;
}

function extractCategory(text: string): string | null {
  const cleaned = text.trim().replace(/[?.!]+$/, '').trim();
  const m = /\b(?:spend|spent|spending|expense|expenses|cost|costs)\b[^?.]*?\bon\s+([a-z0-9][a-z0-9 &'\-.]*)$/.exec(cleaned);
  if (!m) return null;
  // A trailing preposition is period-phrase residue ("spend on office
  // supplies in [March 2026]"), not part of the category.
  const candidate = m[1].replace(/\s+/g, ' ').trim().replace(/\s+(in|for|during|of)$/, '');
  if (candidate.length === 0 || candidate.length > 80) return null;
  // A trailing generic word means the phrase was not a category
  // ("spend on average", "spent on the business").
  if (/^(average|the|a|an|business|everything|nothing)$/.test(candidate)) return null;
  return candidate;
}

// ── Intent anchors ───────────────────────────────────────────────────

const ANCHORS = {
  gst: /\b(gst|hst|sales tax|net tax|input tax credits?|itcs?)\b/,
  payroll: /\b(payroll|wages?|salaries|salary|source deductions)\b/,
  cca: /\b(cca|ucc|capital cost allowance|depreciation|asset register|fixed assets?|net book value|book value)\b/,
  loans: /\b(loans?|lender|borrowed|borrowing|next (loan )?payment)\b/,
  owes: /\b(owes?|owed|owing|receivables?|overdue|outstanding|unpaid)\b/,
  owesContext: /\b(invoices?|customers?|clients?|money|us|receivables?)\b/,
  top: /\b(top|biggest|largest|best|most)\b/,
  customers: /\b(customers?|clients?)\b/,
  vendors: /\b(vendors?|suppliers?)\b/,
  cash: /\b(cash|bank balances?|money in the bank|bank accounts?)\b/,
  revenue: /\b(revenue|sales|income|earn(?:ed|ings?)?|turnover|gross profit|net income)\b/,
  spend: /\b(spend|spent|spending|expenses?|costs?|outgoings)\b/,
};

/**
 * Match a question to a library selection, or return null when the
 * question cannot be grounded in the library.
 */
export function matchQuestion(question: string, ctx: PeriodContext): Selection | null {
  const original = typeof question === 'string' ? question : '';
  const text = ` ${original.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  if (text.trim().length < 3) return null;
  if (NOT_A_QUESTION.test(text)) return null;

  const { extraction, text: rest } = extractPeriod(text, ctx);
  const periodParam: Record<string, unknown> = extraction ? { period: extraction.period } : {};
  const days = extractDays(text);
  const limit = extractLimit(text);

  const has = (re: RegExp) => re.test(text);

  // Priority order — specific subjects before generic anchors.
  if (has(ANCHORS.gst)) {
    return { intentId: 'gst_position', params: { ...periodParam } };
  }
  if (has(ANCHORS.payroll)) {
    return { intentId: 'payroll_cost', params: { ...periodParam } };
  }
  if (has(ANCHORS.cca)) {
    return { intentId: 'cca_by_class', params: {} };
  }
  if (has(ANCHORS.loans)) {
    return { intentId: 'loan_balances', params: {} };
  }
  if (has(ANCHORS.owes) && has(ANCHORS.owesContext)) {
    const params: Record<string, unknown> = {};
    if (days !== null) params.days = days;
    if (limit !== null) params.limit = limit;
    return { intentId: 'receivables_overdue', params };
  }
  if (has(ANCHORS.top) && has(ANCHORS.customers)) {
    const params: Record<string, unknown> = { ...periodParam };
    if (limit !== null) params.limit = limit;
    return { intentId: 'top_customers', params };
  }
  if (has(ANCHORS.top) && has(ANCHORS.vendors)) {
    const params: Record<string, unknown> = { ...periodParam };
    if (limit !== null) params.limit = limit;
    return { intentId: 'top_vendors', params };
  }
  if (has(ANCHORS.cash) && !/\bcash flow\b/.test(text)) {
    return { intentId: 'cash_by_account', params: {} };
  }
  if (has(ANCHORS.revenue) && !has(ANCHORS.spend)) {
    return { intentId: 'revenue_for_period', params: { ...periodParam } };
  }
  if (has(ANCHORS.spend)) {
    const params: Record<string, unknown> = { ...periodParam };
    const category = extractCategory(rest);
    if (category) params.category = category;
    return { intentId: 'spend_by_category', params };
  }
  return null;
}
