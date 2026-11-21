/**
 * Phase 3 item 4 — ask your books: the pure grounding layer.
 *
 * Period resolution, the deterministic matcher, selection validation,
 * and the LLM selector. The trust contract under test: a selection is
 * only ever an intent from the fixed library with in-range typed
 * parameters; everything else — garbage model output, unknown
 * intents, invented parameters, out-of-range values, advice-seeking,
 * predictions, commands — is discarded.
 */
import {
  comparisonPeriodOf,
  isValidYmd,
  priorPeriodOf,
  resolveMonthPeriod,
  resolveNamedPeriod,
  type PeriodContext,
} from '@/lib/ask/periods';
import { matchQuestion } from '@/lib/ask/matcher';
import { validateSelection } from '@/lib/ask/intents';
import { selectIntentWithLlm } from '@/lib/ask/llm-select';

const CTX: PeriodContext = {
  today: '2026-11-20',
  fiscalYearStart: '2025-10-02', // FY runs Oct 2 – Oct 1 (Muja-style anchor)
  firstFiscalYearEnd: null,
};

// ── Period resolution ────────────────────────────────────────────────

describe('period resolution', () => {
  it('resolves calendar periods against today', () => {
    expect(resolveNamedPeriod('this_month', CTX)).toMatchObject({ start: '2026-11-01', end: '2026-11-20' });
    expect(resolveNamedPeriod('last_month', CTX)).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
    expect(resolveNamedPeriod('this_quarter', CTX)).toMatchObject({ start: '2026-10-01', end: '2026-11-20' });
    expect(resolveNamedPeriod('last_quarter', CTX)).toMatchObject({ start: '2026-07-01', end: '2026-09-30' });
    expect(resolveNamedPeriod('last_30_days', CTX)).toMatchObject({ start: '2026-10-22', end: '2026-11-20' });
  });

  it('resolves fiscal periods from the company anchor', () => {
    expect(resolveNamedPeriod('this_fiscal_year', CTX)).toMatchObject({ start: '2026-10-02', end: '2026-11-20' });
    expect(resolveNamedPeriod('last_fiscal_year', CTX)).toMatchObject({ start: '2025-10-02', end: '2026-10-01' });
  });

  it('resolves month phrases, treating a future month as last year’s', () => {
    expect(resolveMonthPeriod(3, 2026, CTX)).toMatchObject({ start: '2026-03-01', end: '2026-03-31' });
    expect(resolveMonthPeriod(12, null, CTX)).toMatchObject({ start: '2025-12-01', end: '2025-12-31' });
    expect(resolveMonthPeriod(10, null, CTX)).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
  });

  it('compares a named period against its previous instance', () => {
    const quarter = resolveNamedPeriod('this_quarter', CTX);
    if (!quarter) throw new Error('no quarter');
    expect(comparisonPeriodOf(quarter, CTX)).toMatchObject({ start: '2026-07-01', end: '2026-09-30' });
    const explicit = { start: '2026-03-01', end: '2026-03-31', label: 'March 2026' };
    expect(priorPeriodOf(explicit)).toMatchObject({ start: '2026-01-29', end: '2026-02-28' });
  });

  it('validates real dates only', () => {
    expect(isValidYmd('2026-02-28')).toBe(true);
    expect(isValidYmd('2026-02-30')).toBe(false);
    expect(isValidYmd('2026-13-01')).toBe(false);
    expect(isValidYmd('20-1-1')).toBe(false);
    expect(isValidYmd(20260228)).toBe(false);
  });
});

// ── Deterministic matcher ────────────────────────────────────────────

