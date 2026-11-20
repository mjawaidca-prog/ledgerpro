/**
 * GIFI readiness — "which accounts still need a GIFI code?" (Slice 3 of
 * the chart-of-accounts GIFI plan).
 *
 * One counting rule, shared by the Chart of Accounts readiness panel,
 * the Tax Setup summary card, and the Trial Balance pre-export
 * checklist, so the three screens can never argue with each other or
 * with the export:
 *
 *  - ACTIVE accounts only — the tb-gifi/1 export sends active accounts
 *    only, so an inactive account is never counted either way.
 *  - An account counts as CODED only when its stored value is a valid
 *    assignable catalogue code (hasValidGifiCode). A legacy free-text
 *    typo ("87l0") counts as UNCODED with status "invalid" — the export
 *    treats it as unmapped, and the worklist is where it gets fixed.
 *  - Deliberately uncoded accounts are EXCLUDED from the count
 *    entirely (plan D2): Retained Earnings and Opening Balance Equity
 *    stay uncoded because Nexvar Tax computes retained-earnings
 *    continuity and blocks accounts aimed at those codes; Owner's
 *    Capital / Owner's Draw are the sole-proprietor template's equity
 *    accounts, likewise left uncoded by the template design. Counting
 *    them would make "fully coded" unreachable and train users to
 *    ignore the counter.
 *  - Accounts the user DELIBERATELY left unmapped in the form
 *    (gifiUnmappedByChoice, Phase 1 GIFI-at-creation) are excluded the
 *    same way — the decision is made — and reported separately as
 *    decidedUnmapped so screens can name them as a choice, not a gap.
 *
 * Entity behaviour (plan D5, approved default): corporations,
 * partnerships and nonprofits get the full flow — GIFI is how their
 * statements are filed (T2 / T5013). A sole proprietor files a T2125,
 * not GIFI statements, so they get the QUIET flow: the picker stays
 * available in the account forms, but there is no readiness panel and
 * no pre-export checklist. An unset/unknown business type defaults to
 * the full flow — hiding the tool because a profile field is blank
 * would recreate the gap this work exists to close.
 *
 * Pure functions over plain account rows — client-safe (no db import),
 * used by client components and unit tests alike.
 */

import { hasValidGifiCode } from '@/lib/gifi';

export interface GifiReadinessAccountInput {
  id?: string;
  code: string;
  name: string;
  type: string;
  subType?: string | null;
  detailType?: string | null;
  gifiCode?: string | null;
  /**
   * GIFI-at-creation (Phase 1): the recorded DELIBERATE "leave
   * unmapped" decision. True only ever alongside a null code (the API
   * keeps them exclusive). Absent on rows fetched before the column
   * existed — treated as false.
   */
  gifiUnmappedByChoice?: boolean | null;
  active?: boolean;
}

export type GifiAccountStatus = 'coded' | 'uncoded' | 'invalid';

export interface GifiReadinessItem extends GifiReadinessAccountInput {
  /** 'uncoded' = nothing stored; 'invalid' = a stored value that is not an assignable catalogue code. */
  status: Exclude<GifiAccountStatus, 'coded'>;
  /** The raw stored value, for display on invalid rows. */
  storedGifiCode: string | null;
}

export interface GifiReadiness {
  /** Active, non-exempt accounts — the denominator of "X of Y coded". */
  total: number;
  /** Of those, how many carry a valid assignable code. */
  coded: number;
  /** The worklist: countable accounts with no code, or an invalid one. */
  needsCode: GifiReadinessItem[];
  /**
   * Active, non-exempt accounts the user DELIBERATELY left unmapped
   * (Phase 1 decision flag). Excluded from total/needsCode — the
   * decision is made, so nagging would train users to ignore the
   * counter, the same reasoning as the D2 design exemptions. They
   * still export as gifiCode: null; this list exists so screens can
   * name them as "unmapped by choice" rather than as gaps.
   */
  decidedUnmapped: GifiReadinessAccountInput[];
}

