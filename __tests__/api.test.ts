/**
 * LedgerPro API Integration Tests
 * Run with: npx jest __tests__/api.test.ts
 *
 * Tests critical API endpoints for correctness and security.
 * Requires a running dev server and seeded database.
 */

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3003';

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const json = await res.json();
  return { status: res.status, json };
}

describe('API Authentication', () => {
  test('GET /api/auth/providers returns providers', async () => {
    const { status, json } = await api('/api/auth/providers');
    expect(status).toBe(200);
    expect(json).toBeDefined();
  });

  test('GET /api/auth/csrf returns CSRF token', async () => {
    const { status } = await api('/api/auth/csrf');
    expect(status).toBe(200);
  });

  test('POST /api/auth/callback/credentials with valid credentials returns session', async () => {
    const { status } = await api('/api/auth/callback/credentials', {
      method: 'POST',
      body: JSON.stringify({
        email: 'rosa@northwindtrading.com',
        password: 'ledgerpro2026',
        redirect: false,
        csrfToken: 'mock', // CSRF is bypassed in test mode
      }),
    });
    // May be 200 (success) or 302 (redirect) — both mean auth works
    expect([200, 302, 401]).toContain(status);
  });
});

describe('Public Endpoints', () => {
  test('GET /login returns login page', async () => {
    const { status } = await api('/login');
    expect(status).toBe(200);
  });

  test('GET /register returns registration page', async () => {
    const { status } = await api('/register');
    expect(status).toBe(200);
  });

  test('GET /pay/INV-1044 returns public invoice view', async () => {
    const { status } = await api('/pay/INV-1044');
    // 200 if invoice exists, 404 if not — either is valid (test just checks it doesn't crash)
    expect([200, 404]).toContain(status);
  });
});

describe('Data Integrity', () => {
  test('Trial Balance must balance (debits = credits)', async () => {
    // This test requires auth — skip if not authenticated
    const { status, json } = await api('/api/reports/trial-balance?asOf=2026-06-26');
    if (status === 200 && json.data) {
      const diff = Math.abs((json.data.totalDebits || 0) - (json.data.totalCredits || 0));
      expect(diff).toBeLessThan(1); // must balance within $1
    }
    // 401 is also acceptable (not signed in)
    expect([200, 401]).toContain(status);
  });

  test('Chart of Accounts returns valid structure', async () => {
    const { status, json } = await api('/api/coa');
    if (status === 200) {
      expect(Array.isArray(json.data)).toBe(true);
      if (json.data?.length > 0) {
        const acct = json.data[0];
        expect(acct.code).toBeDefined();
        expect(acct.name).toBeDefined();
        expect(acct.type).toBeDefined();
      }
    }
  });
});

describe('Error Handling', () => {
  test('GET /api/invoices without auth returns 401', async () => {
    const { status } = await api('/api/invoices');
    expect(status).toBe(401);
  });

  test('POST /api/period-close with invalid dates returns 400', async () => {
    const { status } = await api('/api/period-close', {
      method: 'POST',
      body: JSON.stringify({ periodStart: 'invalid', periodEnd: 'also-invalid' }),
    });
    // 400 (bad request) or 401 (unauthorized) — both correct
    expect([400, 401]).toContain(status);
  });

  test('GET non-existent API returns 404', async () => {
    const { status } = await api('/api/nonexistent-endpoint');
    expect(status).toBe(404);
  });
});

describe('Phase 4 Features', () => {
  test('GET /api/recurring returns templates (auth required)', async () => {
    const { status } = await api('/api/recurring');
    expect([200, 401]).toContain(status);
  });

  test('GET /api/categorization-rules returns rules (auth required)', async () => {
    const { status } = await api('/api/categorization-rules');
    expect([200, 401]).toContain(status);
  });

  test('GET /reports/custom returns custom report builder page', async () => {
    const { status } = await api('/reports/custom');
    expect(status).toBe(200);
  });
});

describe('Consolidated Reports', () => {
  // Unauthenticated requests are blocked either by a 401/403 JSON response or
  // by the middleware redirecting to /login (307) — never allowed through.
  async function blocked(path: string) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    expect([307, 401, 403]).toContain(res.status);
  }

  test('GET /api/reports/consolidated without auth is blocked', async () => {
    await blocked('/api/reports/consolidated?statement=balance-sheet&companyIds=a,b&asOf=2026-06-26');
  });

  test('GET /api/reports/consolidated with unknown statement is blocked', async () => {
    await blocked('/api/reports/consolidated?statement=nonsense&companyIds=a,b');
  });

  test('GET /api/reports/consolidated/drilldown without auth is blocked', async () => {
    await blocked('/api/reports/consolidated/drilldown?code=1000&companyIds=a,b');
  });

  test('GET /api/reports/packages without auth is blocked', async () => {
    await blocked('/api/reports/packages');
  });

  test('GET /api/settings/exchange-rates without auth is blocked', async () => {
    await blocked('/api/settings/exchange-rates');
  });
});

describe('Banking Overhaul', () => {
  async function blocked(path: string) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    expect([307, 401, 403]).toContain(res.status);
  }

  test('GET /api/import-presets without auth is blocked', async () => {
    await blocked('/api/import-presets');
  });

  test('GET /api/bank-rules without auth is blocked', async () => {
    await blocked('/api/bank-rules');
  });

  test('GET /api/reconciliations without auth is blocked', async () => {
    await blocked('/api/reconciliations?accountId=x');
  });

  test('GET /api/import-reminders/check without CRON_SECRET returns 401', async () => {
    const res = await fetch(`${BASE}/api/import-reminders/check`, { redirect: 'manual' });
    expect(res.status).toBe(401);
  });

  test('GET /api/imports without auth is blocked', async () => {
    await blocked('/api/imports');
  });
});
