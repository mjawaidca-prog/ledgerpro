/**
 * AI categorization (Phase 2 item 1) — the layered suggestion engine.
 *
 * Covers: payee normalization (store numbers, processor prefixes),
 * company-memory confidence tiers + reason text, layer order (bank rules
 * → categorization rules → memory → LLM tail), the LLM wrapper's
 * graceful no-key behaviour and pick validation, bulk-confirm eligibility
 * (LLM suggestions excluded until their pattern has been accepted),
 * outcome recording on confirm/override, persistence of suggestions at
 * import, and bulk confirmation end-to-end on a fake store.
 */

import { normalizePayeeName, payeeKeyFor } from '@/lib/ai/payee-normalize';
import { classifyWithLlm, getLlmConfig } from '@/lib/ai/llm';
import {
  buildPayeeMemory,
  suggestFromMemory,
  computeSuggestion,
  isBulkEligible,
  llmPatternKey,
  recordSuggestionOutcome,
  suggestForTransactions,
  bulkConfirmSuggestions,
  type SuggestionContext,
  type AccountLite,
} from '@/lib/ai/categorization';
import type { BankRuleLike } from '@/lib/banking/rules';

// ── Fixtures ─────────────────────────────────────────────────────────

const ACCOUNTS: AccountLite[] = [
  { id: 'coa-fuel', code: '6120', name: 'Vehicle Fuel', type: 'expense' },
  { id: 'coa-office', code: '6130', name: 'Office Supplies', type: 'expense' },
  { id: 'coa-fees', code: '6140', name: 'Bank Fees', type: 'expense' },
  { id: 'coa-sales', code: '4100', name: 'Sales Revenue', type: 'income' },
];

function ctx(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    bankRules: [],
    categorizationRules: [],
    accountsByCode: new Map(ACCOUNTS.map((a) => [a.code, a])),
    accountsById: new Map(ACCOUNTS.map((a) => [a.id, a])),
    memory: buildPayeeMemory([]),
    llm: null,
    ...overrides,
  };
}

function bankRule(overrides: Partial<BankRuleLike> = {}): BankRuleLike {
  return {
    id: 'rule-1',
    name: 'Shell → fuel',
    order: 1,
    op: 'contains',
    value: 'SHELL',
    anyOf: [],
    scope: { accountIds: 'all', direction: 'both' },
    setCategoryCode: '6120',
    setTaxCode: null,
    setTaxRate: null,
    setTaxInclusive: true,
    setContactId: null,
    autoPost: false,
    enabled: true,
    ...overrides,
  };
}

function catRule(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'catrule-1',
    name: 'Staples office',
    pattern: 'staples',
    patternType: 'description_contains',
    minAmount: null,
    maxAmount: null,
    categoryId: 'coa-office',
    category: { code: '6130' },
    taxEnabled: false,
    taxProvince: null,
    taxInclusive: true,
    taxRecoverable: true,
    ...overrides,
  };
}

const ROW = { description: 'SHELL #4412 CALGARY AB', amount: -82.5, financialAccountId: 'acct-1', payeeGuess: 'Shell' };

// ── Payee normalization ──────────────────────────────────────────────

describe('payee normalization', () => {
  it('collapses store numbers and locations to one key', () => {
    expect(normalizePayeeName('Petro-Canada #4412')).toBe('PETRO CANADA');
    expect(payeeKeyFor('PETRO-CANADA #4412 CALGARY AB')).toBe('PETRO CANADA');
    expect(payeeKeyFor('PETRO CANADA STORE 0391')).toBe('PETRO CANADA');
  });

  it('strips processor prefixes', () => {
    expect(payeeKeyFor('SQ *SHELL 0391')).toBe(normalizePayeeName('SHELL'));
    expect(normalizePayeeName('PAYPAL *NETFLIX')).toBe('NETFLIX');
    expect(normalizePayeeName('TST*TIM HORTONS')).toBe('TIM HORTONS');
  });

  it('merges corporate suffix variants', () => {
    expect(normalizePayeeName('ACME SUPPLY INC')).toBe(normalizePayeeName('ACME SUPPLY'));
    expect(normalizePayeeName('ACME SUPPLY LTD')).toBe('ACME SUPPLY');
  });

  it('returns null when nothing usable remains', () => {
    expect(normalizePayeeName('')).toBeNull();
    expect(normalizePayeeName(null)).toBeNull();
    expect(normalizePayeeName('#123')).toBeNull();
  });
});

