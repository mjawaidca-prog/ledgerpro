/**
 * Ask-your-books — the intent library (Phase 3 item 4, pure).
 *
 * THE grounding contract (LANDSCAPE-AI.md §5, item L1): this feature
 * answers ONLY from a fixed library of parameterized questions, each
 * executed over LedgerPro's own computed report figures. There is no
 * free-form query path and no model arithmetic. A selection — whether
 * it came from the deterministic matcher or from the LLM — is just an
 * intent id plus parameters, and it is worthless until it passes
 * `validateSelection` against the schemas declared here:
 *
 *  - the intent must exist in the library;
 *  - parameter keys must be exactly the ones the intent declares
 *    (an extra key — e.g. a model inventing an "amount" — rejects the
 *    whole selection);
 *  - values must be of the declared type and inside the declared
 *    range (out-of-range rejects, never clamps: a clamped answer
 *    would silently answer a different question than the one asked);
 *  - a period is either a named period from periods.ts or an explicit
 *    {start, end} pair of real dates, start ≤ end, spanning at most
 *    five years, and not ending in the future.
 */

import {
  isNamedPeriod,
  isValidYmd,
  resolveNamedPeriod,
  daysBetweenYmd,
  formatPeriodLabel,
  type PeriodContext,
  type ResolvedPeriod,
} from './periods';

// ── Parameter schemas ────────────────────────────────────────────────

export type ParamSpec =
  | { kind: 'period'; name: 'period' }
  | { kind: 'days'; name: 'days'; min: number; max: number; default: number }
  | { kind: 'limit'; name: 'limit'; min: number; max: number; default: number }
  | { kind: 'boolean'; name: string; default: boolean }
  | { kind: 'category'; name: 'category' };

/** A raw period value as a matcher/LLM may express it. */
export type PeriodInput = { named: string } | { start: string; end: string };

/** Validated parameters: periods are always resolved to exact dates. */
export interface ValidatedParams {
  period?: ResolvedPeriod;
  days?: number;
  limit?: number;
  compare?: boolean;
  category?: string;
  [key: string]: unknown;
}

export interface AskIntent {
  id: string;
  title: string;
  /** Canonical example questions — shown in the UI and in refusals. */
  examples: string[];
  /** The report whose computed figures the answer comes from. */
  sourceReport: { label: string; href: string };
  params: ParamSpec[];
}

const PERIOD: ParamSpec = { kind: 'period', name: 'period' };
const COMPARE: ParamSpec = { kind: 'boolean', name: 'compare', default: true };
const LIMIT: ParamSpec = { kind: 'limit', name: 'limit', min: 1, max: 25, default: 5 };

export const ASK_INTENTS: AskIntent[] = [
  {
    id: 'spend_by_category',
    title: 'Spending by category',
    examples: [
      'How much did we spend on fuel this quarter?',
      'What did we spend this month vs. last month?',
    ],
    sourceReport: { label: 'Profit & Loss', href: '/reports/profit-loss' },
    params: [PERIOD, COMPARE, { kind: 'category', name: 'category' }],
  },
  {
    id: 'revenue_for_period',
    title: 'Revenue for a period',
    examples: [
      'What was our revenue last quarter?',
      'How much did we earn this fiscal year?',
    ],
    sourceReport: { label: 'Profit & Loss', href: '/reports/profit-loss' },
    params: [PERIOD, COMPARE],
  },
  {
    id: 'receivables_overdue',
    title: 'Who owes us money',
    examples: [
      'Who owes us money over 60 days?',
      'Which customers have overdue invoices?',
    ],
    sourceReport: { label: 'Accounts Receivable Aging', href: '/reports/ar-aging' },
    params: [
      { kind: 'days', name: 'days', min: 0, max: 3650, default: 60 },
      { kind: 'limit', name: 'limit', min: 1, max: 25, default: 10 },
    ],
  },
  {
    id: 'top_customers',
    title: 'Top customers by revenue',
    examples: [
      'Who are our top 5 customers this year?',
      'Which clients brought in the most revenue last quarter?',
    ],
    sourceReport: { label: 'Accounts Receivable Aging', href: '/reports/ar-aging' },
    params: [PERIOD, LIMIT],
  },
  {
    id: 'top_vendors',
    title: 'Top vendors by spend',
    examples: [
      'Who are our biggest vendors this year?',
      'Which suppliers did we spend the most with last quarter?',
    ],
    sourceReport: { label: 'Accounts Payable Aging', href: '/reports/ap-aging' },
    params: [PERIOD, LIMIT],
  },
  {
    id: 'gst_position',
    title: 'GST/HST position',
    examples: [
      'What is our GST/HST position this quarter?',
      'How much GST do we owe for last quarter?',
    ],
    sourceReport: { label: 'GST/HST Return', href: '/reports/gst-hst-return' },
    params: [PERIOD],
  },
  {
    id: 'loan_balances',
    title: 'Loan balances and next payments',
    examples: [
      'What are our loan balances?',
      'When is the next payment on the Ford loan?',
    ],
    sourceReport: { label: 'Loans', href: '/loans' },
    params: [],
  },
  {
    id: 'cca_by_class',
    title: 'CCA register by class',
    examples: [
      "What's in the CCA register by class?",
      'What is the net book value of our equipment class?',
    ],
    sourceReport: { label: 'CCA Register', href: '/reports/cca-register' },
    params: [],
  },
  {
    id: 'cash_by_account',
    title: 'Cash by bank account',
    examples: [
      'How much cash do we have?',
      'What are our bank balances?',
    ],
    sourceReport: { label: 'Banking', href: '/banking' },
    params: [],
  },
  {
    id: 'payroll_cost',
    title: 'Payroll cost for a period',
    examples: [
      'What did payroll cost us last month?',
      'How much did we spend on wages this quarter?',
    ],
    sourceReport: { label: 'General Ledger', href: '/reports/general-ledger' },
    params: [PERIOD],
  },
];

