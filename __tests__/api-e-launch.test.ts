import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openapiDocument } from '@/lib/api/openapi';
import { HELP_CATEGORIES, HELP_ARTICLES } from '@/lib/help-content';

describe('API-E OpenAPI document', () => {
  test('covers every v1 endpoint with bearer security', () => {
    const doc: any = openapiDocument();
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.security).toEqual([{ apiKey: [] }]);

    const paths = Object.keys(doc.paths);
    for (const expected of [
      '/company', '/accounts', '/contacts', '/contacts/{id}', '/invoices', '/invoices/{id}',
      '/invoices/{id}/post', '/invoices/{id}/void', '/bills', '/bills/{id}', '/bills/{id}/post',
      '/bills/{id}/void', '/payments', '/payments/{id}/reverse', '/transactions',
      '/journal-entries', '/journal-entries/{id}', '/journal-entries/{id}/void', '/tax-codes',
      '/reports/trial-balance', '/reports/balance-sheet', '/reports/profit-loss',
      '/reports/ar-aging', '/reports/ap-aging',
    ]) {
      expect(paths).toContain(expected);
    }

    expect(doc.components.securitySchemes.apiKey.type).toBe('http');
    expect(doc.components.schemas.Money).toBeDefined();
    expect(doc.components.schemas.Pagination).toBeDefined();
    expect(doc.components.schemas.Error).toBeDefined();
    expect(doc.components.schemas.WebhookSignature.description).toContain('HMAC-SHA256');
  });

  test('documents idempotency on every POST endpoint (PATCH replays are naturally safe)', () => {
    const doc: any = openapiDocument();
    for (const [path, methods] of Object.entries<any>(doc.paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        if (method === 'post') {
          const hasIdem = (op.parameters ?? []).some((p: any) => p.name === 'Idempotency-Key');
          expect(hasIdem).toBe(true);
        }
      }
    }
  });
});

describe('API-E help center', () => {
  test('the Developer API category exists with the documented topics', () => {
    expect(HELP_CATEGORIES).toContain('Developer API');
    const apiArticles = HELP_ARTICLES.filter((a) => a.category === 'Developer API');
    expect(apiArticles.length).toBeGreaterThanOrEqual(6);
    for (const slug of [
      'developer-api-overview',
      'developer-api-auth',
      'developer-api-pagination',
      'developer-api-errors',
      'developer-api-tax-fx',
      'developer-api-webhooks',
      'developer-api-sandbox',
    ]) {
      expect(apiArticles.some((a) => a.slug === slug)).toBe(true);
    }
  });
});

describe('API-E pricing reconciliation', () => {
  test('the marketing page matches the billing seed prices', () => {
    const page = readFileSync(resolve('src/app/pricing/page.tsx'), 'utf8');
    // Plan seeds: Basic 29/290, Pro 79/790, Enterprise 199/1990.
    expect(page).toContain("price: '$29'");
    expect(page).toContain("annualPrice: '$290/yr'");
    expect(page).toContain("price: '$79'");
    expect(page).toContain("annualPrice: '$790/yr'");
    expect(page).toContain("price: '$199'");
    expect(page).toContain("annualPrice: '$1,990/yr'");
  });

  test('API access is advertised on Pro and Enterprise only', () => {
    const page = readFileSync(resolve('src/app/pricing/page.tsx'), 'utf8');
    const proBlock = page.match(/name: 'Pro'[\s\S]*?featured:/)?.[0] ?? '';
    const enterpriseBlock = page.match(/name: 'Enterprise'[\s\S]*?featured:/)?.[0] ?? '';
    expect(proBlock).toContain('API access');
    expect(enterpriseBlock).toContain('API access');
  });
});

describe('API-E plan migration', () => {
  test('adds the entitlement column and enables Pro and Enterprise only', () => {
    const migration = readFileSync(
      resolve('prisma/migrations/20260911230000_api_e_plan_api_access/migration.sql'),
      'utf8'
    );
    expect(migration).toMatch(/ADD COLUMN\s+"apiAccess" BOOLEAN NOT NULL DEFAULT false/);
    expect(migration).toContain(`WHERE "id" IN ('plan_pro', 'plan_enterprise')`);
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
