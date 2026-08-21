/**
 * Client-side tenant helpers — shared by the banking surfaces.
 * The middleware injects x-company-id/x-user-id for /api/* requests, but
 * explicit headers also work and keep requests self-consistent.
 */

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function resolveCompanyId(sessionCompanyId?: string | null): string | null {
  return sessionCompanyId || getCookie('lp-active-company-id') || null;
}

export function resolveTenantHeaders(opts?: { companyId?: string | null; userId?: string | null }): Record<string, string> {
  const headers: Record<string, string> = {};
  const companyId = opts?.companyId ?? getCookie('lp-active-company-id');
  if (companyId) headers['x-company-id'] = String(companyId);
  if (opts?.userId) headers['x-user-id'] = String(opts.userId);
  return headers;
}

export async function fetchWithTenantHeaders(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = {
    ...(init?.headers || {}),
    ...resolveTenantHeaders(),
  } as Record<string, string>;
  return fetch(input, { ...init, headers });
}