export const ASK_INTENT_IDS = ASK_INTENTS.map((i) => i.id);

export function intentById(id: unknown): AskIntent | null {
  if (typeof id !== 'string') return null;
  return ASK_INTENTS.find((i) => i.id === id) ?? null;
}

// ── Selection validation ─────────────────────────────────────────────

export interface Selection {
  intentId: string;
  /** Raw parameters as produced by the matcher or the LLM. */
  params: Record<string, unknown>;
}

export type ValidationResult =
  | { ok: true; intent: AskIntent; params: ValidatedParams }
  | { ok: false; error: string };

const MAX_PERIOD_DAYS = 366 * 5;
const MAX_CATEGORY_LENGTH = 80;

/** Period to use when an intent takes one but the selection omitted it:
 *  the current fiscal year to date (or calendar year with no anchor). */
export function defaultPeriod(ctx: PeriodContext): ResolvedPeriod {
  const named = ctx.fiscalYearStart ? 'this_fiscal_year' : 'this_calendar_year';
  const resolved = resolveNamedPeriod(named, ctx);
  if (resolved) return resolved;
  return resolveNamedPeriod('this_calendar_year', ctx) as ResolvedPeriod;
}

function validatePeriod(raw: unknown, ctx: PeriodContext): { ok: true; period: ResolvedPeriod } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, period: defaultPeriod(ctx) };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'period must be an object' };
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if ('named' in obj) {
    if (keys.length !== 1) return { ok: false, error: 'period must not mix named and explicit dates' };
    if (!isNamedPeriod(obj.named)) return { ok: false, error: `unknown named period: ${String(obj.named)}` };
    const resolved = resolveNamedPeriod(obj.named, ctx);
    if (!resolved) return { ok: false, error: `named period ${obj.named} cannot be resolved for this company` };
    return { ok: true, period: resolved };
  }
  if ('start' in obj || 'end' in obj) {
    if (keys.length !== 2 || !('start' in obj) || !('end' in obj)) {
      return { ok: false, error: 'an explicit period needs exactly start and end' };
    }
    if (!isValidYmd(obj.start) || !isValidYmd(obj.end)) return { ok: false, error: 'period dates must be real YYYY-MM-DD dates' };
    const start = obj.start as string;
    const end = obj.end as string;
    if (start > end) return { ok: false, error: 'period start is after its end' };
    if (end > ctx.today) return { ok: false, error: 'period ends in the future' };
    if (daysBetweenYmd(start, end) > MAX_PERIOD_DAYS) return { ok: false, error: 'period spans more than five years' };
    return { ok: true, period: { start, end, label: formatPeriodLabel(start, end) } };
  }
  return { ok: false, error: 'period must name a period or give start and end dates' };
}

/**
 * Validate a raw selection against the library. This is the gate every
 * answer passes through — matcher output included (defence in depth:
 * a matcher bug must not be able to smuggle an out-of-range question
 * into an executor either).
 */
export function validateSelection(selection: Selection, ctx: PeriodContext): ValidationResult {
  const intent = intentById(selection?.intentId);
  if (!intent) return { ok: false, error: `unknown intent: ${String(selection?.intentId)}` };

  const raw = selection.params ?? {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'params must be an object' };

  const declared = new Map(intent.params.map((p) => [p.name, p]));
  for (const key of Object.keys(raw)) {
    if (!declared.has(key)) return { ok: false, error: `intent ${intent.id} has no parameter named ${key}` };
  }

  const params: ValidatedParams = {};
  for (const spec of intent.params) {
    const value = raw[spec.name];
    switch (spec.kind) {
      case 'period': {
        const result = validatePeriod(value, ctx);
        if (!result.ok) return result;
        params.period = result.period;
        break;
      }
      case 'days':
      case 'limit': {
        if (value === undefined || value === null) {
          params[spec.name] = spec.default;
          break;
        }
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          return { ok: false, error: `${spec.name} must be a whole number` };
        }
        if (value < spec.min || value > spec.max) {
          return { ok: false, error: `${spec.name} must be between ${spec.min} and ${spec.max}` };
        }
        params[spec.name] = value;
        break;
      }
      case 'boolean': {
        if (value === undefined || value === null) {
          params[spec.name] = spec.default;
          break;
        }
        if (typeof value !== 'boolean') return { ok: false, error: `${spec.name} must be true or false` };
        params[spec.name] = value;
        break;
      }
      case 'category': {
        if (value === undefined || value === null || value === '') break;
        if (typeof value !== 'string') return { ok: false, error: 'category must be text' };
        const cleaned = value.trim();
        if (cleaned.length === 0) break;
        if (cleaned.length > MAX_CATEGORY_LENGTH) return { ok: false, error: 'category is too long' };
        if (!/^[A-Za-z0-9 &'\-./]+$/.test(cleaned)) return { ok: false, error: 'category contains unsupported characters' };
        params.category = cleaned;
        break;
      }
    }
  }
  return { ok: true, intent, params };
}