// ── Memory layer ─────────────────────────────────────────────────────

describe('memory layer', () => {
  const history = (n: number, categoryId = 'coa-fuel', code = '6120', name = 'Vehicle Fuel') =>
    Array.from({ length: n }, () => ({
      payeeKey: 'SHELL',
      direction: 'out' as const,
      categoryId,
      categoryCode: code,
      categoryName: name,
    }));

  it('strong history gives a high-confidence suggestion with a counted reason', () => {
    const memory = buildPayeeMemory(history(14));
    const s = suggestFromMemory(memory, 'SHELL', 'out', 'Shell');
    expect(s).not.toBeNull();
    expect(s!.source).toBe('memory');
    expect(s!.confidence).toBe(0.95);
    expect(s!.reason).toBe("You coded all 14 past payments to 'Shell' as Vehicle Fuel");
  });

  it('a single past payment suggests weakly', () => {
    const memory = buildPayeeMemory(history(1));
    const s = suggestFromMemory(memory, 'SHELL', 'out', 'Shell');
    expect(s!.confidence).toBe(0.55);
  });

  it('split history below 60% agreement stays silent', () => {
    const memory = buildPayeeMemory([
      ...history(2),
      ...history(2, 'coa-office', '6130', 'Office Supplies'),
    ]);
    expect(suggestFromMemory(memory, 'SHELL', 'out', 'Shell')).toBeNull();
  });

  it('mostly-agreeing history names the split in the reason', () => {
    const memory = buildPayeeMemory([
      ...history(3),
      ...history(1, 'coa-office', '6130', 'Office Supplies'),
    ]);
    const s = suggestFromMemory(memory, 'SHELL', 'out', 'Shell');
    expect(s!.confidence).toBe(0.85);
    expect(s!.reason).toContain('3 of 4 past payments');
  });

  it('direction matters — inflows do not learn from outflows', () => {
    const memory = buildPayeeMemory(history(5));
    expect(suggestFromMemory(memory, 'SHELL', 'in', 'Shell')).toBeNull();
  });
});

// ── Layer order ──────────────────────────────────────────────────────

describe('engine layer order', () => {
  it('bank rules beat memory', async () => {
    const memory = buildPayeeMemory(
      Array.from({ length: 5 }, () => ({
        payeeKey: 'SHELL', direction: 'out' as const,
        categoryId: 'coa-office', categoryCode: '6130', categoryName: 'Office Supplies',
      })),
    );
    const s = await computeSuggestion(ROW, ctx({ bankRules: [bankRule()], memory }));
    expect(s!.source).toBe('bank_rule');
    expect(s!.categoryId).toBe('coa-fuel');
    expect(s!.confidence).toBe(0.98);
    expect(s!.reason).toContain('Shell → fuel');
  });

  it('categorization rules beat memory and the LLM', async () => {
    let llmCalled = false;
    const s = await computeSuggestion(
      { description: 'STAPLES #99', amount: -40, financialAccountId: 'acct-1', payeeGuess: 'Staples' },
      ctx({
        categorizationRules: [catRule()],
        llm: async () => { llmCalled = true; return null; },
      }),
    );
    expect(s!.source).toBe('categorization_rule');
    expect(s!.categoryId).toBe('coa-office');
    expect(llmCalled).toBe(false);
  });

  it('memory beats the LLM tail', async () => {
    const memory = buildPayeeMemory(
      Array.from({ length: 4 }, () => ({
        payeeKey: 'SHELL', direction: 'out' as const,
        categoryId: 'coa-fuel', categoryCode: '6120', categoryName: 'Vehicle Fuel',
      })),
    );
    let llmCalled = false;
    const s = await computeSuggestion(ROW, ctx({ memory, llm: async () => { llmCalled = true; return null; } }));
    expect(s!.source).toBe('memory');
    expect(llmCalled).toBe(false);
  });

  it('the LLM is called only when the deterministic layers miss', async () => {
    const s = await computeSuggestion(
      { description: 'MYSTERY VENDOR XYZ', amount: -25, financialAccountId: 'acct-1', payeeGuess: 'Mystery Vendor Xyz' },
      ctx({
        llm: async ({ candidates }) => {
          expect(candidates.every((c) => c.type === 'expense')).toBe(true);
          return { categoryId: 'coa-fees', confidence: 0.7, reason: 'Vendor name suggests a service fee', model: 'gpt-4o-mini' };
        },
      }),
    );
    expect(s!.source).toBe('llm');
    expect(s!.categoryId).toBe('coa-fees');
    expect(s!.confidence).toBe(0.7);
    expect(s!.model).toBe('gpt-4o-mini');
  });

  it('no layers hit → no suggestion, and no LLM configured → still fine', async () => {
    const s = await computeSuggestion(
      { description: 'UNKNOWN THING', amount: -10, financialAccountId: 'acct-1', payeeGuess: null },
      ctx(),
    );
    expect(s).toBeNull();
  });

  it('every suggestion carries a confidence in (0,1] and a non-empty reason', async () => {
    const memory = buildPayeeMemory(
      Array.from({ length: 3 }, () => ({
        payeeKey: 'SHELL', direction: 'out' as const,
        categoryId: 'coa-fuel', categoryCode: '6120', categoryName: 'Vehicle Fuel',
      })),
    );
    for (const c of [ctx({ bankRules: [bankRule()] }), ctx({ memory })]) {
      const s = await computeSuggestion(ROW, c);
      expect(s!.confidence).toBeGreaterThan(0);
      expect(s!.confidence).toBeLessThanOrEqual(1);
      expect(s!.reason.length).toBeGreaterThan(0);
    }
  });
});

