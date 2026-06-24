import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const db = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Northwind Trading...');

  // ─── Create company and user ───

  const passwordHash = await hash('ledgerpro2026', 12);

  const user = await db.user.upsert({
    where: { email: 'rosa@northwindtrading.com' },
    update: {},
    create: {
      name: 'Rosa Alvarez',
      email: 'rosa@northwindtrading.com',
      passwordHash,
    },
  });

  const company = await db.company.upsert({
    where: { ownerId: user.id },
    update: {},
    create: {
      name: 'Northwind Trading',
      legalName: 'Northwind Trading LLC',
      fiscalYearStart: new Date('2026-01-01'),
      currency: 'USD',
      locale: 'en-US',
      timezone: 'America/Edmonton',
      ownerId: user.id,
    },
  });

  console.log(`  ✓ User: ${user.email} / password: ledgerpro2026`);
  console.log(`  ✓ Company: ${company.name} (${company.id})`);

  // ─── Chart of Accounts ───

  const chartOfAccounts = await Promise.all([
    // Assets
    db.chartOfAccount.create({ data: { companyId: company.id, code: '1000', name: 'Bank Accounts', type: 'asset', detailType: 'Bank', balance: 278512.10, description: 'Cash and bank accounts' } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '1010', name: 'Chase Business Checking', type: 'asset', detailType: 'Bank', parentCode: '1000', balance: 185420.30, description: 'Primary operating account' } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '1020', name: 'Chase Business Savings', type: 'asset', detailType: 'Savings', parentCode: '1000', balance: 93091.80, description: 'Interest-bearing reserve' } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '1100', name: 'Accounts Receivable', type: 'asset', detailType: 'Accounts receivable', balance: 78220.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '1200', name: 'Prepaid Expenses', type: 'asset', detailType: 'Prepaid expenses', balance: 2400.00 } }),

    // Liabilities
    db.chartOfAccount.create({ data: { companyId: company.id, code: '2000', name: 'Credit Cards', type: 'liability', detailType: 'Credit card', balance: 18240.55 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '2110', name: 'Amex Business', type: 'liability', detailType: 'Credit card', parentCode: '2000', balance: 12480.20, description: 'Amex Business Gold' } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '2120', name: 'Chase Ink', type: 'liability', detailType: 'Credit card', parentCode: '2000', balance: 5760.35 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '2200', name: 'Accounts Payable', type: 'liability', detailType: 'Accounts payable', balance: 32400.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '2300', name: 'Sales Tax Payable', type: 'liability', detailType: 'Sales tax payable', balance: 5110.20 } }),

    // Equity
    db.chartOfAccount.create({ data: { companyId: company.id, code: '3000', name: "Owner's Capital", type: 'equity', detailType: "Owner's equity", balance: 120000.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '3100', name: 'Retained Earnings', type: 'equity', detailType: 'Retained earnings', balance: 95420.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '3900', name: "Owner's Draw", type: 'equity', detailType: "Owner's equity", balance: -18000.00 } }),

    // Income
    db.chartOfAccount.create({ data: { companyId: company.id, code: '4000', name: 'Product Sales', type: 'income', detailType: 'Product sales', balance: 248900.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '4100', name: 'Service Revenue', type: 'income', detailType: 'Service revenue', balance: 162400.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '4908', name: 'Other Income', type: 'income', detailType: 'Other income', balance: 8150.00 } }),

    // Expenses
    db.chartOfAccount.create({ data: { companyId: company.id, code: '5000', name: 'Cost of Goods Sold', type: 'expense', detailType: 'COGS', balance: 120240.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '6100', name: 'Software & Subscriptions', type: 'expense', detailType: 'Dues & subscriptions', balance: 48200.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '6200', name: 'Professional Fees', type: 'expense', detailType: 'Professional fees', balance: 28400.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '6300', name: 'Rent & Lease', type: 'expense', detailType: 'Rent & lease', balance: 19200.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '6400', name: 'Marketing', type: 'expense', detailType: 'Marketing', balance: 15800.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '6500', name: 'Travel', type: 'expense', detailType: 'Travel', balance: 8600.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '6600', name: 'Utilities', type: 'expense', detailType: 'Utilities', balance: 4200.00 } }),
    db.chartOfAccount.create({ data: { companyId: company.id, code: '6950', name: 'Legacy Expenses', type: 'expense', detailType: 'Other expense', balance: 0, active: false } }),
  ]);

  console.log(`  ✓ ${chartOfAccounts.length} GL accounts`);

  // ─── Financial Accounts ───

  const [chaseChecking, amexCard] = await Promise.all([
    db.financialAccount.create({
      data: {
        companyId: company.id,
        name: 'Chase Business Checking',
        mask: '4021',
        kind: 'checking',
        currentBalance: 185420.30,
        glAccountCode: '1010',
        displayColor: '#1f6feb',
        logoInitials: 'CB',
        syncStatus: 'manual',
      },
    }),
    db.financialAccount.create({
      data: {
        companyId: company.id,
        name: 'Amex Business',
        mask: '1008',
        kind: 'creditcard',
        currentBalance: -12480.20,
        glAccountCode: '2110',
        displayColor: '#1f6feb',
        logoInitials: 'AE',
        syncStatus: 'manual',
      },
    }),
  ]);

  console.log('  ✓ 2 financial accounts');

  // ─── Contacts ───

  const contacts = await Promise.all([
    db.contact.create({ data: { companyId: company.id, name: 'Maria Chen',    companyName: 'Acme Corp',       type: 'customer', email: 'maria@acmecorp.com',      phone: '+1 415 555 0101', outstandingBalance: 24500.00, status: 'active' } }),
    db.contact.create({ data: { companyId: company.id, name: 'James Okonkwo', companyName: 'Nexus Labs',      type: 'customer', email: 'james@nexuslabs.io',      phone: '+1 312 555 0142', outstandingBalance: 18200.00, status: 'active' } }),
    db.contact.create({ data: { companyId: company.id, name: 'Sarah Mills',   companyName: 'Orbit Media',     type: 'customer', email: 'sarah@orbitmedia.co',     phone: '+1 206 555 0173', outstandingBalance: 12100.00, status: 'active' } }),
    db.contact.create({ data: { companyId: company.id, name: 'David Park',    companyName: 'Blue Ridge Inc',  type: 'customer', email: 'dpark@blueridge.com',     phone: '+1 720 555 0194', outstandingBalance: 0,        status: 'active' } }),
    db.contact.create({ data: { companyId: company.id, name: 'Lisa Nguyen',   companyName: 'Cloud Nine LLC',  type: 'customer', email: 'lisa@cloudnine.co',       phone: '+1 503 555 0128', outstandingBalance: 23420.00, status: 'active' } }),
    db.contact.create({ data: { companyId: company.id, name: 'AWS Billing',   companyName: 'AWS',             type: 'supplier', email: 'billing@aws.amazon.com',  phone: null,               outstandingBalance: 2044.47,  status: 'active' } }),
    db.contact.create({ data: { companyId: company.id, name: 'Google Workspace', companyName: 'Google',       type: 'supplier', email: 'billing@google.com',      phone: null,               outstandingBalance: 720.00,   status: 'active' } }),
    db.contact.create({ data: { companyId: company.id, name: 'Office Lease',  companyName: 'WeWork',          type: 'supplier', email: 'rent@wework.com',         phone: '+1 212 555 0200',  outstandingBalance: 3600.00,  status: 'active' } }),
  ]);

  console.log(`  ✓ ${contacts.length} contacts`);

  // ─── Invoices ───

  const invoices = await Promise.all([
    db.invoice.create({
      data: {
        id: 'INV-1048', companyId: company.id, customerId: contacts[0].id, issueDate: new Date('2026-05-16'), dueDate: new Date('2026-06-15'),
        terms: 'Net 30', subtotal: 22500.00, taxRate: 8.5, taxAmount: 2000.00, total: 24500.00,
        status: 'sent', sentAt: new Date('2026-05-16'),
        lineItems: { create: [
          { description: 'Website redesign — Phase 2', quantity: 1, unitPrice: 15000.00, amount: 15000.00, sortOrder: 0 },
          { description: 'Content migration', quantity: 1, unitPrice: 7500.00, amount: 7500.00, sortOrder: 1 },
        ]},
      },
    }),
    db.invoice.create({
      data: {
        id: 'INV-1047', companyId: company.id, customerId: contacts[1].id, issueDate: new Date('2026-05-09'), dueDate: new Date('2026-06-08'),
        terms: 'Net 30', subtotal: 16800.00, taxRate: 8.5, taxAmount: 1400.00, total: 18200.00,
        status: 'overdue',
        lineItems: { create: [
          { description: 'API integration services', quantity: 1, unitPrice: 12000.00, amount: 12000.00, sortOrder: 0 },
          { description: 'QA testing', quantity: 1, unitPrice: 4800.00, amount: 4800.00, sortOrder: 1 },
        ]},
      },
    }),
    db.invoice.create({
      data: {
        id: 'INV-1045', companyId: company.id, customerId: contacts[2].id, issueDate: new Date('2026-05-23'), dueDate: new Date('2026-06-22'),
        terms: 'Net 30', subtotal: 11200.00, taxRate: 8.5, taxAmount: 900.00, total: 12100.00,
        status: 'sent', sentAt: new Date('2026-05-23'),
        lineItems: { create: [
          { description: 'Brand strategy consultation', quantity: 1, unitPrice: 11200.00, amount: 11200.00, sortOrder: 0 },
        ]},
      },
    }),
    db.invoice.create({
      data: {
        id: 'INV-1044', companyId: company.id, customerId: contacts[3].id, issueDate: new Date('2026-05-01'), dueDate: new Date('2026-06-01'),
        terms: 'Net 30', subtotal: 8700.00, taxRate: 8.5, taxAmount: 720.55, total: 9420.55,
        status: 'paid', paidAt: new Date('2026-05-28'), paidAmount: 9420.55, paymentAccountId: chaseChecking.id,
        lineItems: { create: [
          { description: 'Monthly retainer — May', quantity: 1, unitPrice: 8700.00, amount: 8700.00, sortOrder: 0 },
        ]},
      },
    }),
  ]);

  console.log(`  ✓ ${invoices.length} invoices`);

  // ─── Bills ───

  await Promise.all([
    db.bill.create({
      data: {
        id: 'BILL-2044', companyId: company.id, kind: 'bill', vendorId: contacts[5].id, billDate: new Date('2026-05-20'),
        dueDate: new Date('2026-06-19'), terms: 'Net 30', referenceNo: 'AWS-2026-05',
        subtotal: 1884.30, taxRate: 8.5, taxAmount: 160.17, total: 2044.47, status: 'open',
        lineItems: { create: [
          { description: 'Annual SaaS license renewal', amount: 1284.30, categoryId: chartOfAccounts.find(c => c.code === '6100')!.id, sortOrder: 0 },
          { description: 'Implementation & onboarding', amount: 600.00, categoryId: chartOfAccounts.find(c => c.code === '6200')!.id, sortOrder: 1 },
        ]},
      },
    }),
    db.bill.create({
      data: {
        id: 'BILL-2043', companyId: company.id, kind: 'expense', vendorId: contacts[7].id, billDate: new Date('2026-06-01'),
        dueDate: new Date('2026-06-15'), terms: 'Net 15',
        subtotal: 3600.00, taxAmount: 0, total: 3600.00, status: 'paid', paidAt: new Date('2026-06-03'), paidAmount: 3600.00,
        paymentAccountId: chaseChecking.id,
        lineItems: { create: [
          { description: 'Office rent — June 2026', amount: 3600.00, categoryId: chartOfAccounts.find(c => c.code === '6300')!.id, sortOrder: 0 },
        ]},
      },
    }),
  ]);

  console.log('  ✓ 2 bills');
  console.log('\n✅ Seed complete — Northwind Trading is ready.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
