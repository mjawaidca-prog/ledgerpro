/**
 * Ask-your-books — LLM intent selection (Phase 3 item 4).
 *
 * The rented model has exactly one job here: read the QUESTION and
 * pick an intent + parameters from the fixed library. It never
 * receives ledger figures, account names, balances, or history, and
 * it never produces a number that reaches the user — the figures in
 * an answer come only from the executors over LedgerPro's computed
 * reports.
 *
 * The selection is untrusted until validated: the reply must be JSON
 * naming a known intent whose parameters pass validateSelection
 * (exact key set, declared types, declared ranges). Garbage JSON, an
 * unknown intent, an invented parameter, or an out-of-range value
 * discards the WHOLE selection and the caller falls back to the
 * deterministic matcher or a refusal. When OPENAI_API_KEY is not
 * configured this module returns null immediately — the matcher is
 * the always-available path.
 *
 * Reuses the provider plumbing of src/lib/ai/llm.ts (getLlmConfig);
 * the model can be overridden with OPENAI_ASK_MODEL.
 */

import { getLlmConfig, type LlmConfig } from '@/lib/ai/llm';
import { ASK_INTENTS, validateSelection, type Selection } from './intents';
import { NAMED_PERIODS, type PeriodContext } from './periods';

type FetchFn = typeof fetch;

const REQUEST_TIMEOUT_MS = 8000;

/** The catalogue the model sees: intent ids, titles, and parameter
 *  shapes with their ranges. No company data of any kind. */
export function intentCatalogueForPrompt(): string {
  const lines: string[] = [];
  for (const intent of ASK_INTENTS) {
    const params = intent.params.map((p) => {
      switch (p.kind) {
        case 'period':
          return `period (optional): {"named": one of ${NAMED_PERIODS.join(' | ')}} or {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}`;
        case 'days':
          return `${p.name} (optional): integer ${p.min}..${p.max}`;
        case 'limit':
          return `${p.name} (optional): integer ${p.min}..${p.max}`;
        case 'boolean':
          return `${p.name} (optional): true or false`;
        case 'category':
          return `${p.name} (optional): a short expense-category phrase from the question, e.g. "fuel"`;
      }
    });
    lines.push(`- ${intent.id} — ${intent.title}${params.length ? `\n    params: ${params.join('; ')}` : '\n    params: none'}`);
  }
  return lines.join('\n');
}

export function buildSelectionPrompt(question: string): { system: string; user: string } {
  return {
    system:
      'You route bookkeeping questions to a fixed library of report queries for a Canadian ' +
      'small-business accounting app. Reply with JSON only: {"intent": "<intent id>", "params": {...}} ' +
      'using only the parameters that intent declares, or {"intent": null} when no intent fits. ' +
      'You never compute, estimate, or state any amount — you only choose the intent and its parameters. ' +
      'If the question asks for advice, a prediction, or an action (delete, pay, file), reply {"intent": null}.',
    user: `Question: ${question}\n\nIntent library:\n${intentCatalogueForPrompt()}`,
  };
}

/**
 * Ask the model to select an intent for the question. Returns a
 * VALIDATED selection, or null on any failure: unconfigured,
 * network/HTTP error, malformed body, unknown intent, or parameters
 * that fail validation.
 */
export async function selectIntentWithLlm(
  question: string,
  ctx: PeriodContext,
  deps: { fetchFn?: FetchFn; config?: LlmConfig | null; model?: string } = {},
): Promise<Selection | null> {
  const baseConfig = deps.config !== undefined ? deps.config : getLlmConfig();
  if (!baseConfig) return null;
  const config: LlmConfig = {
    apiKey: baseConfig.apiKey,
    model: deps.model ?? process.env.OPENAI_ASK_MODEL?.trim() ?? baseConfig.model,
  };

  const fetchFn = deps.fetchFn ?? fetch;
  const prompt = buildSelectionPrompt(question);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
    });

    if (!res.ok) return null;
    const body: any = await res.json().catch(() => null);
    const content: unknown = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return null;

    let parsed: any;
    try {
      parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.intent === null || parsed.intent === undefined) return null;
    if (typeof parsed.intent !== 'string') return null;
    const rawParams = parsed.params ?? {};
    if (typeof rawParams !== 'object' || Array.isArray(rawParams)) return null;

    const selection: Selection = { intentId: parsed.intent, params: rawParams as Record<string, unknown> };
    const validation = validateSelection(selection, ctx);
    if (!validation.ok) return null;
    return selection;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
