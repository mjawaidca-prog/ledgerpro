'use client';

// The active-company cookies are set client-side (see AppShell/CompanySwitcher)
// and persist for 30 days. If they're left in place across a sign-out, the
// next person to log in on the same browser — a different account entirely —
// would have their UI (and, absent server-side membership checks, their API
// requests) default to the previous user's company. Always clear these on
// sign-out so each login starts from a clean slate.
export function clearActiveCompanyCookies() {
  for (const name of ['lp-active-company-id', 'lp-active-company-name', 'lp-active-company-role']) {
    document.cookie = `${name}=;path=/;max-age=0;SameSite=Lax`;
  }
}