// ── LLM wrapper ──────────────────────────────────────────────────────

describe('LLM wrapper', () => {
  it('no API key → not configured, classify returns null without calling fetch', async () => {
    expect(getLlmConfig({} as NodeJS.ProcessEnv)).toBeNull();
    let fetchCalled = false;
    const pick = await classifyWithLlm(
      { payee: 'X', description: 'X', amount: -1, candidates: [{ code: '6120', name: 'Vehicle Fuel' }] },
      { config: null, fetchFn: (async () => { fetchCalled = true; throw new Error('must not be called'); }) as any },
    );
    expect(pick).toBeNull();
    expect(fetchCalled).toBe(false);
  });

  it('a valid pick is returned with its confidence and reason', async () => {
    const fetchFn = async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ code: '6120', confidence: 0.8, reason: 'Fuel station payee' }) } }],
        }),
      }) as any;
    const pick = await classifyWithLlm(
      { payee: 'Shell', description: 'SHELL #1', amount: -50, candidates: [{ code: '6120', name: 'Vehicle Fuel' }] },
      { config: { apiKey: 'sk-test', model: 'gpt-4o-mini' }, fetchFn },
    );
    expect(pick).toEqual({ categoryCode: '6120', confidence: 0.8, reason: 'Fuel station payee', model: 'gpt-4o-mini' });
  });

  it('a code outside the candidate list is rejected', async () => {
    const fetchFn = async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ code: '9999', confidence: 0.9, reason: 'made up' }) } }],
        }),
      }) as any;
    const pick = await classifyWithLlm(
      { payee: 'Shell', description: 'SHELL', amount: -50, candidates: [{ code: '6120', name: 'Vehicle Fuel' }] },
      { config: { apiKey: 'sk-test', model: 'gpt-4o-mini' }, fetchFn },
    );
    expect(pick).toBeNull();
  });

  it('HTTP errors and malformed bodies degrade to null, never throw', async () => {
    const badStatus = async () => ({ ok: false, json: async () => ({}) }) as any;
    const garbage = async () =>
      ({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) }) as any;
    const input = { payee: 'X', description: 'X', amount: -1, candidates: [{ code: '6120', name: 'Vehicle Fuel' }] };
    const cfg = { config: { apiKey: 'sk-test', model: 'gpt-4o-mini' } };
    await expect(classifyWithLlm(input, { ...cfg, fetchFn: badStatus })).resolves.toBeNull();
    await expect(classifyWithLlm(input, { ...cfg, fetchFn: garbage })).resolves.toBeNull();
  });
});

// ── Bulk eligibility ─────────────────────────────────────────────────

