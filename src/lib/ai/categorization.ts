/**
 * AI categorization engine (LedgerPro improvement plan, Phase 2 item 1).
 *
 * The propose–confirm–learn loop for bank imports. For each imported row
 * the engine proposes a category with a confidence and a one-line
 * plain-language reason, layered cheapest-first:
 *
 *   (a) the app's existing rules — Bank rules, then Settings →
 *       Categorization rules (the same matchers the import already runs;
 *       this layer exists so rows the rules would catch carry a
 *       confidence + reason in the audit trail too);
 *   (b) company memory — this company's own categorized history for the
 *       same normalized payee ("You coded 14 past payments to 'Shell'
 *       as Vehicle Fuel");
 *   (c) an LLM tail (lib/ai/llm) for the rows (a) and (b) can't place —
 *       and only when OPENAI_API_KEY is configured. Unconfigured is a
 *       normal state: the engine simply stops at (b).
 *
 * Suggestions are persisted (AiSuggestion) with their source, confidence
 * and reason, and the human's final decision is recorded back on the same
 * row (accepted vs overridden) — that record is both the audit trail and
 * the learning signal: overrides change future memory (memory is built
 * from final categories), and an accepted LLM pattern unlocks bulk
 * confirmation for that payee→account pattern later.
 *
 * Nothing here categorizes or posts on its own. Suggestions pre-fill the
 * review queue; a human confirms every row (individually, or in bulk
 * under the conservative bulk rule below) and posting stays the existing
 * separate step.
 */

import { applyRules, type BankRuleLike } from '@/lib/banking/rules';
import {
  matchCategorizationRule,
  loadActiveCategorizationRules,
  type CategorizationRuleRecord,
} from '@/lib/banking/categorization-apply';
import { classifyWithLlm, getLlmConfig } from './llm';
import { payeeKeyFor, payeeDisplayName } from './payee-normalize';

// ── Types ────────────────────────────────────────────────────────────

export type SuggestionSource = 'bank_rule' | 'categorization_rule' | 'memory' | 'llm';

export interface CategorySuggestion {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  confidence: number; // 0–1
  reason: string;
  source: SuggestionSource;
  payeeKey: string | null;
  model?: string | null; // LLM model name when source = 'llm'
}

export interface SuggestionRow {
  description: string;
  amount: number; // signed
  financialAccountId: string;
  payeeGuess?: string | null;
  merchant?: string | null;
  rawStatementText?: string | null;
  date?: string | null; // YYYY-MM-DD
}

export interface AccountLite {
  id: string;
  code: string;
  name: string;
  type: string;
}

/** An LLM placement, resolved to an account. Injectable for tests. */
export type LlmClassifier = (input: {
  row: SuggestionRow;
  payeeKey: string | null;
  candidates: AccountLite[];
}) => Promise<{ categoryId: string; confidence: number; reason: string; model?: string | null } | null>;

// ── Company memory (layer b) ─────────────────────────────────────────

export interface MemoryHistoryRow {
  payeeKey: string;
  direction: 'in' | 'out';
  categoryId: string;
  categoryCode: string;
  categoryName: string;
}

export interface MemoryCategoryCount {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  count: number;
}

export interface PayeeMemoryEntry {
  total: number;
  /** Category counts, most-used first. */
  byCategory: MemoryCategoryCount[];
}

export type PayeeMemory = Map<string, PayeeMemoryEntry>;

const memoryKey = (payeeKey: string, direction: 'in' | 'out') => `${payeeKey}|${direction}`;

export function buildPayeeMemory(rows: MemoryHistoryRow[]): PayeeMemory {
  const memory: PayeeMemory = new Map();
  for (const row of rows) {
    if (!row.payeeKey) continue;
    const key = memoryKey(row.payeeKey, row.direction);
    let entry = memory.get(key);
    if (!entry) {
      entry = { total: 0, byCategory: [] };
      memory.set(key, entry);
    }
    entry.total++;
    const existing = entry.byCategory.find((c) => c.categoryId === row.categoryId);
    if (existing) existing.count++;
    else entry.byCategory.push({ categoryId: row.categoryId, categoryCode: row.categoryCode, categoryName: row.categoryName, count: 1 });
  }
  for (const entry of memory.values()) {
    entry.byCategory.sort((a, b) => b.count - a.count);
  }
  return memory;
}

