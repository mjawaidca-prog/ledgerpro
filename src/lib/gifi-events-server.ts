/**
 * GIFI suggestion events — the server half of suggestion learning
 * (LedgerPro improvement plan, Phase 2 item 3).
 *
 * Every time an account form saves a GIFI decision, the coa routes
 * report what the form SHOWED (the ranked codes, in order) and what
 * the user CHOSE. Those events are the training signal for engine v2:
 * aggregated into pattern statistics (src/lib/gifi-learning.ts) they
 * re-rank future suggestions — per company first, then globally.
 *
 * Two hard rules:
 *  - Recording NEVER fails a save. A suggestion event is telemetry
 *    for ranking, not bookkeeping; every failure is logged and
 *    swallowed here so the account routes can await it safely.
 *  - The GLOBAL context carries pattern keys and counts ONLY — no
 *    company ids, no account names, nothing that identifies whose
 *    books a pattern came from (see gifi-learning.ts for the
 *    anonymization boundary).
 */

import { db } from '@/lib/db';
import {
  aggregateGifiPatterns,
  gifiNamePatterns,
  type GifiLearningContext,
  type GifiPatternStat,
} from '@/lib/gifi-learning';

export interface RecordGifiSuggestionEventInput {
  companyId: string;
  accountName: string;
  accountType: string;
  /** The ranked codes the form showed, in display order. */
  shownCodes: readonly string[];
  /** The code the user saved with, or null for "leave unmapped". */
  chosenCode: string | null;
  source?: string;
}

/** Sanitize a client-reported shown list: 4-digit codes, deduped, capped. */
export function sanitizeShownCodes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const code = value.trim();
    if (!/^\d{4}$/.test(code) || out.includes(code)) continue;
    out.push(code);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Persist one suggestion event. Returns true when a row was written.
 * Never throws — see the header rule.
 */
export async function recordGifiSuggestionEvent(input: RecordGifiSuggestionEventInput): Promise<boolean> {
  try {
    const shownCodes = sanitizeShownCodes(input.shownCodes);
    if (shownCodes.length === 0) return false;
    const chosenCode = (input.chosenCode ?? '').trim() || null;
    const patterns = gifiNamePatterns(input.accountName);
    await db.gifiSuggestionEvent.create({
      data: {
        companyId: input.companyId,
        accountName: input.accountName,
        accountType: input.accountType,
        patternExact: patterns.exact,
        patternTokens: patterns.tokens,
        shownCodes: JSON.stringify(shownCodes),
        chosenCode,
        wasTopSuggestion: chosenCode !== null && shownCodes[0] === chosenCode,
        wasOverride: chosenCode !== null && shownCodes[0] !== chosenCode,
        source: input.source ?? 'account-form',
      },
    });
    return true;
  } catch (error) {
    console.error('recordGifiSuggestionEvent failed (suggestion learning only):', error);
    return false;
  }
}

const MAX_STATS_PER_SCOPE = 400;

function capStats(stats: GifiPatternStat[]): GifiPatternStat[] {
  return [...stats].sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern)).slice(0, MAX_STATS_PER_SCOPE);
}

/**
 * The learning context for one company: its own pattern statistics
 * (the strong signal) plus the cross-company aggregate (the weak
 * one). Aggregated with Prisma groupBy so event volume never turns
 * into row volume; both scopes are capped to the strongest patterns.
 */
interface GifiGroupRow {
  patternExact?: string;
  patternTokens?: string;
  accountType: string;
  chosenCode: string | null;
  _count: { _all: number };
}

export async function getGifiLearningContext(companyId: string): Promise<GifiLearningContext> {
  const [companyExact, companyTokens, globalExact, globalTokens] = await Promise.all([
    db.gifiSuggestionEvent.groupBy({
      by: ['patternExact', 'accountType', 'chosenCode'],
      where: { companyId, chosenCode: { not: null } },
      _count: { _all: true },
    }) as unknown as Promise<GifiGroupRow[]>,
    db.gifiSuggestionEvent.groupBy({
      by: ['patternTokens', 'accountType', 'chosenCode'],
      where: { companyId, chosenCode: { not: null } },
      _count: { _all: true },
    }) as unknown as Promise<GifiGroupRow[]>,
    db.gifiSuggestionEvent.groupBy({
      by: ['patternExact', 'accountType', 'chosenCode'],
      where: { chosenCode: { not: null } },
      _count: { _all: true },
    }) as unknown as Promise<GifiGroupRow[]>,
    db.gifiSuggestionEvent.groupBy({
      by: ['patternTokens', 'accountType', 'chosenCode'],
      where: { chosenCode: { not: null } },
      _count: { _all: true },
    }) as unknown as Promise<GifiGroupRow[]>,
  ]);

  const toStats = (
    rows: readonly GifiGroupRow[],
    level: 'exact' | 'tokens',
    field: 'patternExact' | 'patternTokens',
  ): GifiPatternStat[] =>
    rows
      .filter((r) => typeof r.chosenCode === 'string' && r.chosenCode !== '')
      .map((r) => ({
        level,
        pattern: String(r[field] ?? ''),
        accountType: r.accountType,
        chosenCode: r.chosenCode as string,
        count: r._count?._all ?? 0,
      }))
      .filter((s) => s.pattern !== '' && s.count > 0);

  return {
    company: capStats([
      ...toStats(companyExact, 'exact', 'patternExact'),
      ...toStats(companyTokens, 'tokens', 'patternTokens'),
    ]),
    global: capStats([
      ...toStats(globalExact, 'exact', 'patternExact'),
      ...toStats(globalTokens, 'tokens', 'patternTokens'),
    ]),
  };
}

/** Re-exported for tests/callers that aggregate stored rows directly. */
export { aggregateGifiPatterns };
