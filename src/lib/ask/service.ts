/**
 * Ask-your-books — service (Phase 3 item 4, server).
 *
 * The pipeline every question travels:
 *
 *   question → deterministic matcher → (miss) → LLM selector → (miss)
 *   → honest refusal with the library.
 *
 * Every selection — from either source — passes validateSelection
 * before an executor runs, and executors only ever read computed
 * report figures. The model, when configured, sees the question text
 * and the intent catalogue only: no ledger data in, no numbers out.
 *
 * Audit: every question is logged per company (AskBooksQuery) with
 * the question text, the chosen intent, the validated parameters,
 * the selection source, and the timestamp. Amounts are NEVER logged
 * — parameters cannot contain any (periods, day thresholds, limits,
 * a category phrase), and the answer's figures are not written.
 * Logging is best-effort: a failed write never breaks an answer.
 */

import { db } from '@/lib/db';
import { matchQuestion } from './matcher';
import { selectIntentWithLlm } from './llm-select';
import { ASK_INTENTS, validateSelection, type Selection, type ValidatedParams } from './intents';
import type { PeriodContext } from './periods';
import {
  ASK_EXECUTORS,
  AskUnavailableError,
  defaultAskExecutorDeps,
  type AskAnswer,
  type AskContext,
  type AskExecutor,
  type AskExecutorDeps,
} from './executors';

export interface AskAuditRecord {
  companyId: string;
  userId: string | null;
  question: string;
  intentId: string | null;
  /** JSON of the validated parameters — dates, thresholds, limits,
   *  a category phrase. Never amounts. */
  paramsJson: string | null;
  source: 'matcher' | 'llm' | 'none';
}

export interface AskServiceDeps {
  executors?: Record<string, AskExecutor>;
  executorDeps?: AskExecutorDeps;
  llmSelect?: (question: string, ctx: PeriodContext) => Promise<Selection | null>;
  writeAudit?: (record: AskAuditRecord) => Promise<void>;
  now?: () => Date;
}

export type AskResponse =
  | { status: 'answered'; source: 'matcher' | 'llm'; answer: AskAnswer }
  | {
      status: 'unavailable';
      source: 'matcher' | 'llm';
      intentId: string;
      title: string;
      message: string;
      sourceReport: { label: string; href: string };
    }
  | {
      status: 'refused';
      message: string;
      library: { id: string; title: string; examples: string[] }[];
    };

export const REFUSAL_MESSAGE =
  "I can't answer that from the books. I only answer questions I can compute exactly from your reports — " +
  'no estimates, no advice, no predictions. Here is what I can answer:';

export function libraryForDisplay() {
  return ASK_INTENTS.map((i) => ({ id: i.id, title: i.title, examples: i.examples, sourceReport: i.sourceReport }));
}

async function defaultWriteAudit(record: AskAuditRecord): Promise<void> {
  try {
    await db.askBooksQuery.create({
      data: {
        companyId: record.companyId,
        userId: record.userId,
        question: record.question,
        intentId: record.intentId,
        params: record.paramsJson,
        source: record.source,
      },
    });
  } catch {
    // Best-effort by design — the audit trail must never break an answer.
  }
}

/** Serialize validated params for the audit log. Periods become their
 *  resolved dates + label; nothing else in params can carry a figure
 *  from the books. */
export function paramsForAudit(params: ValidatedParams): string {
  const out: Record<string, unknown> = {};
  if (params.period) out.period = { start: params.period.start, end: params.period.end, label: params.period.label };
  if (params.days !== undefined) out.days = params.days;
  if (params.limit !== undefined) out.limit = params.limit;
  if (params.compare !== undefined) out.compare = params.compare;
  if (params.category !== undefined) out.category = params.category;
  return JSON.stringify(out);
}

export async function answerQuestion(
  companyId: string,
  userId: string | null,
  question: string,
  deps: AskServiceDeps = {},
): Promise<AskResponse> {
  const executors = deps.executors ?? ASK_EXECUTORS;
  const executorDeps = deps.executorDeps ?? defaultAskExecutorDeps;
  const writeAudit = deps.writeAudit ?? defaultWriteAudit;
  const now = deps.now ? deps.now() : new Date();
  const today = now.toISOString().slice(0, 10);
  const trimmed = question.trim().slice(0, 500);

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { currency: true, fiscalYearStart: true, firstFiscalYearEnd: true },
  });
  if (!company) throw new Error('Company not found');

  const periodCtx: PeriodContext = {
    today,
    fiscalYearStart: company.fiscalYearStart ?? null,
    firstFiscalYearEnd: company.firstFiscalYearEnd ?? null,
  };

  // 1) Deterministic matcher — always available.
  let selection: Selection | null = matchQuestion(trimmed, periodCtx);
  let source: 'matcher' | 'llm' | 'none' = selection ? 'matcher' : 'none';
  let validated = selection ? validateSelection(selection, periodCtx) : null;
  if (selection && (!validated || !validated.ok)) {
    // Defence in depth: a matcher bug must not smuggle an invalid
    // selection into an executor. Treat it as a miss.
    selection = null;
    validated = null;
    source = 'none';
  }

  // 2) LLM selector — only on a matcher miss, only when configured.
  if (!selection) {
    const llmSelect = deps.llmSelect ?? ((q: string, c: PeriodContext) => selectIntentWithLlm(q, c));
    const llmSelection = await llmSelect(trimmed, periodCtx).catch(() => null);
    if (llmSelection) {
      const v = validateSelection(llmSelection, periodCtx);
      if (v.ok) {
        selection = llmSelection;
        validated = v;
        source = 'llm';
      }
    }
  }

  // 3) Refusal — honest, with the library.
  if (!selection || !validated || !validated.ok) {
    await writeAudit({ companyId, userId, question: trimmed, intentId: null, paramsJson: null, source: 'none' });
    return {
      status: 'refused',
      message: REFUSAL_MESSAGE,
      library: ASK_INTENTS.map((i) => ({ id: i.id, title: i.title, examples: i.examples })),
    };
  }

  const { intent, params } = validated;
  const selectionSource: 'matcher' | 'llm' = source === 'llm' ? 'llm' : 'matcher';
  await writeAudit({
    companyId,
    userId,
    question: trimmed,
    intentId: intent.id,
    paramsJson: paramsForAudit(params),
    source,
  });

  const executor = executors[intent.id];
  if (!executor) {
    return {
      status: 'refused',
      message: REFUSAL_MESSAGE,
      library: ASK_INTENTS.map((i) => ({ id: i.id, title: i.title, examples: i.examples })),
    };
  }

  const askCtx: AskContext = {
    companyId,
    today,
    currency: company.currency || 'CAD',
    periodCtx,
  };

  try {
    const answer = await executor(askCtx, params, executorDeps);
    return { status: 'answered', source: selectionSource, answer };
  } catch (e) {
    if (e instanceof AskUnavailableError) {
      return {
        status: 'unavailable',
        source: selectionSource,
        intentId: intent.id,
        title: intent.title,
        message: e.message,
        sourceReport: intent.sourceReport,
      };
    }
    throw e;
  }
}