export function suggestFromMemory(
  memory: PayeeMemory,
  payeeKey: string | null,
  direction: 'in' | 'out',
  displayPayee: string,
): CategorySuggestion | null {
  if (!payeeKey) return null;
  const entry = memory.get(memoryKey(payeeKey, direction));
  if (!entry || entry.total === 0) return null;

  const top = entry.byCategory[0];
  const share = top.count / entry.total;

  // A payee coded all over the place teaches nothing — stay silent rather
  // than guess. Below 60% agreement there is no suggestion at all.
  if (share < 0.6) return null;

  let confidence: number;
  if (entry.total >= 3 && share >= 0.9) confidence = 0.95;
  else if (entry.total >= 3 && share >= 0.75) confidence = 0.85;
  else if (entry.total >= 3) confidence = 0.65;
  else if (entry.total === 2 && share === 1) confidence = 0.82;
  else if (entry.total === 1) confidence = 0.55;
  else return null;

  const reason =
    entry.total === 1
      ? `You coded a past payment to '${displayPayee}' as ${top.categoryName}`
      : share === 1
        ? `You coded all ${entry.total} past payments to '${displayPayee}' as ${top.categoryName}`
        : `You coded ${top.count} of ${entry.total} past payments to '${displayPayee}' as ${top.categoryName}`;

  return {
    categoryId: top.categoryId,
    categoryCode: top.categoryCode,
    categoryName: top.categoryName,
    confidence,
    reason,
    source: 'memory',
    payeeKey,
  };
}

// ── Bulk-confirm eligibility ─────────────────────────────────────────

/** Bulk confirmation is deliberately conservative (plan N1 risk note). */
export const BULK_CONFIDENCE_THRESHOLD = 0.9;
/** An LLM pattern the company has accepted before still needs a solid score. */
export const BULK_LLM_MIN_CONFIDENCE = 0.8;

/** The pattern an accepted LLM suggestion teaches: payee → account. */
export const llmPatternKey = (payeeKey: string | null, categoryId: string) => `${payeeKey ?? ''}|${categoryId}`;

/**
 * Bulk-confirm rule: high-confidence suggestions from the deterministic
 * layers (rules / memory) may be confirmed in bulk. LLM suggestions may
 * NOT — each needs individual review — until the company has accepted
 * that exact payee→account pattern from the LLM before; from then on the
 * pattern is treated as learned and bulk applies (at a slightly lower
 * confidence bar, since the pattern itself is proven).
 */
export function isBulkEligible(
  suggestion: Pick<CategorySuggestion, 'source' | 'confidence' | 'payeeKey' | 'categoryId'>,
  acceptedLlmPatterns: Set<string>,
): boolean {
  if (suggestion.source === 'llm') {
    return (
      suggestion.confidence >= BULK_LLM_MIN_CONFIDENCE &&
      acceptedLlmPatterns.has(llmPatternKey(suggestion.payeeKey, suggestion.categoryId))
    );
  }
  return suggestion.confidence >= BULK_CONFIDENCE_THRESHOLD;
}

// ── The layered engine (pure core) ───────────────────────────────────

export interface SuggestionContext {
  bankRules: BankRuleLike[];
  categorizationRules: CategorizationRuleRecord[];
  accountsByCode: Map<string, AccountLite>;
  accountsById: Map<string, AccountLite>;
  memory: PayeeMemory;
  /** Null when no LLM is configured — the engine then stops at memory. */
  llm: LlmClassifier | null;
}

