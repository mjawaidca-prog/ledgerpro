/**
 * GIFI code rules for the chart of accounts.
 *
 * The code lives on the account (`ChartOfAccount.gifiCode`) — the single
 * source of truth, read by the tb-gifi/1 export. This module is the one
 * place that decides what a valid, assignable code is:
 *
 *  - A code must be a 4-digit string that exists in the CRA catalogue
 *    (src/lib/gifi-catalogue.ts, from RC4088 Rev. 23).
 *  - Only detail and generic codes are assignable. Total and header
 *    codes (2599 Total assets, 8299 Total revenue, 9999 Net income…)
 *    are computed by the tax software from the detail lines; aiming an
 *    account at one is a Block (V-GIFI-001) on the Nexvar Tax side.
 *  - The retained-earnings continuity codes 3600 / 3680 / 3849 are
 *    computed on the tax side too (3680 := net income, 3849 := opening
 *    + income − dividends…), so they are never assignable even though
 *    3600/3680 are "generic" in the catalogue.
 *
 * Before this module, the Edit form stored any free-text string and the
 * export silently treated a typo as "unmapped". Validation here closes
 * that hole at the API boundary (POST/PUT /api/coa).
 */

import { GIFI_CATALOGUE, type GifiCatalogueEntry } from '@/lib/gifi-catalogue';

export type { GifiCatalogueEntry };

const BY_CODE = new Map<string, GifiCatalogueEntry>(GIFI_CATALOGUE.map((e) => [e.code, e]));

/** Codes the tax build computes itself — never assignable to an account. */
export const COMPUTED_GIFI_CODES: ReadonlySet<string> = new Set(['3600', '3680', '3849']);

export function getGifiEntry(code: string): GifiCatalogueEntry | undefined {
  return BY_CODE.get(code);
}

/** True when the code exists and may be assigned to an account. */
export function isPickableGifiCode(code: string): boolean {
  const entry = BY_CODE.get(code);
  if (!entry) return false;
  if (entry.codeType !== 'detail' && entry.codeType !== 'generic') return false;
  return !COMPUTED_GIFI_CODES.has(code);
}

/** All assignable catalogue entries, in code order. */
export const PICKABLE_GIFI_CODES: readonly GifiCatalogueEntry[] = GIFI_CATALOGUE.filter((e) =>
  isPickableGifiCode(e.code),
);

export type GifiValidation =
  | { ok: true; code: string | null }
  | { ok: false; error: string };

/**
 * Validate a user-supplied GIFI code for storage on an account.
 * null / undefined / blank means "no code" and is always acceptable —
 * an uncoded account is a normal state (it exports unmapped and can be
 * coded later); an INVALID code is not.
 */
export function validateGifiCode(input: unknown): GifiValidation {
  if (input === null || input === undefined) return { ok: true, code: null };
  if (typeof input !== 'string') {
    return { ok: false, error: 'GIFI code must be a 4-digit code from the CRA catalogue' };
  }
  const code = input.trim();
  if (code === '') return { ok: true, code: null };
  if (!/^\d{4}$/.test(code)) {
    return { ok: false, error: `GIFI code "${input}" is not a 4-digit code` };
  }
  const entry = BY_CODE.get(code);
  if (!entry) {
    return { ok: false, error: `GIFI code ${code} is not in the CRA GIFI catalogue` };
  }
  if (COMPUTED_GIFI_CODES.has(code)) {
    return {
      ok: false,
      error: `GIFI code ${code} (${entry.description}) is calculated by the tax software and cannot be assigned to an account`,
    };
  }
  if (entry.codeType === 'total' || entry.codeType === 'header') {
    return {
      ok: false,
      error: `GIFI code ${code} (${entry.description}) is a ${entry.codeType} line calculated by the tax software and cannot be assigned to an account`,
    };
  }
  return { ok: true, code };
}

/**
 * Is a stored value a usable code? Legacy rows written before API
 * validation may hold typos ("87l0") or codes that are no longer
 * assignable; the export treats those as unmapped, and so does every
 * "is this account coded?" check.
 */
export function hasValidGifiCode(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && isPickableGifiCode(stored.trim());
}

// ── Account-type filtering ───────────────────────────────────────────
// The picker offers an account the codes from its own statement area
// first (an expense account gets expense codes). This is guidance, not
// a hard rule — the picker has a "show all" escape hatch, and the API
// deliberately accepts a pickable code from any section with a warning
// (contra and clearing accounts are legitimate exceptions).

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

const SECTIONS_BY_ACCOUNT_TYPE: Record<AccountType, readonly string[]> = {
  asset: ['Assets'],
  liability: ['Liabilities'],
  equity: ['Equity (corporations only)', "Partners' capital (partnerships only)", 'Retained earnings (corporations only)'],
  income: ['Revenue', 'Farming revenue'],
  expense: ['Cost of sales', 'Operating expenses', 'Farming expenses', 'Extraordinary items and income taxes'],
};

export function gifiSectionsForAccountType(type: string): readonly string[] {
  return SECTIONS_BY_ACCOUNT_TYPE[type as AccountType] ?? [];
}

/** Pickable entries in the account type's own sections, code order. */
export function gifiOptionsForAccountType(type: string): GifiCatalogueEntry[] {
  const sections = new Set(gifiSectionsForAccountType(type));
  if (sections.size === 0) return [...PICKABLE_GIFI_CODES];
  return PICKABLE_GIFI_CODES.filter((e) => sections.has(e.section));
}

/**
 * Warning (not an error) when a valid code's section fights the account
 * type — e.g. a liability code on an asset account. Mirrors QuickBooks'
 * sign/type warning: save proceeds, the user is told.
 */
export function gifiTypeWarning(code: string, accountType: string): string | null {
  const entry = BY_CODE.get(code);
  if (!entry) return null;
  const sections = gifiSectionsForAccountType(accountType);
  if (sections.length === 0 || sections.includes(entry.section)) return null;
  return `GIFI code ${code} (${entry.description}) is a ${entry.section.toLowerCase()} code, but this is a ${accountType} account — check it is intentional (contra and clearing accounts can be legitimate exceptions)`;
}

/** "8710 — Interest and bank charges" display label. */
export function gifiLabel(code: string): string {
  const entry = BY_CODE.get(code);
  return entry ? `${entry.code} — ${entry.description}` : code;
}
