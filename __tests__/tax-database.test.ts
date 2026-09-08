import { NextRequest } from 'next/server';
import { db } from '@/lib/db';

let actor = 'p1d-ci-owner';
const companyId = 'p1d-ci-company';
jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  requireCompany: async () => ({ companyId: 'p1d-ci-company', userId: actor, error: null }),
}));
import { POST as createBill } from '@/app/api/bills/route';
import { POST as createInvoice } from '@/app/api/invoices/route';
import { PUT as updateInvoice } from '@/app/api/invoices/[id]/route';

const run = process.env.CI_TAX_DATABASE === '1' ? describe : describe.skip;
const request = (body: unknown, method = 'POST') => new NextRequest('http://localhost/api/test', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const date = new Date('2026-01-01T00:00:00Z');

run('P1-D real Postgres document lifecycle', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ledgerpro_ci') throw new Error('These fixtures may run only against the disposable CI database.');
    await db.user.createMany({ data: [{ id: actor, name: 'Synthetic tax reviewer', email: 'p1d-owner@example.invalid' }, { id: 'p1d-ci-bookkeeper', name: 'Synthetic bookkeeper', email: 'p1d-bookkeeper@example.invalid' }] });
    await db.company.create({ data: { id: companyId, name: 'P1-D synthetic CI company', province: 'QC', fiscalYearStart: date, onboardingComplete: true } });
    await db.membership.createMany({ data: [{ companyId, userId: actor, role: 'owner' }, { companyId, userId: 'p1d-ci-bookkeeper', role: 'bookkeeper' }] });
    for (const [code, type] of [['1100', 'asset'], ['2200', 'liability'], ['2300', 'liability'], ['2310', 'liability'], ['1300', 'asset'], ['1310', 'asset'], ['4000', 'income'], ['5000', 'expense'], ['5999', 'expense']] as const) {
      await db.chartOfAccount.create({ data: { id: `p1d-${code}`, companyId, code, type, name: `Synthetic ${code}` } });
    }
    await db.contact.create({ data: { id: 'p1d-ci-contact', companyId, name: 'Synthetic contact', type: 'supplier' } });
    await db.companyTaxConfiguration.create({ data: { companyId, enabled: true, configuredById: actor, configuredAt: date, gstHstOutputAccountId: 'p1d-2300', gstHstRecoverableAccountId: 'p1d-1300', qstOutputAccountId: 'p1d-2310', qstRecoverableAccountId: 'p1d-1310', taxRoundingAccountId: 'p1d-5999' } });
    for (const regime of ['gst_hst', 'qst'] as const) await db.companyTaxRegistration.create({ data: { companyId, regime, registrationNumber: `SYNTHETIC-${regime}`, filingFrequency: 'quarterly', validFrom: date, reviewedById: actor, reviewedAt: date } });
    for (const treatment of ['taxable', 'exempt'] as const) await db.taxCode.create({ data: { companyId, code: `SYNTHETIC-${treatment}`, name: `Synthetic ${treatment}`, versions: { create: { id: `p1d-${treatment}`, version: 1, treatment, jurisdiction: 'QC', effectiveFrom: date, sourceReference: 'Synthetic calculation fixture; not a production tax approval', reviewStatus: 'approved', reviewedById: actor, reviewedAt: date, components: { create: [{ type: 'gst', authority: 'cra', treatment, rate: treatment === 'taxable' ? 5 : 0, recoveryAllowed: treatment === 'taxable' }, { type: 'qst', authority: 'revenu_quebec', treatment, rate: treatment === 'taxable' ? 9.975 : 0, recoveryAllowed: treatment === 'taxable' }] } } } } });
  }, 30000);
  afterAll(async () => { await db.$disconnect(); });
  const selections = (purchase = false) => [{ lineIndex: 0, taxCodeVersionId: 'p1d-taxable', jurisdictionEvidence: { reference: 'Synthetic Quebec delivery' }, ...(purchase ? { recovery: { GST: { basisPoints: 5000, reason: 'Half commercial use fixture', evidence: { receipt: 'synthetic' }, reviewedById: 'p1d-ci-owner' }, QST: { basisPoints: 10000, reason: 'Fully eligible fixture', evidence: { receipt: 'synthetic' }, reviewedById: 'p1d-ci-owner' } } } : {}) }];
  const bill = (key: string) => ({ kind: 'bill', vendorId: 'p1d-ci-contact', billDate: '2026-01-15', status: 'open', subtotal: 1, taxAmount: 999, total: 1000, lineItems: [{ description: 'Synthetic supplies', amount: 100, categoryId: 'p1d-5000' }], taxDecision: { requestKey: key, lines: selections(true) } });
  let invoiceId: string;

  test('creates a mixed taxable/exempt invoice with exact independent GST and QST', async () => {
    const response = await createInvoice(request({ customerId: 'p1d-ci-contact', issueDate: '2026-01-15', dueDate: '2026-02-15', status: 'sent', subtotal: 0, total: 0, lineItems: [{ description: 'Taxable', quantity: 1, unitPrice: 100, amount: 999, categoryId: 'p1d-4000' }, { description: 'Exempt', quantity: 1, unitPrice: 50, amount: 888, categoryId: 'p1d-4000' }], taxDecision: { requestKey: 'p1d-ci-mixed-invoice', lines: [...selections(), { lineIndex: 1, taxCodeVersionId: 'p1d-exempt', jurisdictionEvidence: { reference: 'Synthetic exemption' } }] } }));
    const body = await response.json();
    expect({ status: response.status, error: body.error }).toEqual({ status: 201, error: undefined });
    invoiceId = body.data.id;
    expect(Number(body.data.subtotal)).toBe(150);
    expect(Number(body.data.taxAmount)).toBe(14.98);
    expect(Number(body.data.total)).toBe(164.98);
    const snapshots = await db.documentLineTaxSnapshot.findMany({ where: { invoiceLineItem: { invoiceId } }, include: { components: true } });
    expect(snapshots).toHaveLength(2);
    expect(snapshots.flatMap(row => row.components).map(row => Number(row.taxAmount)).sort((a,b) => a-b)).toEqual([0, 0, 5, 9.98]);
  });

  test('concurrent bill retries create one journal and preserve partial recovery evidence', async () => {
    const responses = await Promise.all([createBill(request(bill('p1d-ci-retry-bill'))), createBill(request(bill('p1d-ci-retry-bill')))]);
    const bodies = await Promise.all(responses.map(response => response.json()));
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    expect(bodies[0].data.id).toBe(bodies[1].data.id);
    expect(Number(bodies[0].data.total)).toBe(114.98);
    expect(await db.journalEntry.count({ where: { companyId, sourceId: bodies[0].data.id } })).toBe(1);
    const snapshot = await db.documentLineTaxSnapshot.findFirstOrThrow({ where: { billLineItem: { billId: bodies[0].data.id } }, include: { components: true } });
    const gst = snapshot.components.find(component => component.type === 'gst')!;
    expect(Number(gst.recoverableTax)).toBe(2.5);
    expect(Number(gst.nonrecoverableTax)).toBe(2.5);
    expect(gst.recoveryReviewedById).toBe('p1d-ci-owner');
    expect(gst.recoveryEvidence).toEqual({ receipt: 'synthetic' });
  });

  test('rejects a reused save key with different document contents', async () => {
    const changed = bill('p1d-ci-retry-bill');
    changed.lineItems[0].amount = 200;
    expect((await createBill(request(changed))).status).toBe(409);
  });

  test('a posting failure rolls back the document, audit receipt, and journal', async () => {
    const before = await db.bill.count({ where: { companyId } });
    const journalsBefore = await db.journalEntry.count({ where: { companyId } });
    await db.chartOfAccount.update({ where: { id: 'p1d-2200' }, data: { active: false } });
    try {
      expect((await createBill(request(bill('p1d-ci-failed-bill')))).status).toBe(500);
      expect(await db.bill.count({ where: { companyId } })).toBe(before);
      expect(await db.journalEntry.count({ where: { companyId } })).toBe(journalsBefore);
    } finally { await db.chartOfAccount.update({ where: { id: 'p1d-2200' }, data: { active: true } }); }
  });

  test('a bookkeeper cannot impersonate the recovery reviewer', async () => {
    actor = 'p1d-ci-bookkeeper';
    try { expect((await createBill(request(bill('p1d-ci-forged-review')))).status).toBe(400); }
    finally { actor = 'p1d-ci-owner'; }
  });

  test('posted invoices cannot be returned to draft or have their totals edited', async () => {
    expect((await updateInvoice(request({ status: 'draft' }, 'PUT'), { params: { id: invoiceId } })).status).toBe(409);
    expect((await updateInvoice(request({ total: 1 }, 'PUT'), { params: { id: invoiceId } })).status).toBe(409);
  });

  test('voiding in the current open period reverses a closed-period invoice exactly once', async () => {
    await db.periodClose.create({ data: { companyId, periodStart: date, periodEnd: new Date('2026-01-31T23:59:59Z'), status: 'closed' } });
    for (let i = 0; i < 2; i++) expect((await updateInvoice(request({ status: 'void' }, 'PUT'), { params: { id: invoiceId } })).status).toBe(200);
    const entries = await db.journalEntry.findMany({ where: { companyId, sourceId: invoiceId }, include: { lines: true } });
    expect(entries).toHaveLength(2);
    const amounts = new Map<string, number>();
    for (const line of entries.flatMap(entry => entry.lines)) amounts.set(line.glAccountCode, (amounts.get(line.glAccountCode) ?? 0) + Math.round(Number(line.debit) * 100) - Math.round(Number(line.credit) * 100));
    expect([...amounts.values()].every(value => value === 0)).toBe(true);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('void');
  });
});