export async function computeSuggestion(
  row: SuggestionRow,
  ctx: SuggestionContext,
): Promise<CategorySuggestion | null> {
  const payeeKey = payeeKeyFor(row.description, row.payeeGuess);
  const direction: 'in' | 'out' = row.amount >= 0 ? 'in' : 'out';

  // (a1) Bank rules — the app's first rule system.
  const bankHit = applyRules(ctx.bankRules, {
    description: row.description,
    amount: row.amount,
    accountId: row.financialAccountId,
  });
  if (bankHit?.categoryCode) {
    const account = ctx.accountsByCode.get(bankHit.categoryCode);
    if (account) {
      return {
        categoryId: account.id,
        categoryCode: account.code,
        categoryName: account.name,
        confidence: 0.98,
        reason: `Your bank rule “${bankHit.rule.name}” matches this description`,
        source: 'bank_rule',
        payeeKey,
      };
    }
  }

  // (a2) Settings → Categorization rules — the second rule system.
  const catRule = matchCategorizationRule(ctx.categorizationRules, {
    id: '',
    description: row.description,
    merchant: row.merchant ?? null,
    rawStatementText: row.rawStatementText ?? row.description,
    amount: row.amount,
  });
  if (catRule) {
    const account = ctx.accountsByCode.get(catRule.category.code);
    if (account) {
      return {
        categoryId: account.id,
        categoryCode: account.code,
        categoryName: account.name,
        confidence: 0.95,
        reason: `Your categorization rule “${catRule.name}” matches this payee`,
        source: 'categorization_rule',
        payeeKey,
      };
    }
  }

  // (b) Company memory — this company's own coded history for the payee.
  const display = payeeKey ? payeeDisplayName(payeeKey, row.payeeGuess) : '';
  const fromMemory = suggestFromMemory(ctx.memory, payeeKey, direction, display);
  if (fromMemory) return fromMemory;

  // (c) LLM tail — only for rows the deterministic layers can't place.
  if (ctx.llm) {
    const candidates = [...ctx.accountsById.values()].filter((a) =>
      direction === 'out' ? a.type === 'expense' : a.type === 'income',
    );
    if (candidates.length > 0) {
      const pick = await ctx.llm({ row, payeeKey, candidates }).catch(() => null);
      if (pick) {
        const account = ctx.accountsById.get(pick.categoryId);
        if (account) {
          return {
            categoryId: account.id,
            categoryCode: account.code,
            categoryName: account.name,
            confidence: Math.min(0.95, Math.max(0.05, pick.confidence)),
            reason: pick.reason || 'Suggested by AI from the payee name — no past history for this payee yet',
            source: 'llm',
            payeeKey,
            model: pick.model ?? null,
          };
        }
      }
    }
  }

  return null;
}

/** Default LLM classifier backed by lib/ai/llm (OpenAI). */
export function makeOpenAiClassifier(): LlmClassifier | null {
  const config = getLlmConfig();
  if (!config) return null;
  return async ({ row, payeeKey, candidates }) => {
    const pick = await classifyWithLlm(
      {
        payee: payeeKey ? payeeDisplayName(payeeKey, row.payeeGuess) : row.payeeGuess ?? null,
        description: row.description,
        amount: row.amount,
        date: row.date ?? null,
        candidates: candidates.map((c) => ({ code: c.code, name: c.name })),
      },
      { config },
    );
    if (!pick) return null;
    const account = candidates.find((c) => c.code === pick.categoryCode);
    if (!account) return null;
    return { categoryId: account.id, confidence: pick.confidence, reason: pick.reason, model: pick.model };
  };
}

// ── DB orchestration ─────────────────────────────────────────────────

/** Cap LLM calls per batch so a huge import can't run up a tail bill. */
export const MAX_LLM_CALLS_PER_BATCH = 25;

export interface SuggestibleTransaction {
  id: string;
  description: string;
  amount: number;
  financialAccountId: string;
  payeeGuess?: string | null;
  merchant?: string | null;
  rawStatementText?: string | null;
  date?: Date | string | null;
}

export interface SuggestSummary {
  suggested: number;
  bySource: Record<SuggestionSource, number>;
  llmCalls: number;
}

/**
 * Compute + persist suggestions for a set of freshly imported,
 * still-uncategorized transactions. Loads the company's rules, chart,
 * memory (from its categorized history, excluding the batch itself) and
 * accepted-LLM patterns, then writes one AiSuggestion per placed row and
 * stamps Transaction.suggestedCategoryId for the review queue.
 *
 * `client` is any Prisma-like client (the import's transaction client, or
 * the app db). Throws only on infrastructure failure — callers wrap it so
 * a suggestion failure never fails an import.
 */
