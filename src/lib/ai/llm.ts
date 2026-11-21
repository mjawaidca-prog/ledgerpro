/**
 * LLM provider wrapper for AI categorization (Phase 2 item 1) — the rented
 * tail of the suggestion engine. Deliberately tiny:
 *
 *  - Reads OPENAI_API_KEY from the environment. When no key is configured
 *    the wrapper reports "not configured" and the engine runs on rules +
 *    company memory alone — it never crashes and never fabricates a pick.
 *  - Sends the minimum: one payee, its amount/date/direction, and the
 *    candidate account names. No ledger dumps, no history, no balances.
 *  - The pick is validated against the candidate list; anything else
 *    (unknown code, malformed JSON, HTTP error, timeout) returns null and
 *    the row simply stays unsuggested.
 *
 * Model defaults to a gpt-4o-mini-class model; override with
 * OPENAI_CATEGORIZATION_MODEL. Fetch is injectable for tests.
 */

export interface LlmConfig {
  apiKey: string;
  model: string;
}

export const DEFAULT_LLM_MODEL = 'gpt-4o-mini';

export function getLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, model: env.OPENAI_CATEGORIZATION_MODEL?.trim() || DEFAULT_LLM_MODEL };
}

export function isLlmConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getLlmConfig(env) !== null;
}

export interface LlmCandidate {
  code: string;
  name: string;
}

export interface LlmClassifyInput {
  payee: string | null;
  description: string;
  amount: number; // signed; negative = money out
  date?: string | null; // YYYY-MM-DD
  candidates: LlmCandidate[];
}

export interface LlmPick {
  categoryCode: string;
  confidence: number; // 0–1, as returned by the model (engine clamps)
  reason: string;
  model: string;
}

type FetchFn = typeof fetch;

const REQUEST_TIMEOUT_MS = 8000;

/**
 * Ask the model to place one transaction. Returns null on ANY failure —
 * unconfigured, network, HTTP status, malformed body, or a code that is
 * not one of the candidates. Callers treat null as "no suggestion".
 */
export async function classifyWithLlm(
  input: LlmClassifyInput,
  deps: { fetchFn?: FetchFn; config?: LlmConfig | null } = {},
): Promise<LlmPick | null> {
  const config = deps.config !== undefined ? deps.config : getLlmConfig();
  if (!config) return null;
  if (input.candidates.length === 0) return null;

  const fetchFn = deps.fetchFn ?? fetch;
  const direction = input.amount >= 0 ? 'money in (income side)' : 'money out (expense side)';
  const candidateList = input.candidates.map((c) => `${c.code} — ${c.name}`).join('\n');

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
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You categorize bank transactions for a Canadian small-business bookkeeping app. ' +
              'Choose exactly one account from the candidate list. Reply with JSON only: ' +
              '{"code": "<candidate code>", "confidence": <0 to 1>, "reason": "<one short plain-language sentence, max 160 characters>"}. ' +
              'If none of the candidates plausibly fits, reply {"code": null, "confidence": 0, "reason": ""}.',
          },
          {
            role: 'user',
            content:
              `Payee: ${input.payee ?? '(unknown)'}\n` +
              `Statement description: ${input.description}\n` +
              `Amount: ${input.amount.toFixed(2)} (${direction})\n` +
              (input.date ? `Date: ${input.date}\n` : '') +
              `\nCandidate accounts:\n${candidateList}`,
          },
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

    const code = typeof parsed?.code === 'string' ? parsed.code : null;
    if (!code) return null;
    if (!input.candidates.some((c) => c.code === code)) return null;

    const rawConfidence = Number(parsed?.confidence);
    const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0;
    const reason = typeof parsed?.reason === 'string' ? parsed.reason.trim().slice(0, 200) : '';

    return { categoryCode: code, confidence, reason, model: config.model };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