/** Trim, lowercase, collapse whitespace, unify apostrophes — for name matching. */
export function normalizeAccountName(name: string): string {
  return name
    .replace(/[‘’]/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const DESIGN_EXEMPT_NAMES: ReadonlySet<string> = new Set([
  'retained earnings',
  'opening balance equity',
  "owner's capital",
  'owners capital',
  "owner's draw",
  'owners draw',
  'owner draw',
]);

/**
 * Accounts that stay uncoded BY DESIGN (plan D2) and are therefore
 * excluded from the readiness count: retained earnings (computed on
 * the tax side), the opening-balance offset account, and the
 * sole-proprietor template's owner capital/draw accounts.
 */
export function isGifiDesignExempt(account: GifiReadinessAccountInput): boolean {
  if (account.subType === 'retained_earnings') return true;
  if (account.detailType && normalizeAccountName(account.detailType) === 'opening balance offset') return true;
  return DESIGN_EXEMPT_NAMES.has(normalizeAccountName(account.name));
}

export function gifiAccountStatus(account: GifiReadinessAccountInput): GifiAccountStatus {
  const stored = (account.gifiCode ?? '').trim();
  if (stored === '') return 'uncoded';
  return hasValidGifiCode(stored) ? 'coded' : 'invalid';
}

/**
 * The readiness computation. Inactive accounts are ignored (the export
 * ignores them too); design-exempt accounts are ignored (see header);
 * deliberately-unmapped accounts are decided, so they leave the
 * worklist and are reported separately (see GifiReadiness).
 */
export function computeGifiReadiness(
  accounts: readonly GifiReadinessAccountInput[],
): GifiReadiness {
  let total = 0;
  let coded = 0;
  const needsCode: GifiReadinessItem[] = [];
  const decidedUnmapped: GifiReadinessAccountInput[] = [];

  for (const account of accounts) {
    if (account.active === false) continue;
    if (isGifiDesignExempt(account)) continue;
    const status = gifiAccountStatus(account);
    if (status !== 'coded' && account.gifiUnmappedByChoice === true) {
      decidedUnmapped.push(account);
      continue;
    }
    total += 1;
    if (status === 'coded') {
      coded += 1;
    } else {
      needsCode.push({
        ...account,
        status,
        storedGifiCode: (account.gifiCode ?? '').trim() || null,
      });
    }
  }

  return { total, coded, needsCode, decidedUnmapped };
}

// ── GIFI-at-creation: the decision rule (Phase 1, design §2.1) ──────
//
// "No account can be saved without a GIFI decision." A decision is any
// one of:
//   1. a valid assignable code on the account;
//   2. a design exemption (D2 — Retained Earnings, Opening Balance
//      Equity, Owner's Capital / Owner's Draw stay uncoded by design,
//      so for them uncoded IS the decided state);
//   3. the recorded deliberate choice to leave the account unmapped
//      (gifiUnmappedByChoice).
// Anything else — blank code, no flag, non-exempt — is an undecided
// account, and the create/edit API refuses to save it that way. The
// account forms mirror this rule to disable Save until a decision
// exists, so the API error is a backstop, not the primary UX.

export interface GifiDecisionInput {
  name?: string | null;
  type?: string | null;
  subType?: string | null;
  detailType?: string | null;
  gifiCode?: string | null;
  gifiUnmappedByChoice?: boolean | null;
}

/** True when the account's GIFI state is a decision, per the rule above. */
export function hasGifiDecision(input: GifiDecisionInput): boolean {
  if (hasValidGifiCode((input.gifiCode ?? '').trim())) return true;
  if (input.gifiUnmappedByChoice === true) return true;
  return isGifiDesignExempt({
    code: '',
    name: input.name ?? '',
    type: input.type ?? '',
    subType: input.subType ?? null,
    detailType: input.detailType ?? null,
  });
}

/**
 * The API error for a save that carries no GIFI decision, or null when
 * the decision exists. Message is written for the bookkeeper, not the
 * developer — it names the two ways to make the decision.
 */
export function gifiDecisionError(input: GifiDecisionInput): string | null {
  if (hasGifiDecision(input)) return null;
  return 'Choose a GIFI code for this account, or tick "Leave unmapped" to record that it stays uncoded on purpose — every account needs one decision or the other before it can be saved';
}

export type GifiFlowMode = 'full' | 'quiet';

/**
 * Full flow (readiness panel + pre-export checklist) for every entity
 * type that files GIFI statements — and for unset/unknown types.
 * Quiet flow (picker available, no nagging) for sole proprietors only.
 */
export function gifiFlowMode(businessType: string | null | undefined): GifiFlowMode {
  return businessType === 'sole_proprietor' ? 'quiet' : 'full';
}

export interface GifiExportChecklist {
  show: boolean;
  uncoded: GifiReadinessItem[];
}

/**
 * Slice 4 trigger logic, kept pure so the Trial Balance page and the
 * tests share one decision: the pre-export checklist appears only in
 * the full flow and only when at least one countable account is
 * uncoded. Warn, never block (plan D3) — "Export anyway" always works,
 * and an all-coded chart exports with no extra step.
 */
export function gifiExportChecklist(
  accounts: readonly GifiReadinessAccountInput[],
  businessType: string | null | undefined,
): GifiExportChecklist {
  if (gifiFlowMode(businessType) === 'quiet') return { show: false, uncoded: [] };
  const { needsCode } = computeGifiReadiness(accounts);
  return { show: needsCode.length > 0, uncoded: needsCode };
}
