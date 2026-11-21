/**
 * GIFI suggestion engine v2 — RANKED suggestions that learn
 * (LedgerPro improvement plan, Phase 2 item 3).
 *
 * v1 (src/lib/gifi-suggestions.ts) is a static rules table and stays
 * the candidate generator: template twins, then keyword shortlists.
 * Its known failure (Nov 19, Muja): three DISTINCT payable accounts
 * were all offered the same generic code 2620 — the precise detail
 * codes that exist under 2620 (2623 holdbacks, 2624 wages, 2627
 * employee deductions…) were never surfaced — and the chequing
 * account was offered 1002 with no hint of the 1001 alternative.
 * Nothing learned from the accountant's corrections.
 *
 * v2 wraps v1 in three deterministic layers — no LLM, fast enough to
 * run synchronously in the account form:
 *
 *  1. RANKING — every candidate carries a numeric score and a
 *     plain-language reason. v1's order becomes base scores
 *     (template twin 90; keyword shortlist 72/64/56).
 *  2. CATALOGUE EXPANSION — when a candidate is a GENERAL code with
 *     specific detail codes beneath it in the CRA catalogue, the
 *     details join the list: a detail whose description matches the
 *     account name word-for-word outranks the general code (the
 *     2620 → 2623 fix); the best sibling of the top candidate is
 *     surfaced as a flagged "also consider" alternative (the
 *     1002 → 1001 fix).
 *  3. LEARNING — recorded suggestion events (src/lib/gifi-learning.ts)
 *     re-rank by pattern: this COMPANY's own past choices are the
 *     strong signal ("You usually code these as 2624 here"), the
 *     cross-company aggregate is a weaker one, and a global boost can
 *     never outrank a company boost. A code the company keeps
 *     choosing for a name pattern joins the list even when the rules
 *     never offered it.
 *
 * Same restraint as v1: design-exempt accounts and accounts already
 * carrying a valid code get NO suggestions, and a suggestion is still
 * only ever a candidate — a human picks, the API validates, the
 * Phase 1 decision rule decides what may save.
 */

import { getGifiEntry, gifiOptionsForAccountType, isPickableGifiCode, PICKABLE_GIFI_CODES } from '@/lib/gifi';
import { isGifiDesignExempt } from '@/lib/gifi-readiness';
import { suggestGifiCodes, type GifiSuggestionInput } from '@/lib/gifi-suggestions';
import {
  gifiContentTokens,
  gifiNamePatterns,
  type GifiLearningContext,
  type GifiPatternStat,
} from '@/lib/gifi-learning';

export type { GifiSuggestionInput };

export interface RankedGifiSuggestion {
  code: string;
  /** Official CRA description, for display next to the code. */
  description: string;
  /** Deterministic rank score, 1–99. Higher ranks first. */
  score: number;
  /** Plain-language why this code is on the list, headline reason. */
  reason: string;
  /** Every signal that contributed, strongest last. For display/debug. */
  signals: string[];
  /** True for the flagged "also consider" sibling alternative. */
  alternative?: boolean;
}

// ── Score table (the whole ranking policy, in one place) ────────────

const SCORE_TEMPLATE_TWIN = 90;
const SCORE_KEYWORD = [72, 64, 56];
/** A detail code whose description matches the name word-for-word. */
const SCORE_PRECISE_CHILD = 82;
/** A detail code under a suggested general code: base + per matched word. */
const SCORE_CHILD = 46;
const SCORE_CHILD_PER_MATCHED_WORD = 7;
/** The flagged sibling alternative (e.g. Cash next to Bank deposits). */
const SCORE_SIBLING_ALTERNATIVE = 40;
/** A code that only learning put on the list. */
const SCORE_LEARNED_ONLY = 38;

/** Learning boosts by scope and pattern level. Company ≫ global, always. */
const BOOST = {
  companyExact: 45,
  companyTokens: 30,
  globalExact: 18,
  globalTokens: 12,
} as const;
/** +2 per backing event past the first, capped — repetition firms a signal. */
const COUNT_BONUS_PER_EVENT = 2;
const COUNT_BONUS_CAP = 8;

const MAX_RANKED = 6;
const MAX_CHILDREN = 3;

// ── Catalogue neighbourhood (children / siblings of a code) ─────────

const CHILDREN = new Map<string, string[]>();
const SIBLINGS = new Map<string, string[]>();
for (const entry of PICKABLE_GIFI_CODES) {
  if (!entry.parentCode) continue;
  const kids = CHILDREN.get(entry.parentCode) ?? [];
  kids.push(entry.code);
  CHILDREN.set(entry.parentCode, kids);
  const sibs = SIBLINGS.get(entry.parentCode) ?? [];
  sibs.push(entry.code);
  SIBLINGS.set(entry.parentCode, sibs);
}

