/**
 * Phase 0 (P0-1) — ONE source of truth for "which company is active".
 *
 * The bug this replaces: several pages fetched GET /api/companies (a list
 * of ALL the user's companies, ordered by membership creation) and used
 * `data[0]` — the OLDEST company — as if it were the active one, while
 * writes (PUT /api/companies) are scoped server-side to the ACTIVE company
 * resolved by requireCompany(). On a multi-company account the Settings
 * page therefore displayed Company A's profile and saved the edits into
 * Company B. Other pages hardcoded a sample name ("Northwind Trading").
 *
 * Resolution order (mirrors the server's own order in api-helpers):
 *   1. `activeCompanyId` returned by GET /api/companies — this is the
 *      server-resolved, membership-verified active company. Authoritative.
 *   2. The `lp-active-company-id` cookie (the switcher's persisted choice).
 *   3. The session's activeCompanyId / companyId.
 * If none of those match a company in the list, fall back to the first
 * membership — the same fallback requireCompany() applies server-side when
 * a hinted company is stale, so client and server stay in agreement.
 */

export interface CompanyLike {
  id: string;
  name?: string | null;
  legalName?: string | null;
}

export function resolveActiveCompanyId(input: {
  responseActiveCompanyId?: string | null;
  cookieCompanyId?: string | null;
  sessionActiveCompanyId?: string | null;
}): string | null {
  for (const candidate of [input.responseActiveCompanyId, input.cookieCompanyId, input.sessionActiveCompanyId]) {
    if (candidate && candidate !== 'undefined') return candidate;
  }
  return null;
}

export function pickActiveCompany<T extends CompanyLike>(
  companies: T[] | null | undefined,
  activeCompanyId: string | null | undefined
): T | null {
  if (!companies || companies.length === 0) return null;
  if (activeCompanyId) {
    const match = companies.find((c) => c.id === activeCompanyId);
    if (match) return match;
  }
  return companies[0];
}

/** Read the switcher's persisted active-company cookie (browser only). */
export function readActiveCompanyCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|; )lp-active-company-id=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Convenience for the common client pattern:
 *   const json = await fetch('/api/companies').then(r => r.json());
 *   const active = activeCompanyFromCompaniesResponse(json);
 */
export function activeCompanyFromCompaniesResponse<T extends CompanyLike>(
  json: { data?: T[] | null; activeCompanyId?: string | null } | null | undefined,
  sessionActiveCompanyId?: string | null
): T | null {
  const activeId = resolveActiveCompanyId({
    responseActiveCompanyId: json?.activeCompanyId,
    cookieCompanyId: readActiveCompanyCookie(),
    sessionActiveCompanyId,
  });
  return pickActiveCompany(json?.data ?? [], activeId);
}

/** Display name for headings: legal name first (reports), then name. Never a hardcoded sample company. */
export function companyDisplayName(company: CompanyLike | null | undefined, fallback = 'your company'): string {
  return company?.legalName || company?.name || fallback;
}