describe('deterministic matcher', () => {
  const match = (q: string) => matchQuestion(q, CTX);

  it('matches spending questions, with category and period extraction', () => {
    const fuel = match('How much did we spend on fuel this quarter?');
    expect(fuel?.intentId).toBe('spend_by_category');
    expect(fuel?.params).toMatchObject({ period: { named: 'this_quarter' }, category: 'fuel' });

    const all = match('What did we spend this month vs. last month?');
    expect(all?.intentId).toBe('spend_by_category');
    expect(all?.params).toMatchObject({ period: { named: 'this_month' } });
    expect(all?.params.category).toBeUndefined();

    const march = match('How much did we spend on office supplies in March 2026?');
    expect(march?.intentId).toBe('spend_by_category');
    expect(march?.params).toMatchObject({ category: 'office supplies', period: { start: '2026-03-01', end: '2026-03-31' } });
  });

  it('matches revenue questions', () => {
    expect(match('What was our revenue last quarter?')).toMatchObject({
      intentId: 'revenue_for_period',
      params: { period: { named: 'last_quarter' } },
    });
    expect(match('How much did we earn this fiscal year?')?.intentId).toBe('revenue_for_period');
    expect(match('What were our sales in March 2026?')?.intentId).toBe('revenue_for_period');
  });

  it('matches receivables questions with the day threshold', () => {
    expect(match('Who owes us money over 60 days?')).toMatchObject({
      intentId: 'receivables_overdue',
      params: { days: 60 },
    });
    expect(match('Which customers have overdue invoices?')?.intentId).toBe('receivables_overdue');
    expect(match('Show me invoices more than 90 days overdue')?.params).toMatchObject({ days: 90 });
  });

  it('matches top customers and top vendors, with limits', () => {
    expect(match('Who are our top 5 customers this year?')).toMatchObject({
      intentId: 'top_customers',
      params: { limit: 5, period: { named: 'this_fiscal_year' } },
    });
    expect(match('Which clients brought in the most revenue last quarter?')?.intentId).toBe('top_customers');
    expect(match('Who are our biggest vendors this year?')?.intentId).toBe('top_vendors');
    expect(match('Which suppliers did we spend the most with last quarter?')?.intentId).toBe('top_vendors');
  });

  it('matches GST, loans, CCA, cash, and payroll — specific subjects beat generic anchors', () => {
    expect(match('What is our GST/HST position this quarter?')).toMatchObject({
      intentId: 'gst_position',
      params: { period: { named: 'this_quarter' } },
    });
    expect(match('How much GST do we owe for last quarter?')?.intentId).toBe('gst_position');
    expect(match('What are our loan balances?')?.intentId).toBe('loan_balances');
    expect(match('When is the next payment on the Ford loan?')?.intentId).toBe('loan_balances');
    expect(match("What's in the CCA register by class?")?.intentId).toBe('cca_by_class');
    expect(match('What is the net book value of our equipment class?')?.intentId).toBe('cca_by_class');
    expect(match('How much cash do we have?')?.intentId).toBe('cash_by_account');
    expect(match('What are our bank balances?')?.intentId).toBe('cash_by_account');
    // Payroll beats the generic spend anchor it overlaps.
    expect(match('What did payroll cost us last month?')).toMatchObject({
      intentId: 'payroll_cost',
      params: { period: { named: 'last_month' } },
    });
    expect(match('How much did we spend on wages this quarter?')?.intentId).toBe('payroll_cost');
  });

  it('refuses questions the library cannot ground', () => {
    expect(match("What's the weather today?")).toBeNull();
    expect(match('Should I claim more CCA this year?')).toBeNull();
    expect(match('Will our revenue grow next year?')).toBeNull();
    expect(match('Delete all my invoices')).toBeNull();
    expect(match('How do I file my GST return?')).toBeNull();
    expect(match('What will our cash position be next quarter?')).toBeNull();
    expect(match('Tell me a joke')).toBeNull();
    expect(match('')).toBeNull();
  });
});

// ── Selection validation ─────────────────────────────────────────────