function fitsAccountType(code: string, scopedCodes: ReadonlySet<string>): boolean {
  return isPickableGifiCode(code) && scopedCodes.has(code);
}

function countBonus(count: number): number {
  return Math.min(Math.max(count - 1, 0) * COUNT_BONUS_PER_EVENT, COUNT_BONUS_CAP);
}

// ── The ranker ───────────────────────────────────────────────────────

interface Candidate {
  code: string;
  score: number;
  reason: string;
  signals: string[];
  /** Insertion order — the deterministic tie-break after score. */
  order: number;
  alternative?: boolean;
}

/**
 * Ranked GIFI suggestions for an account — best first, at most 6.
 * `learning` is optional: with no context this is v1's candidates,
 * rescored, plus the catalogue-expansion alternatives.
 */
export function rankGifiSuggestions(
  input: GifiSuggestionInput,
  learning?: GifiLearningContext,
): RankedGifiSuggestion[] {
  // Restraint, identical to v1: exempt accounts and already-coded
  // accounts get nothing — there is no decision to assist.
  if (isGifiDesignExempt({ ...input, code: '' })) return [];
  const stored = (input.gifiCode ?? '').trim();
  if (stored !== '' && isPickableGifiCode(stored)) return [];
  const patterns = gifiNamePatterns(input.name ?? '');
  if (!patterns.exact) return [];

  const scopedCodes = new Set(gifiOptionsForAccountType(input.type).map((e) => e.code));
  const nameTokens = new Set(gifiContentTokens(input.name ?? ''));

  const candidates = new Map<string, Candidate>();
  let order = 0;
  const add = (code: string, score: number, reason: string, signal: string, alternative = false) => {
    const existing = candidates.get(code);
    if (existing) {
      // Merge: the stronger base wins the score and the headline
      // reason; every signal is remembered.
      if (score > existing.score) {
        existing.score = score;
        existing.reason = reason;
      }
      if (!existing.signals.includes(signal)) existing.signals.push(signal);
      if (alternative) existing.alternative = true;
      return existing;
    }
    const candidate: Candidate = { code, score, reason, signals: [signal], order: order++, alternative };
    candidates.set(code, candidate);
    return candidate;
  };

  // Layer 1 — v1 candidates become scored candidates.
  const base = suggestGifiCodes(input);
  base.forEach((suggestion, i) => {
    const score = suggestion.source === 'template'
      ? SCORE_TEMPLATE_TWIN
      : (SCORE_KEYWORD[i] ?? SCORE_KEYWORD[SCORE_KEYWORD.length - 1]);
    add(suggestion.code, score, suggestion.reason, suggestion.source);
  });

  // Layer 2 — catalogue expansion around the base candidates.
  const genericBases = base.filter((s) => (CHILDREN.get(s.code) ?? []).length > 0);
  const childAdds: { code: string; score: number; reason: string; signal: string }[] = [];
  for (const parent of genericBases) {
    const parentEntry = getGifiEntry(parent.code);
    if (!parentEntry) continue;
    // If the general code's OWN description already matches the name
    // word-for-word (8710 "Interest and bank charges" for an account
    // named exactly that), the general code IS the precise answer —
    // no child may be promoted over it.
    const parentDescTokens = gifiContentTokens(parentEntry.description);
    const parentIsPrecise = parentDescTokens.length >= 2
      && parentDescTokens.every((t) => nameTokens.has(t));
    for (const childCode of CHILDREN.get(parent.code) ?? []) {
      if (!fitsAccountType(childCode, scopedCodes)) continue;
      const childEntry = getGifiEntry(childCode);
      if (!childEntry) continue;
      const descTokens = gifiContentTokens(childEntry.description);
      const matched = descTokens.filter((t) => nameTokens.has(t));
      const precise = !parentIsPrecise && descTokens.length >= 2 && matched.length === descTokens.length;
      if (precise) {
        childAdds.push({
          code: childCode,
          score: SCORE_PRECISE_CHILD,
          reason: `Matches this account's name word for word — ${parent.code} (${parentEntry.description}) is only the general code for the group`,
          signal: 'precise-child',
        });
      } else if (matched.length > 0) {
        childAdds.push({
          code: childCode,
          score: SCORE_CHILD + SCORE_CHILD_PER_MATCHED_WORD * matched.length,
          reason: `A specific code under ${parent.code} (${parentEntry.description}) — consider it if it describes this account better than the general code`,
          signal: 'child',
        });
      }
    }
  }
  childAdds
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, MAX_CHILDREN)
    .forEach((c) => add(c.code, c.score, c.reason, c.signal));

  // Layer 2b — the flagged sibling alternative of the top base
  // candidate: the closest code a human might mean instead.
  const topBase = base[0];
  if (topBase) {
    const siblings = (SIBLINGS.get(getGifiEntry(topBase.code)?.parentCode ?? '') ?? [])
      .filter((code) => code !== topBase.code && fitsAccountType(code, scopedCodes));
    let alternative: { code: string; reason: string } | null = null;
    // The documented bank ambiguity: a deposit account (1002) vs cash
    // on hand (1001) — the name alone cannot tell them apart.
    if (topBase.code === '1002' && siblings.includes('1001')) {
      alternative = {
        code: '1001',
        reason: 'Also consider 1001 — Cash, if this is cash on hand rather than money deposited at a bank',
      };
    } else {
      let best: { code: string; matched: number } | null = null;
      for (const code of siblings) {
        const entry = getGifiEntry(code);
        if (!entry) continue;
        const matched = gifiContentTokens(entry.description).filter((t) => nameTokens.has(t)).length;
        if (matched > 0 && (!best || matched > best.matched)) best = { code, matched };
      }
      if (best) {
        const entry = getGifiEntry(best.code);
        alternative = {
          code: best.code,
          reason: `Also consider ${best.code} — ${entry?.description}, the closest alternative to ${topBase.code}`,
        };
      }
    }
    if (alternative && !candidates.has(alternative.code)) {
      add(alternative.code, SCORE_SIBLING_ALTERNATIVE, alternative.reason, 'sibling-alternative', true);
    } else if (alternative) {
      const existing = candidates.get(alternative.code);
      if (existing) existing.alternative = true;
    }
  }

  // Layer 3 — learning: boosts for matching patterns, by scope.
  if (learning) {
    const applyScope = (
      stats: readonly GifiPatternStat[],
      exactBoost: number,
      tokensBoost: number,
      scope: 'company' | 'global',
    ) => {
      // One boost per code per scope: the best-matching pattern level
      // (an event feeds both levels; summing them would double-count).
      const bestByCode = new Map<string, { boost: number; stat: GifiPatternStat }>();
      for (const stat of stats) {
        if (stat.accountType !== input.type) continue;
        const matches = stat.level === 'exact'
          ? stat.pattern === patterns.exact
          : stat.pattern === patterns.tokens;
        if (!matches) continue;
        const boost = (stat.level === 'exact' ? exactBoost : tokensBoost) + countBonus(stat.count);
        const current = bestByCode.get(stat.chosenCode);
        if (!current || boost > current.boost) bestByCode.set(stat.chosenCode, { boost, stat });
      }
      for (const [code, { boost, stat }] of bestByCode) {
        if (!fitsAccountType(code, scopedCodes)) continue;
        const reason = scope === 'company'
          ? `You usually code these as ${code} here`
          : `Other companies usually code these as ${code}`;
        const existing = candidates.get(code);
        if (existing) {
          existing.score += boost;
          existing.signals.push(`${scope}-${stat.level}`);
          // The company's own habit is the headline reason; a global
          // reason only headlines when no company signal exists.
          if (scope === 'company' || !existing.signals.some((s) => s.startsWith('company-'))) {
            existing.reason = reason;
          }
        } else {
          add(code, SCORE_LEARNED_ONLY + boost, reason, `${scope}-${stat.level}`);
        }
      }
    };
    // Global first, company second — so the company reason wins the
    // headline when both scopes back the same code.
    applyScope(learning.global, BOOST.globalExact, BOOST.globalTokens, 'global');
    applyScope(learning.company, BOOST.companyExact, BOOST.companyTokens, 'company');
  }

  // Rank: score desc, then insertion order, then code — deterministic.
  const ranked = [...candidates.values()].sort(
    (a, b) => b.score - a.score || a.order - b.order || a.code.localeCompare(b.code),
  );

  // Cap the list, but the flagged alternative is never cut: it is the
  // one entry whose whole job is to be seen.
  let result = ranked.slice(0, MAX_RANKED);
  const flagged = ranked.find((c) => c.alternative);
  if (flagged && !result.includes(flagged)) {
    result = [...result.slice(0, MAX_RANKED - 1), flagged].sort(
      (a, b) => b.score - a.score || a.order - b.order || a.code.localeCompare(b.code),
    );
  }

  return result.map((c) => {
    const entry = getGifiEntry(c.code);
    return {
      code: c.code,
      description: entry?.description ?? '',
      score: Math.max(1, Math.min(99, Math.round(c.score))),
      reason: c.reason,
      signals: c.signals,
      ...(c.alternative ? { alternative: true } : {}),
    };
  });
}
