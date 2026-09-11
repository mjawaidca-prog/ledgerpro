import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve('prisma/migrations/20260911210000_api_d_webhooks/migration.sql'),
  'utf8',
);

describe('API-D webhooks migration', () => {
  test('adds the endpoint and delivery tables with the status enum', () => {
    expect(migration).toContain('CREATE TABLE "WebhookEndpoint"');
    expect(migration).toContain('CREATE TABLE "WebhookDelivery"');
    expect(migration).toContain(`CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'success', 'failed', 'dead')`);
    expect(migration).toContain('"events" TEXT[]');
  });

  test('enforces one delivery per (endpoint, event)', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_key"');
  });

  test('is purely additive', () => {
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});