describe('selection validation', () => {
  const validate = (intentId: string, params: Record<string, unknown>) =>
    validateSelection({ intentId, params }, CTX);

  it('applies declared defaults and resolves named periods', () => {
    const result = validate('revenue_for_period', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.period).toMatchObject({ start: '2026-10-02', end: '2026-11-20' });
      expect(result.params.compare).toBe(true);
    }
    const recv = validate('receivables_overdue', {});
    expect(recv.ok && recv.params.days).toBe(60);
    expect(recv.ok && recv.params.limit).toBe(10);
  });

  it('rejects unknown intents and invented parameters', () => {
    expect(validate('predict_the_future', {}).ok).toBe(false);
    expect(validate('cash_by_account', { amount: 500 }).ok).toBe(false);
    expect(validate('spend_by_category', { sql: 'SELECT * FROM journal' }).ok).toBe(false);
  });

  it('rejects out-of-range and wrongly-typed values instead of clamping', () => {
    expect(validate('receivables_overdue', { days: 99999 }).ok).toBe(false);
    expect(validate('receivables_overdue', { days: -1 }).ok).toBe(false);
    expect(validate('top_customers', { limit: 0 }).ok).toBe(false);
    expect(validate('top_customers', { limit: 26 }).ok).toBe(false);
    expect(validate('top_customers', { limit: 5.5 }).ok).toBe(false);
    expect(validate('top_customers', { limit: '5' }).ok).toBe(false);
    expect(validate('revenue_for_period', { compare: 'yes' }).ok).toBe(false);
  });

  it('rejects impossible, reversed, future, and over-long periods', () => {
    expect(validate('gst_position', { period: { start: '2026-02-30', end: '2026-03-01' } }).ok).toBe(false);
    expect(validate('gst_position', { period: { start: '2026-03-01', end: '2026-02-01' } }).ok).toBe(false);
    expect(validate('gst_position', { period: { start: '2026-01-01', end: '2027-01-01' } }).ok).toBe(false);
    expect(validate('gst_position', { period: { start: '2019-01-01', end: '2025-01-01' } }).ok).toBe(false);
    expect(validate('gst_position', { period: { named: 'next_quarter' } }).ok).toBe(false);
    expect(validate('gst_position', { period: { named: 'last_quarter', start: '2026-01-01' } }).ok).toBe(false);
  });

  it('rejects a category with unsupported characters', () => {
    expect(validate('spend_by_category', { category: 'fuel; DROP TABLE' }).ok).toBe(false);
    expect(validate('spend_by_category', { category: 'vehicle fuel' }).ok).toBe(true);
  });
});

// ── LLM selector ─────────────────────────────────────────────────────

function fakeFetchReturning(content: unknown, ok = true) {
  return jest.fn(async () => ({
    ok,
    json: async () => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }),
  })) as unknown as typeof fetch;
}

const CONFIG = { apiKey: 'sk-test', model: 'gpt-4o-mini' };

describe('LLM intent selection', () => {
  it('accepts a valid selection — and sends the model no ledger data', async () => {
    const fetchFn = fakeFetchReturning({ intent: 'gst_position', params: { period: { named: 'last_quarter' } } });
    const selection = await selectIntentWithLlm('What is our GST position for the last three months?', CTX, {
      fetchFn,
      config: CONFIG,
    });
    expect(selection).toMatchObject({ intentId: 'gst_position', params: { period: { named: 'last_quarter' } } });

    const body = JSON.parse((fetchFn as unknown as jest.Mock).mock.calls[0][1].body as string);
    const sent = JSON.stringify(body);
    expect(sent).toContain('gst_position');
    expect(sent).toContain('What is our GST position');
    // The model receives the question + catalogue only — no figures.
    expect(sent).not.toContain('171595');
    expect(sent).not.toContain('987654');
  });

  it('discards garbage, unknown intents, invented params, and out-of-range values', async () => {
    const cases: unknown[] = [
      'this is not json',
      { intent: 'predict_future_revenue', params: {} },
      { intent: 'cash_by_account', params: { amount: 42 } },
      { intent: 'top_customers', params: { limit: 500 } },
      { intent: 'receivables_overdue', params: { days: 'sixty' } },
      { intent: 'gst_position', params: { period: { start: '2027-01-01', end: '2027-03-31' } } },
      { intent: null },
      { params: {} },
    ];
    for (const content of cases) {
      const selection = await selectIntentWithLlm('anything', CTX, { fetchFn: fakeFetchReturning(content), config: CONFIG });
      expect(selection).toBeNull();
    }
  });

  it('returns null on HTTP failure and when unconfigured (without calling fetch)', async () => {
    const failing = fakeFetchReturning({}, false);
    expect(await selectIntentWithLlm('anything', CTX, { fetchFn: failing, config: CONFIG })).toBeNull();

    const fetchFn = fakeFetchReturning({ intent: 'cash_by_account', params: {} });
    expect(await selectIntentWithLlm('anything', CTX, { fetchFn, config: null })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