export async function suggestForTransactions(
  client: any,
  input: { companyId: string; transactions: SuggestibleTransaction[]; llmClassifier?: LlmClassifier | null },
): Promise<SuggestSummary> {
  const summary: SuggestSummary = {
    suggested: 0,
    bySource: { bank_rule: 0, categorization_rule: 0, memory: 0, llm: 0 },
    llmCalls: 0,
  };
  if (input.transactions.length === 0) return summary;

  const batchIds = new Set(input.transactions.map((t) => t.id));

  const [bankRuleRows, catRules, accountRows, historyRows] = await Promise.all([
    client.bankRule.findMany({ where: { companyId: input.companyId, enabled: true } }),
    loadActiveCategorizationRules(client, input.companyId),
    client.chartOfAccount.findMany({
      where: { companyId: input.companyId, active: true },
      select: { id: true, code: true, name: true, type: true },
    }),
    client.transaction.findMany({
      where: {
        companyId: input.companyId,
        categoryId: { not: null },
        status: { in: ['categorized', 'reconciled'] },
      },
      orderBy: { date: 'desc' },
      take: 2000,
      select: {
        id: true,
        description: true,
        payeeGuess: true,
        amount: true,
        categoryId: true,
        category: { select: { code: true, name: true } },
      },
    }),
  ]);

  const bankRules: BankRuleLike[] = (bankRuleRows as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    order: r.order,
    op: r.op,
    value: r.value,
    anyOf: r.anyOf,
    scope: r.scope as any,
    setCategoryCode: r.setCategoryCode,
    setTaxCode: r.setTaxCode,
    setTaxRate: r.setTaxRate ? Number(r.setTaxRate) : null,
    setTaxInclusive: r.setTaxInclusive,
    setContactId: r.setContactId,
    autoPost: r.autoPost,
    enabled: r.enabled,
  }));

  const accountsByCode = new Map<string, AccountLite>();
  const accountsById = new Map<string, AccountLite>();
  for (const a of accountRows as AccountLite[]) {
    accountsByCode.set(a.code, a);
    accountsById.set(a.id, a);
  }

  const memory = buildPayeeMemory(
    (historyRows as any[])
      .filter((t) => !batchIds.has(t.id) && t.category)
      .map((t) => ({
        payeeKey: payeeKeyFor(t.description, t.payeeGuess) ?? '',
        direction: (Number(t.amount) >= 0 ? 'in' : 'out') as 'in' | 'out',
        categoryId: t.categoryId,
        categoryCode: t.category.code,
        categoryName: t.category.name,
      }))
      .filter((r) => r.payeeKey),
  );

  // Wrap the classifier with the per-batch call cap.
  const baseClassifier = input.llmClassifier !== undefined ? input.llmClassifier : makeOpenAiClassifier();
  let llm: LlmClassifier | null = null;
  if (baseClassifier) {
    llm = async (args) => {
      if (summary.llmCalls >= MAX_LLM_CALLS_PER_BATCH) return null;
      summary.llmCalls++;
      return baseClassifier(args);
    };
  }

  const ctx: SuggestionContext = {
    bankRules,
    categorizationRules: catRules,
    accountsByCode,
    accountsById,
    memory,
    llm,
  };

  for (const tx of input.transactions) {
    const row: SuggestionRow = {
      description: tx.description,
      amount: Number(tx.amount),
      financialAccountId: tx.financialAccountId,
      payeeGuess: tx.payeeGuess ?? null,
      merchant: tx.merchant ?? null,
      rawStatementText: tx.rawStatementText ?? tx.description,
      date: tx.date ? new Date(tx.date as any).toISOString().slice(0, 10) : null,
    };
    const suggestion = await computeSuggestion(row, ctx);
    if (!suggestion) continue;

    await client.aiSuggestion.create({
      data: {
        companyId: input.companyId,
        transactionId: tx.id,
        payeeKey: suggestion.payeeKey ?? '',
        source: suggestion.source,
        suggestedCategoryId: suggestion.categoryId,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        model: suggestion.model ?? null,
        outcome: 'pending',
      },
    });
    await client.transaction.update({
      where: { id: tx.id },
      data: { suggestedCategoryId: suggestion.categoryId },
    });
    summary.suggested++;
    summary.bySource[suggestion.source]++;
  }

  return summary;
}

/** Load the company's accepted LLM patterns (payee→account) as a set. */
export async function loadAcceptedLlmPatterns(client: any, companyId: string): Promise<Set<string>> {
  const rows = await client.aiSuggestion.findMany({
    where: { companyId, source: 'llm', outcome: 'accepted' },
    select: { payeeKey: true, suggestedCategoryId: true },
  });
  return new Set((rows as any[]).map((r) => llmPatternKey(r.payeeKey, r.suggestedCategoryId)));
}

