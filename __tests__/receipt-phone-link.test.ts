/**
 * "Add from phone" (2026-10-30) — a short-lived, upload-only link lets
 * a phone add receipts to one company's inbox without signing in.
 *
 * Part 1 pins the migration/schema shape. Part 2 pins the service
 * behavior against a mocked db: only the token's SHA-256 hash is
 * stored, minting replaces the previous link, and resolution rejects
 * unknown, expired, and over-used tokens.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

jest.mock('unpdf', () => ({ getDocumentProxy: jest.fn(), extractText: jest.fn() }));
jest.mock('tesseract.js', () => ({ createWorker: jest.fn() }));
jest.mock('@/lib/db', () => ({
  db: {
    receiptUploadLink: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock('@/lib/default-coa', () => ({
  ...jest.requireActual('@/lib/default-coa'),
  getDefaultFinancialAccountGlCode: jest.fn(async () => '1040'),
}));
jest.mock('@/lib/api-helpers', () => ({
  closedPeriodGuard: jest.fn(async () => null),
  accountLockedGuard: jest.fn(async () => null),
}));

import { db } from '@/lib/db';
import {
  createReceiptUploadLink,
  resolveReceiptUploadLink,
  RECEIPT_LINK_MAX_UPLOADS,
} from '@/lib/receipts/service';

const mockDb = db as any;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('phone link — migration and schema', () => {
  const migration = readFileSync(
    resolve('prisma/migrations/20261030120000_receipt_upload_link/migration.sql'),
    'utf8',
  );
  const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');

  test('creates the table with a unique token hash and cascading company/user keys', () => {
    expect(migration).toMatch(/CREATE TABLE "ReceiptUploadLink"/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "ReceiptUploadLink_tokenHash_key" ON "ReceiptUploadLink"\("tokenHash"\)/);
    expect(migration).toMatch(/"ReceiptUploadLink_companyId_fkey" FOREIGN KEY \("companyId"\) REFERENCES "Company"\("id"\) ON DELETE CASCADE/);
    expect(migration).toMatch(/"ReceiptUploadLink_userId_fkey" FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/);
    expect(migration).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)/i);
  });

  test('schema carries the model and both relations', () => {
    expect(schema).toMatch(/model ReceiptUploadLink \{/);
    expect(schema).toMatch(/tokenHash\s+String\s+@unique/);
    expect(schema).toMatch(/receiptUploadLinks\s+ReceiptUploadLink\[\]/);
  });
});

describe('phone link — service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.receiptUploadLink.deleteMany.mockResolvedValue({ count: 1 });
    mockDb.receiptUploadLink.create.mockResolvedValue({});
  });

  test('minting replaces the old link and stores only the hash', async () => {
    const before = Date.now();
    const { token, expiresAt } = await createReceiptUploadLink({ companyId: 'c1', userId: 'u1' });

    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(mockDb.receiptUploadLink.deleteMany).toHaveBeenCalledWith({
      where: { companyId: 'c1', userId: 'u1' },
    });
    const created = mockDb.receiptUploadLink.create.mock.calls[0][0].data;
    expect(created.tokenHash).toBe(sha256(token));
    expect(created.tokenHash).not.toBe(token);
    // ~30 minute lifetime
    expect(expiresAt.getTime()).toBeGreaterThan(before + 29 * 60 * 1000);
    expect(expiresAt.getTime()).toBeLessThan(before + 31 * 60 * 1000);
  });

  test('resolves a live link; rejects unknown, expired, and exhausted ones', async () => {
    const live = {
      id: 'l1',
      companyId: 'c1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      uploadsUsed: 3,
      company: { name: 'Receipt Test Co' },
    };
    mockDb.receiptUploadLink.findUnique.mockResolvedValue(live);
    await expect(resolveReceiptUploadLink('x'.repeat(43))).resolves.toMatchObject({ id: 'l1' });
    expect(mockDb.receiptUploadLink.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: sha256('x'.repeat(43)) } }),
    );

    mockDb.receiptUploadLink.findUnique.mockResolvedValue({ ...live, expiresAt: new Date(Date.now() - 1000) });
    await expect(resolveReceiptUploadLink('x'.repeat(43))).resolves.toBeNull();

    mockDb.receiptUploadLink.findUnique.mockResolvedValue({ ...live, uploadsUsed: RECEIPT_LINK_MAX_UPLOADS });
    await expect(resolveReceiptUploadLink('x'.repeat(43))).resolves.toBeNull();

    mockDb.receiptUploadLink.findUnique.mockResolvedValue(null);
    await expect(resolveReceiptUploadLink('x'.repeat(43))).resolves.toBeNull();

    await expect(resolveReceiptUploadLink('short')).resolves.toBeNull();
  });
});
