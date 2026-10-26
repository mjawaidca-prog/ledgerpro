/**
 * Phase 0.2 — Delete Company.
 *
 * LedgerPro had no delete path at all (verified live Oct 26, 2026: no
 * UI control, no DELETE handler under src/app/api/companies/), so dead
 * stub companies (the empty duplicate "2751623") could never be
 * removed. These tests pin the route's guardrails and the purge's
 * FK-safe ordering against schema.prisma, where most Company relations
 * are Restrict/no-cascade — a bare company.delete() would fail on any
 * company that has ever had a chart of accounts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

// ── Mocks (same pattern as api-keys-route.test.ts) ──────────────────
const mockMembershipFindUnique = jest.fn();
const mockMembershipCount = jest.fn();
const mockCompanyFindUnique = jest.fn();
const mockTransaction = jest.fn();

jest.mock('@/lib/db', () => ({
  db: {
    membership: {
      findUnique: (...args: unknown[]) => mockMembershipFindUnique(...args),
      count: (...args: unknown[]) => mockMembershipCount(...args),
    },
    company: { findUnique: (...args: unknown[]) => mockCompanyFindUnique(...args) },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const mockAuditLog = jest.fn();
jest.mock('@/lib/api-helpers', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

const mockGetServerSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

import { DELETE } from '@/app/api/companies/[id]/route';
import {
  companyPurgeSteps,
  confirmationMatches,
  companyConfirmationName,
  COMPANY_PURGE_DELEGATES,
} from '@/lib/delete-company';

const TARGET = 'co-stub';
const ACTIVE = 'co-muja';

function request(opts: { confirmName?: unknown; cookie?: string; headerCompany?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.headerCompany) headers['x-company-id'] = opts.headerCompany;
  if (opts.cookie) headers['cookie'] = `lp-active-company-id=${opts.cookie}`;
  return new NextRequest(`http://localhost/api/companies/${TARGET}`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify(opts.confirmName === undefined ? {} : { confirmName: opts.confirmName }),
  });
}

const call = (req: NextRequest) => DELETE(req, { params: { id: TARGET } });

function mockTxClient() {
  // A Prisma-like tx client where every delegate records its calls and
  // resolves. Built from the purge step list itself so new steps are
  // covered automatically.
  const calls: Array<{ delegate: string; op: string; arg: any }> = [];
  const tx: any = {};
  const delegates = new Set<string>([
    ...companyPurgeSteps(TARGET).map((s) => s.delegate.replace(/Update$/, '')),
    'company',
  ]);
  for (const d of delegates) {
    tx[d] = {
      deleteMany: jest.fn(async (arg: any) => { calls.push({ delegate: d, op: 'deleteMany', arg }); return { count: 1 }; }),
      updateMany: jest.fn(async (arg: any) => { calls.push({ delegate: d, op: 'updateMany', arg }); return { count: 1 }; }),
      delete: jest.fn(async (arg: any) => { calls.push({ delegate: d, op: 'delete', arg }); return {}; }),
    };
  }
  return { tx, calls };
}

describe('DELETE /api/companies/[id] — guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', activeCompanyId: ACTIVE } });
    mockMembershipFindUnique.mockResolvedValue({ userId: 'owner-1', companyId: TARGET, role: 'owner' });
    mockMembershipCount.mockResolvedValue(3);
    mockCompanyFindUnique.mockResolvedValue({ id: TARGET, name: '2751623', legalName: null });
    mockTransaction.mockImplementation(async (fn: any) => fn(mockTxClient().tx));
  });

  test('unauthenticated → 401, nothing deleted', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await call(request({ confirmName: '2751623' }));
    expect(res.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('non-member of the target → 404, nothing deleted', async () => {
    mockMembershipFindUnique.mockResolvedValue(null);
    const res = await call(request({ confirmName: '2751623' }));
    expect(res.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('member but not owner (admin) → 403, nothing deleted', async () => {
    mockMembershipFindUnique.mockResolvedValue({ userId: 'owner-1', companyId: TARGET, role: 'admin' });
    const res = await call(request({ confirmName: '2751623' }));
    expect(res.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test("caller's only company → 409, nothing deleted", async () => {
    mockMembershipCount.mockResolvedValue(1);
    const res = await call(request({ confirmName: '2751623' }));
    expect(res.status).toBe(409);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('target IS the active company (cookie) → 409, nothing deleted', async () => {
    const res = await call(request({ confirmName: '2751623', cookie: TARGET }));
    expect(res.status).toBe(409);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('target IS the active company (session) → 409, nothing deleted', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', activeCompanyId: TARGET } });
    const res = await call(request({ confirmName: '2751623' }));
    expect(res.status).toBe(409);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('confirmName mismatch → 400, nothing deleted', async () => {
    const res = await call(request({ confirmName: '2751623 Alberta Corporation' }));
    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('confirmName missing → 400, nothing deleted', async () => {
    const res = await call(request({}));
    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('success: exact name → 200, audit-logged, purge runs in ONE transaction, company deleted last', async () => {
    const { tx, calls } = mockTxClient();
    mockTransaction.mockImplementation(async (fn: any) => fn(tx));

    const res = await call(request({ confirmName: '2751623' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deletedCompanyId).toBe(TARGET);

    expect(mockAuditLog).toHaveBeenCalledWith(
      TARGET, 'owner-1', 'company.delete', 'company', TARGET,
      expect.objectContaining({ name: '2751623' })
    );
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(calls.length).toBeGreaterThan(40);
    const last = calls[calls.length - 1];
    expect(last.delegate).toBe('company');
    expect(last.op).toBe('delete');
    expect(last.arg).toEqual({ where: { id: TARGET } });
    // Everything else is scoped to the target company id.
    for (const c of calls.slice(0, -1)) {
      expect(JSON.stringify(c.arg)).toContain(TARGET);
    }
  });

  test('legalName is accepted as the confirmation when set', async () => {
    mockCompanyFindUnique.mockResolvedValue({ id: TARGET, name: 'Muja', legalName: '2751623 Alberta Corporation' });
    const res = await call(request({ confirmName: '2751623 Alberta Corporation' }));
    expect(res.status).toBe(200);
  });

  test('purge failure inside the transaction → 500 (transaction rolls back)', async () => {
    mockTransaction.mockRejectedValue(new Error('FK constraint failed'));
    const res = await call(request({ confirmName: '2751623' }));
    expect(res.status).toBe(500);
  });
});

describe('confirmation helpers', () => {
  test('exact match against name or legalName; trimmed; case-sensitive', () => {
    const co = { name: '2751623', legalName: '2751623 Alberta Corporation' };
    expect(confirmationMatches('2751623', co)).toBe(true);
    expect(confirmationMatches('2751623 Alberta Corporation', co)).toBe(true);
    expect(confirmationMatches('  2751623  ', co)).toBe(true);
    expect(confirmationMatches('2751623 alberta corporation', co)).toBe(false);
    expect(confirmationMatches('', co)).toBe(false);
    expect(confirmationMatches(undefined, co)).toBe(false);
    expect(confirmationMatches(42, co)).toBe(false);
  });

  test('confirmation name prefers legalName (identity on reports)', () => {
    expect(companyConfirmationName({ name: 'Muja', legalName: '2751623 Alberta Corporation' })).toBe('2751623 Alberta Corporation');
    expect(companyConfirmationName({ name: '2751623', legalName: null })).toBe('2751623');
  });
});

describe('purge step ordering (FK-safe against schema.prisma)', () => {
  const steps = companyPurgeSteps('co-x');
  const idx = (d: string) => steps.findIndex((s) => s.delegate === d);

  test('every deleteMany delegate is in the documented list, and vice versa', () => {
    const stepDelegates = steps.filter((s) => !s.delegate.endsWith('Update')).map((s) => s.delegate);
    expect([...stepDelegates].sort()).toEqual([...COMPANY_PURGE_DELEGATES, 'company'].sort());
  });

  test('children are deleted before the parents they restrict-reference', () => {
    const before = (child: string, parent: string) =>
      expect(idx(child)).toBeLessThan(idx(parent));
    before('journalLine', 'journalEntry');
    before('transferMatch', 'journalEntry'); // entries reference the match
    before('journalEntry', 'transaction'); // safe either way; entries first
    before('transaction', 'chartOfAccount'); // transactions category-reference accounts
    before('transaction', 'financialAccount');
    before('invoiceLineItem', 'invoice');
    before('invoice', 'contact');
    before('bill', 'contact');
    before('companyTaxConfiguration', 'chartOfAccount'); // Restrict refs to accounts
    before('categorizationRule', 'chartOfAccount');
    before('bankRule', 'contact');
    before('statementImport', 'financialAccount');
    before('importBatch', 'columnMapping'); // batches reference mappings
    before('columnMapping', 'financialAccount');
    before('taxWorkpaperRemittance', 'taxReturnWorkpaper');
    before('documentLineTaxSnapshot', 'taxCode'); // snapshot restrict-refs code versions
    before('taxPosting', 'journalEntry');
    before('interCompanyTransaction', 'journalEntry');
    before('interCompanyTransaction', 'relatedPartyLink');
    before('relatedPartyLink', 'company');
    before('membership', 'company');
    before('subscription', 'company');
    expect(idx('company')).toBe(steps.length - 1);
  });

  test('self-referencing reversal FKs are nulled before their deleteMany', () => {
    expect(idx('documentLineTaxSnapshotUpdate')).toBeLessThan(idx('documentLineTaxSnapshot'));
    expect(idx('taxPostingUpdate')).toBeLessThan(idx('taxPosting'));
    expect(idx('journalEntryUpdate')).toBeLessThan(idx('journalEntry'));
  });

  test('the purge covers every company-scoped model in schema.prisma', () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const modelBlocks = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)];
    // Prisma delegate name = model name with lowercased first letter.
    const covered = new Set(steps.map((s) => s.delegate.replace(/Update$/, '')));
    const missing: string[] = [];
    for (const [, model, body] of modelBlocks) {
      const delegate = model.charAt(0).toLowerCase() + model.slice(1);
      const scopedDirectly = /\bcompanyId\s+String/.test(body);
      const scopedViaLink = model === 'RelatedPartyLink';
      if ((scopedDirectly || scopedViaLink) && model !== 'Company' && !covered.has(delegate)) {
        missing.push(model);
      }
    }
    expect(missing).toEqual([]);
    // No-companyId children that must be reached through a parent:
    for (const child of [
      'journalLine', 'invoiceLineItem', 'billLineItem', 'budgetLine', 'recurringLine',
      'taxCodeVersion', 'taxCodeComponent', 'documentLineTaxComponent', 'columnMapping',
      'webhookDelivery', 'apiRateCounter', 'bankFeedAccount', 'bankSyncRun',
      'bankFeedTransaction', 'interCompanyTransaction',
    ]) {
      expect(covered.has(child)).toBe(true);
    }
  });
});