// ── Learning: record the human's decision ────────────────────────────

/**
 * Record the outcome of the latest pending suggestion for a transaction:
 * 'accepted' when the human's final category is the suggested one,
 * 'overridden' otherwise (with the final category kept). This is the
 * learning record — memory itself is rebuilt from final categories, and
 * accepted LLM rows unlock bulk confirmation for their pattern.
 * No-op when there is no pending suggestion. Never throws by design of
 * its callers (they wrap it); kept throw-free for missing rows.
 */
export async function recordSuggestionOutcome(
  client: any,
  input: { companyId: string; transactionId: string; finalCategoryId: string | null; userId?: string; viaBulk?: boolean },
): Promise<'accepted' | 'overridden' | null> {
  const pending = await client.aiSuggestion.findFirst({
    where: { companyId: input.companyId, transactionId: input.transactionId, outcome: 'pending' },
    orderBy: { createdAt: 'desc' },
  });
  if (!pending) return null;

  const accepted = input.finalCategoryId != null && input.finalCategoryId === pending.suggestedCategoryId;
  await client.aiSuggestion.update({
    where: { id: pending.id },
    data: {
      outcome: accepted ? 'accepted' : 'overridden',
      finalCategoryId: input.finalCategoryId,
      decidedAt: new Date(),
      decidedBy: input.userId ?? null,
      viaBulk: Boolean(input.viaBulk),
    },
  });
  return accepted ? 'accepted' : 'overridden';
}

// ── Bulk confirmation ────────────────────────────────────────────────

/**
 * Confirm every bulk-eligible pending suggestion on an account's review
 * queue in one action: stamps the suggested category and marks the row
 * 'categorized' (NOT posted — posting stays the existing separate step),
 * recording each outcome as accepted-via-bulk. Ineligible suggestions
 * (below threshold, or unproven LLM patterns) are left pending for
 * individual review and counted in `leftForReview`.
 */
export async function bulkConfirmSuggestions(
  client: any,
  input: { companyId: string; financialAccountId: string; userId?: string },
): Promise<{ confirmed: number; leftForReview: number }> {
  const pending = await client.aiSuggestion.findMany({
    where: { companyId: input.companyId, outcome: 'pending' },
    orderBy: { createdAt: 'asc' },
  });
  if ((pending as any[]).length === 0) return { confirmed: 0, leftForReview: 0 };

  const txIds = [...new Set((pending as any[]).map((s: any) => s.transactionId))];
  const txs = await client.transaction.findMany({
    where: { id: { in: txIds }, companyId: input.companyId },
    select: { id: true, financialAccountId: true, status: true, categoryId: true, suggestedCategoryId: true },
  });
  const txById = new Map((txs as any[]).map((t: any) => [t.id, t]));
  const acceptedLlmPatterns = await loadAcceptedLlmPatterns(client, input.companyId);

  let confirmed = 0;
  let leftForReview = 0;

  for (const s of pending as any[]) {
    const tx = txById.get(s.transactionId);
    // Only rows still sitting uncategorized in THIS account's queue.
    if (!tx || tx.financialAccountId !== input.financialAccountId || tx.status !== 'toreview' || tx.categoryId) {
      continue;
    }
    const account = await client.chartOfAccount.findUnique({
      where: { id: s.suggestedCategoryId },
      select: { code: true, name: true },
    });
    const eligible = isBulkEligible(
      {
        source: s.source,
        confidence: Number(s.confidence),
        payeeKey: s.payeeKey,
        categoryId: s.suggestedCategoryId,
      },
      acceptedLlmPatterns,
    );
    if (!eligible || !account) {
      leftForReview++;
      continue;
    }

    await client.transaction.update({
      where: { id: tx.id },
      data: { categoryId: s.suggestedCategoryId, status: 'categorized' },
    });
    await client.aiSuggestion.update({
      where: { id: s.id },
      data: {
        outcome: 'accepted',
        finalCategoryId: s.suggestedCategoryId,
        decidedAt: new Date(),
        decidedBy: input.userId ?? null,
        viaBulk: true,
      },
    });
    confirmed++;
  }

  return { confirmed, leftForReview };
}