describe('bulk-confirm eligibility', () => {
  const none = new Set<string>();

  it('high-confidence rules and memory suggestions are eligible', () => {
    expect(isBulkEligible({ source: 'bank_rule', confidence: 0.98, payeeKey: 'SHELL', categoryId: 'coa-fuel' }, none)).toBe(true);
    expect(isBulkEligible({ source: 'memory', confidence: 0.95, payeeKey: 'SHELL', categoryId: 'coa-fuel' }, none)).toBe(true);
  });

  it('below-threshold suggestions are not eligible', () => {
    expect(isBulkEligible({ source: 'memory', confidence: 0.85, payeeKey: 'SHELL', categoryId: 'coa-fuel' }, none)).toBe(false);
    expect(isBulkEligible({ source: 'memory', confidence: 0.55, payeeKey: 'SHELL', categoryId: 'coa-fuel' }, none)).toBe(false);
  });

  it('LLM suggestions are excluded until the pattern has been accepted', () => {
    const s = { source: 'llm' as const, confidence: 0.9, payeeKey: 'SHELL', categoryId: 'coa-fuel' };
    expect(isBulkEligible(s, none)).toBe(false);
    const accepted = new Set([llmPatternKey('SHELL', 'coa-fuel')]);
    expect(isBulkEligible(s, accepted)).toBe(true);
    // A different account for the same payee is a different pattern.
    expect(isBulkEligible({ ...s, categoryId: 'coa-office' }, accepted)).toBe(false);
    // Even an accepted pattern needs a solid LLM confidence.
    expect(isBulkEligible({ ...s, confidence: 0.5 }, accepted)).toBe(false);
  });
});

// ── Outcome recording (learning) ─────────────────────────────────────

describe('recordSuggestionOutcome', () => {
  function fakeClient(pending: any) {
    const updates: any[] = [];
    return {
      updates,
      aiSuggestion: {
        findFirst: async () => pending,
        update: async ({ where, data }: any) => { updates.push({ where, data }); return {}; },
      },
    };
  }

  it('records accepted when the final category is the suggested one', async () => {
    const client = fakeClient({ id: 'sug-1', suggestedCategoryId: 'coa-fuel' });
    const outcome = await recordSuggestionOutcome(client, {
      companyId: 'co-1', transactionId: 'tx-1', finalCategoryId: 'coa-fuel', userId: 'user-1',
    });
    expect(outcome).toBe('accepted');
    expect(client.updates[0].data.outcome).toBe('accepted');
    expect(client.updates[0].data.finalCategoryId).toBe('coa-fuel');
    expect(client.updates[0].data.viaBulk).toBe(false);
  });

  it('records overridden (with the final category) when the human corrects it', async () => {
    const client = fakeClient({ id: 'sug-1', suggestedCategoryId: 'coa-fuel' });
    const outcome = await recordSuggestionOutcome(client, {
      companyId: 'co-1', transactionId: 'tx-1', finalCategoryId: 'coa-office',
    });
    expect(outcome).toBe('overridden');
    expect(client.updates[0].data.finalCategoryId).toBe('coa-office');
  });

  it('is a no-op when there is no pending suggestion', async () => {
    const client = fakeClient(null);
    await expect(
      recordSuggestionOutcome(client, { companyId: 'co-1', transactionId: 'tx-1', finalCategoryId: 'coa-fuel' }),
    ).resolves.toBeNull();
    expect(client.updates).toHaveLength(0);
  });
});

// ── Persistence at import + bulk confirm (fake store) ────────────────

