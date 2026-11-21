/**
 * GIFI suggestion learning — the memory behind suggestion engine v2
 * (LedgerPro improvement plan, Phase 2 item 3).
 *
 * v1 suggestions (src/lib/gifi-suggestions.ts) are a static rules
 * table: on Nov 19, three distinct payable accounts in one company's
 * books were all suggested the same generic code (2620) and the engine
 * had no way to notice the accountant's corrections. v2 fixes that by
 * REMEMBERING every suggestion event — what was shown, what was
 * chosen — and letting those choices re-rank future suggestions.
 *
 * This module is the pure, client-safe half: how an account name
 * becomes an anonymized pattern, and how raw events aggregate into
 * the pattern statistics the ranker consumes. Persistence lives in
 * src/lib/gifi-events-server.ts; ranking in
 * src/lib/gifi-suggestions-v2.ts.
 *
 * Patterns (the anonymization boundary):
 *  - EXACT — the normalized account name itself ("wages payable").
 *    Names are bookkeeping labels, not personal data, and within one
 *    company they are that company's own data.
 *  - TOKENS — the name's discriminating words, stemmed, sorted and
 *    joined ("payable|wage"). THIS is the only key the cross-company
 *    ("global") signal ever sees: no company id, no account name, no
 *    amounts — just "accounts whose names contain these words tend to
 *    be coded X", counted.
 *
 * Two scopes consume the same statistics:
 *  - COMPANY — this company's own past choices. The strong signal:
 *    "you usually code these as Y here".
 *  - GLOBAL — the same patterns counted across every company. The
 *    weaker signal: useful cold-start guidance, never allowed to
 *    outrank the company's own habit (see the ranker's boost table).
 */

import { normalizeAccountName } from '@/lib/gifi-readiness';

/** Words that carry no coding signal — dropped from token patterns. */
const PATTERN_STOPWORDS: ReadonlySet<string> = new Set([
  'account', 'acct', 'the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on',
]);

/**
 * A light, deterministic stemmer so "Payables" and "Payable" share a
 * pattern. Applied identically when patterns are stored and when they
 * are looked up, so its roughness cancels out — it only ever feeds
 * internal keys, never display text.
 */
function stemToken(token: string): string {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) {
    return token.slice(0, -1);
  }
  return token;
}

/** The discriminating content tokens of an account name, stemmed + sorted. */
export function gifiContentTokens(name: string): string[] {
  const normalized = normalizeAccountName(name ?? '');
  if (!normalized) return [];
  const tokens = normalized
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== '' && !/^\d+$/.test(t))
    .map(stemToken)
    // Stopwords are checked AFTER stemming, so "Accounts" (→"account")
    // is dropped just like "Account".
    .filter((t) => !PATTERN_STOPWORDS.has(t));
  return [...new Set(tokens)].sort();
}

export interface GifiNamePatterns {
  /** Normalized full name — the exact-match key. */
  exact: string;
  /** Sorted stemmed content tokens joined with '|' — the fuzzy key. */
  tokens: string;
}

/** Both pattern keys for an account name (stored on every event). */
export function gifiNamePatterns(name: string): GifiNamePatterns {
  const exact = normalizeAccountName(name ?? '');
  const tokens = gifiContentTokens(name ?? '');
  return { exact, tokens: tokens.length > 0 ? tokens.join('|') : exact };
}

export type GifiPatternLevel = 'exact' | 'tokens';

/** One aggregated "names like this were coded X" fact. */
export interface GifiPatternStat {
  level: GifiPatternLevel;
  pattern: string;
  accountType: string;
  chosenCode: string;
  /** How many recorded choices back this stat. */
  count: number;
}

/** Everything the ranker is allowed to know, by scope. */
export interface GifiLearningContext {
  company: GifiPatternStat[];
  global: GifiPatternStat[];
}

export function emptyGifiLearningContext(): GifiLearningContext {
  return { company: [], global: [] };
}

/** The minimal event shape aggregation needs (a stored row, or a test fixture). */
export interface GifiEventLike {
  accountName: string;
  accountType: string;
  /** Null when the recorded decision was "leave unmapped" — no code to learn. */
  chosenCode: string | null;
}

/**
 * Aggregate raw events into pattern statistics, at both levels.
 * Events without a chosen code teach nothing about codes and are
 * skipped. Deterministic: output sorted by pattern, type, code.
 */
export function aggregateGifiPatterns(events: readonly GifiEventLike[]): GifiPatternStat[] {
  const counts = new Map<string, GifiPatternStat>();
  const bump = (level: GifiPatternLevel, pattern: string, accountType: string, chosenCode: string) => {
    if (!pattern) return;
    const key = `${level}${pattern}${accountType}${chosenCode}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { level, pattern, accountType, chosenCode, count: 1 });
  };
  for (const event of events) {
    const chosen = (event.chosenCode ?? '').trim();
    if (!chosen) continue;
    const patterns = gifiNamePatterns(event.accountName);
    bump('exact', patterns.exact, event.accountType, chosen);
    bump('tokens', patterns.tokens, event.accountType, chosen);
  }
  return [...counts.values()].sort(
    (a, b) =>
      a.pattern.localeCompare(b.pattern) ||
      a.accountType.localeCompare(b.accountType) ||
      a.chosenCode.localeCompare(b.chosenCode) ||
      a.level.localeCompare(b.level),
  );
}

/** Assemble the ranker's context from two scopes' raw events. */
export function buildGifiLearningContext(
  companyEvents: readonly GifiEventLike[],
  globalEvents: readonly GifiEventLike[],
): GifiLearningContext {
  return {
    company: aggregateGifiPatterns(companyEvents),
    global: aggregateGifiPatterns(globalEvents),
  };
}
