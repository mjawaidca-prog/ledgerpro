/**
 * Phase 0 (P0-1) — one source of truth for the active company.
 *
 * Live bug: Settings / Reports / Period Close used data[0] from
 * GET /api/companies (the OLDEST membership — "A Jays Accounting") while
 * the company selector showed the active company ("2751623 Alberta
 * Corporation") and PUT /api/companies saved into the ACTIVE company.
 */
import { resolveActiveCompanyId, pickActiveCompany, companyDisplayName } from '@/lib/active-company';

const companies = [
  { id: 'co-a-jays', name: 'A Jays Accounting', legalName: 'A Jays Accounting' },
  { id: 'co-2751623', name: '2751623', legalName: null },
  { id: 'co-muja', name: '2751623 Alberta Corporation', legalName: '2751623 Alberta Corporation' },
];

describe('Phase 0 — active company resolution', () => {
  test('server-returned activeCompanyId wins over cookie and session', () => {
    expect(resolveActiveCompanyId({
      responseActiveCompanyId: 'co-muja',
      cookieCompanyId: 'co-a-jays',
      sessionActiveCompanyId: 'co-a-jays',
    })).toBe('co-muja');
  });

  test('cookie is used when the response carries no active id', () => {
    expect(resolveActiveCompanyId({ cookieCompanyId: 'co-2751623', sessionActiveCompanyId: 'co-a-jays' })).toBe('co-2751623');
  });

  test('"undefined" strings (a known stale-cookie artefact) are ignored', () => {
    expect(resolveActiveCompanyId({ responseActiveCompanyId: 'undefined', cookieCompanyId: 'undefined', sessionActiveCompanyId: 'co-muja' })).toBe('co-muja');
  });

  test('pickActiveCompany returns the ACTIVE company, never silently data[0] when an id is known', () => {
    expect(pickActiveCompany(companies, 'co-muja')?.name).toBe('2751623 Alberta Corporation');
    expect(pickActiveCompany(companies, 'co-muja')?.id).not.toBe(companies[0].id);
  });

  test('falls back to first membership only when no usable id exists (mirrors server requireCompany fallback)', () => {
    expect(pickActiveCompany(companies, null)?.id).toBe('co-a-jays');
    expect(pickActiveCompany(companies, 'co-gone')?.id).toBe('co-a-jays');
  });

  test('empty list yields null, not a crash or a fabricated company', () => {
    expect(pickActiveCompany([], 'co-muja')).toBeNull();
    expect(pickActiveCompany(null, 'co-muja')).toBeNull();
  });

  test('display name prefers legal name and never invents one', () => {
    expect(companyDisplayName(companies[2])).toBe('2751623 Alberta Corporation');
    expect(companyDisplayName(null)).toBe('your company');
  });
});