describe('suggestForTransactions + bulkConfirmSuggestions', () => {
  interface FakeTx {
    id: string; companyId: string; financialAccountId: string;
    description: string; payeeGuess: string | null; merchant: string | null;
    rawStatementText: string | null; amount: number; date: Date;
    categoryId: string | null; status: string; suggestedCategoryId?: string | null;
    category?: { code: string; name: string } | null;
  }

  function makeStore(historyCount: number) {
    const txs: FakeTx[] = [];
    for (let i = 0; i < historyCount; i++) {
      txs.push({
        id: `hist-${i}`, companyId: 'co-1', financialAccountId: 'acct-1',
        description: 'SHELL #4412 CALGARY AB', payeeGuess: 'Shell', merchant: null,
        rawStatementText: 'SHELL #4412 CALGARY AB', amount: -80, date: new Date('2026-09-01'),
        categoryId: 'coa-fuel', status: 'reconciled', category: { code: '6120', name: 'Vehicle Fuel' },
      });
    }
    txs.push({
      id: 'new-1', companyId: 'co-1', financialAccountId: 'acct-1',
      description: 'SHELL #2210 EDMONTON AB', payeeGuess: 'Shell', merchant: null,
      rawStatementText: 'SHELL #2210 EDMONTON AB', amount: -64.2, date: new Date('2026-10-02'),
      categoryId: null, status: 'toreview', category: null,
    });
    const suggestions: any[] = [];
    let sugCounter = 0;

    const client: any = {
      bankRule: { findMany: async () => [] },
      categorizationRule: { findMany: async () => [] },
      chartOfAccount: {
        findMany: async () => ACCOUNTS,
        findUnique: async ({ where }: any) => ACCOUNTS.find((a) => a.id === where.id) ?? null,
      },
      transaction: {
        findMany: async ({ where }: any) => {
          if (where?.id?.in) return txs.filter((t) => where.id.in.includes(t.id));
          // history query
          return txs.filter((t) => t.categoryId !== null && ['categorized', 'reconciled'].includes(t.status));
        },
        update: async ({ where, data }: any) => {
          const t = txs.find((x) => x.id === where.id);
          if (t) Object.assign(t, data);
          return t ?? {};
        },
      },
      aiSuggestion: {
        findMany: async ({ where }: any) => {
          if (where?.source === 'llm') return suggestions.filter((s) => s.source === 'llm' && s.outcome === 'accepted');
          return suggestions.filter((s) => s.outcome === 'pending');
        },
        create: async ({ data }: any) => {
          const row = { id: `sug-${++sugCounter}`, createdAt: new Date(), ...data };
          suggestions.push(row);
          return row;
        },
        update: async ({ where, data }: any) => {
          const s = suggestions.find((x) => x.id === where.id);
          if (s) Object.assign(s, data);
          return s ?? {};
        },
      },
    };
    return { client, txs, suggestions };
  }

  it('persists a memory suggestion and stamps suggestedCategoryId', async () => {
    const { client, txs, suggestions } = makeStore(6);
    const fresh = txs.find((t) => t.id === 'new-1')!;
    const summary = await suggestForTransactions(client, {
      companyId: 'co-1',
      transactions: [{ ...fresh }],
      llmClassifier: null, // no key configured — engine must work without it
    });
    expect(summary.suggested).toBe(1);
    expect(summary.bySource.memory).toBe(1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].source).toBe('memory');
    expect(suggestions[0].confidence).toBe(0.95);
    expect(suggestions[0].reason).toContain('Shell');
    expect(suggestions[0].outcome).toBe('pending');
    expect(fresh.suggestedCategoryId).toBe('coa-fuel');
    // Suggestion only — the row itself is NOT categorized by the engine.
    expect(fresh.categoryId).toBeNull();
    expect(fresh.status).toBe('toreview');
  });

  it('bulk confirm categorizes eligible rows and records accepted-via-bulk', async () => {
    const { client, txs, suggestions } = makeStore(6);
    const fresh = txs.find((t) => t.id === 'new-1')!;
    await suggestForTransactions(client, { companyId: 'co-1', transactions: [{ ...fresh }], llmClassifier: null });

    const result = await bulkConfirmSuggestions(client, { companyId: 'co-1', financialAccountId: 'acct-1', userId: 'user-1' });
    expect(result.confirmed).toBe(1);
    expect(fresh.categoryId).toBe('coa-fuel');
    expect(fresh.status).toBe('categorized'); // categorized, NOT posted
    expect(suggestions[0].outcome).toBe('accepted');
    expect(suggestions[0].viaBulk).toBe(true);
  });

  it('bulk confirm leaves a low-confidence suggestion for individual review', async () => {
    const { client, txs, suggestions } = makeStore(1); // single history row → confidence 0.55
    const fresh = txs.find((t) => t.id === 'new-1')!;
    await suggestForTransactions(client, { companyId: 'co-1', transactions: [{ ...fresh }], llmClassifier: null });
    expect(suggestions[0].confidence).toBe(0.55);

    const result = await bulkConfirmSuggestions(client, { companyId: 'co-1', financialAccountId: 'acct-1' });
    expect(result).toEqual({ confirmed: 0, leftForReview: 1 });
    expect(fresh.categoryId).toBeNull();
    expect(suggestions[0].outcome).toBe('pending');
  });
});
