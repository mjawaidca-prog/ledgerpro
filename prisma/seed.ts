import { PrismaClient, Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';

const db = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Northwind Trading with full audit trail...\n');

  // ─── Plans ───

  const plans = await Promise.all([
    db.plan.upsert({ where: { id: 'plan_free' }, update: {}, create: { id: 'plan_free', name: 'Free Trial', monthlyPrice: 0, annualPrice: 0, maxUsers: 1, maxCompanies: 1, maxTransactions: 100, maxBankAccounts: 1, csvExport: true, pdfReports: false, bankFeeds: false, customReports: false, prioritySupport: false, whiteLabel: false } }),
    db.plan.upsert({ where: { id: 'plan_basic' }, update: {}, create: { id: 'plan_basic', name: 'Basic', stripePriceId: 'price_basic_monthly', monthlyPrice: 29, annualPrice: 290, maxUsers: 2, maxCompanies: 1, maxTransactions: 1000, maxBankAccounts: 3, csvExport: true, pdfReports: true, bankFeeds: false, customReports: false, prioritySupport: false, whiteLabel: false } }),
    db.plan.upsert({ where: { id: 'plan_pro' }, update: {}, create: { id: 'plan_pro', name: 'Pro', stripePriceId: 'price_pro_monthly', monthlyPrice: 79, annualPrice: 790, maxUsers: 10, maxCompanies: 5, maxTransactions: 10000, maxBankAccounts: 10, csvExport: true, pdfReports: true, bankFeeds: true, customReports: true, prioritySupport: true, whiteLabel: false } }),
    db.plan.upsert({ where: { id: 'plan_enterprise' }, update: {}, create: { id: 'plan_enterprise', name: 'Enterprise', stripePriceId: 'price_enterprise_monthly', monthlyPrice: 199, annualPrice: 1990, maxUsers: 50, maxCompanies: 25, maxTransactions: 100000, maxBankAccounts: 50, csvExport: true, pdfReports: true, bankFeeds: true, customReports: true, prioritySupport: true, whiteLabel: true } }),
  ]);
  console.log(`  ✓ ${plans.length} subscription plans`);

  // ─── User & Company ───

  const passwordHash = await hash('ledgerpro2026', 12);

  // Demo user 1: Rosa at Northwind Trading
  const user = await db.user.upsert({
    where: { email: 'rosa@northwindtrading.com' },
    update: {},
    create: { name: 'Rosa Alvarez', email: 'rosa@northwindtrading.com', passwordHash },
  });
  const company = await db.company.upsert({
    where: { id: 'northwind_main' },
    update: {},
    create: {
      id: 'northwind_main',
      name: 'Northwind Trading', legalName: 'Northwind Trading LLC',
      fiscalYearStart: new Date('2026-01-01'), currency: 'USD',
      locale: 'en-US', timezone: 'America/Edmonton',
    },
  });
  // Create membership instead of owner relation
  await db.membership.upsert({
    where: { userId_companyId: { userId: user.id, companyId: company.id } },
    update: {},
    create: { userId: user.id, companyId: company.id, role: 'owner' },
  });
  // Create trial subscription
  const trialEnd = new Date(); trialEnd.setDate(trialEnd.getDate() + 30);
  const periodEnd = new Date(); periodEnd.setMonth(periodEnd.getMonth() + 1);
  await db.subscription.upsert({
    where: { id: 'sub_northwind' },
    update: {},
    create: { id: 'sub_northwind', companyId: company.id, planId: 'plan_pro', status: 'trialing', trialEndsAt: trialEnd, currentPeriodStart: new Date(), currentPeriodEnd: periodEnd },
  });
  const cid = company.id;
  console.log(`  ✓ User: ${user.email} / password: ledgerpro2026 | Company: ${company.name} (Pro trial)`);

  // Demo user 2: Accountant with multiple companies
  const accountantHash = await hash('demo2026', 12);
  const accountant = await db.user.upsert({
    where: { email: 'accountant@nexvarelab.com' },
    update: {},
    create: { name: 'Alex Morgan', email: 'accountant@nexvarelab.com', passwordHash: accountantHash },
  });
  // Create 2 additional companies for the accountant
  const company2 = await db.company.upsert({
    where: { id: 'atlas_logistics' },
    update: {},
    create: { id: 'atlas_logistics', name: 'Atlas Logistics', fiscalYearStart: new Date('2026-01-01'), currency: 'USD', locale: 'en-US', timezone: 'America/Chicago' },
  });
  const company3 = await db.company.upsert({
    where: { id: 'brightline_studio' },
    update: {},
    create: { id: 'brightline_studio', name: 'Brightline Studio', fiscalYearStart: new Date('2026-01-01'), currency: 'USD', locale: 'en-US', timezone: 'America/Los_Angeles' },
  });
  for (const c of [company, company2, company3]) {
    await db.membership.upsert({
      where: { userId_companyId: { userId: accountant.id, companyId: c.id } },
      update: {},
      create: { userId: accountant.id, companyId: c.id, role: c.id === company.id ? 'bookkeeper' : 'owner' },
    });
  }
  console.log(`  ✓ Accountant: ${accountant.email} / password: demo2026 | 3 companies`);

  // ─── Clear existing data for clean re-seed ───
  await db.journalLine.deleteMany({ where: { journalEntry: { companyId: cid } } });
  await db.journalEntry.deleteMany({ where: { companyId: cid } });
  await db.billLineItem.deleteMany({ where: { bill: { companyId: cid } } });
  await db.bill.deleteMany({ where: { companyId: cid } });
  await db.invoiceLineItem.deleteMany({ where: { invoice: { companyId: cid } } });
  await db.invoice.deleteMany({ where: { companyId: cid } });
  await db.transaction.deleteMany({ where: { companyId: cid } });
  await db.transferMatch.deleteMany({ where: { companyId: cid } });
  await db.importBatch.deleteMany({ where: { companyId: cid } });
  await db.columnMapping.deleteMany({ where: { account: { companyId: cid } } });
  await db.financialAccount.deleteMany({ where: { companyId: cid } });
  await db.contact.deleteMany({ where: { companyId: cid } });
  await db.chartOfAccount.deleteMany({ where: { companyId: cid } });

  // ─── Chart of Accounts (all start at ZERO — journal entries set balances) ───
  console.log('  Creating Chart of Accounts...');

  const coaData = [
    // Assets
    { code: '1000', name: 'Bank Accounts', type: 'asset' as const, detailType: 'Bank', description: 'Cash and bank accounts' },
    { code: '1010', name: 'Chase Business Checking', type: 'asset' as const, detailType: 'Bank', parentCode: '1000', description: 'Primary operating account' },
    { code: '1020', name: 'Chase Business Savings', type: 'asset' as const, detailType: 'Savings', parentCode: '1000', description: 'Interest-bearing reserve' },
    { code: '1100', name: 'Accounts Receivable', type: 'asset' as const, detailType: 'Accounts receivable' },
    { code: '1200', name: 'Prepaid Expenses', type: 'asset' as const, detailType: 'Prepaid expenses' },
    // Liabilities
    { code: '2000', name: 'Credit Cards', type: 'liability' as const, detailType: 'Credit card' },
    { code: '2110', name: 'Amex Business', type: 'liability' as const, detailType: 'Credit card', parentCode: '2000', description: 'Amex Business Gold' },
    { code: '2120', name: 'Chase Ink', type: 'liability' as const, detailType: 'Credit card', parentCode: '2000' },
    { code: '2200', name: 'Accounts Payable', type: 'liability' as const, detailType: 'Accounts payable' },
    { code: '2300', name: 'Sales Tax Payable', type: 'liability' as const, detailType: 'Sales tax payable' },
    // Equity
    { code: '3000', name: "Owner's Capital", type: 'equity' as const, detailType: "Owner's equity" },
    { code: '3100', name: 'Retained Earnings', type: 'equity' as const, detailType: 'Retained earnings' },
    { code: '3900', name: "Owner's Draw", type: 'equity' as const, detailType: "Owner's equity" },
    // Income
    { code: '4000', name: 'Product Sales', type: 'income' as const, detailType: 'Product sales' },
    { code: '4100', name: 'Service Revenue', type: 'income' as const, detailType: 'Service revenue' },
    { code: '4908', name: 'Other Income', type: 'income' as const, detailType: 'Other income' },
    // Expenses
    { code: '5000', name: 'Cost of Goods Sold', type: 'expense' as const, detailType: 'COGS' },
    { code: '6100', name: 'Software & Subscriptions', type: 'expense' as const, detailType: 'Dues & subscriptions' },
    { code: '6200', name: 'Professional Fees', type: 'expense' as const, detailType: 'Professional fees' },
    { code: '6300', name: 'Rent & Lease', type: 'expense' as const, detailType: 'Rent & lease' },
    { code: '6400', name: 'Marketing', type: 'expense' as const, detailType: 'Marketing' },
    { code: '6500', name: 'Travel', type: 'expense' as const, detailType: 'Travel' },
    { code: '6600', name: 'Utilities', type: 'expense' as const, detailType: 'Utilities' },
    { code: '6950', name: 'Legacy Expenses', type: 'expense' as const, detailType: 'Other expense', active: false },
  ];

  const accounts: Record<string, any> = {};
  for (const a of coaData) {
    accounts[a.code] = await db.chartOfAccount.create({
      data: {
        companyId: cid,
        code: a.code,
        name: a.name,
        type: a.type,
        detailType: a.detailType,
        parentCode: a.parentCode,
        description: a.description,
        active: a.active !== false,
        balance: 0, // ALL start at zero
      },
    });
  }
  console.log(`  ✓ ${Object.keys(accounts).length} GL accounts (zero balances)`);

  // ─── Helper: Post journal entry ───
  async function postJE(
    entryDate: Date,
    description: string,
    sourceType: string,
    sourceId: string | null,
    lines: { code: string; description?: string; debit: number; credit: number }[],
  ) {
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.02) {
      throw new Error(`Unbalanced JE "${description}": D=${totalDebit} C=${totalCredit}`);
    }

    const entry = await db.journalEntry.create({
      data: {
        companyId: cid,
        entryDate,
        description,
        sourceType: sourceType as any,
        sourceId,
        lines: {
          create: lines.map((l) => ({
            glAccountCode: l.code,
            description: l.description || null,
            debit: l.debit,
            credit: l.credit,
          })),
        },
      },
    });

    // Update GL balances immediately (inline for seed, same logic as journal.ts)
    for (const l of lines) {
      const acct = accounts[l.code];
      const net = l.debit - l.credit;
      let balanceChange: number;
      if (acct.type === 'asset' || acct.type === 'expense') {
        balanceChange = net;
      } else {
        balanceChange = -net;
      }
      await db.chartOfAccount.update({
        where: { id: acct.id },
        data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
      });
      if (acct.parentCode && accounts[acct.parentCode]) {
        await db.chartOfAccount.update({
          where: { id: accounts[acct.parentCode].id },
          data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
        });
      }
    }
    return entry;
  }

  // ─── Financial Accounts ───
  const [chaseChecking, amexCard] = await Promise.all([
    db.financialAccount.create({
      data: { companyId: cid, name: 'Chase Business Checking', mask: '4021', kind: 'checking', currentBalance: 0, glAccountCode: '1010', displayColor: '#1f6feb', logoInitials: 'CB', syncStatus: 'manual' },
    }),
    db.financialAccount.create({
      data: { companyId: cid, name: 'Amex Business', mask: '1008', kind: 'creditcard', currentBalance: 0, glAccountCode: '2110', displayColor: '#1f6feb', logoInitials: 'AE', syncStatus: 'manual' },
    }),
  ]);

  // ─── Contacts ───
  const contactData = [
    { name: 'Maria Chen', companyName: 'Acme Corp', type: 'customer' as const, email: 'maria@acmecorp.com', phone: '+1 415 555 0101' },
    { name: 'James Okonkwo', companyName: 'Nexus Labs', type: 'customer' as const, email: 'james@nexuslabs.io', phone: '+1 312 555 0142' },
    { name: 'Sarah Mills', companyName: 'Orbit Media', type: 'customer' as const, email: 'sarah@orbitmedia.co', phone: '+1 206 555 0173' },
    { name: 'David Park', companyName: 'Blue Ridge Inc', type: 'customer' as const, email: 'dpark@blueridge.com', phone: '+1 720 555 0194' },
    { name: 'Lisa Nguyen', companyName: 'Cloud Nine LLC', type: 'customer' as const, email: 'lisa@cloudnine.co', phone: '+1 503 555 0128' },
    { name: 'AWS Billing', companyName: 'AWS', type: 'supplier' as const, email: 'billing@aws.amazon.com', phone: null },
    { name: 'Google Workspace', companyName: 'Google', type: 'supplier' as const, email: 'billing@google.com', phone: null },
    { name: 'Office Lease', companyName: 'WeWork', type: 'supplier' as const, email: 'rent@wework.com', phone: '+1 212 555 0200' },
  ];
  const contacts: Record<string, any> = {};
  for (const c of contactData) {
    contacts[c.name] = await db.contact.create({
      data: { companyId: cid, name: c.name, companyName: c.companyName, type: c.type, email: c.email, phone: c.phone, status: 'active' },
    });
  }
  console.log(`  ✓ ${Object.keys(contacts).length} contacts`);

  // ═══════════════════════════════════════════════════════════
  // POST JOURNAL ENTRIES — the source of ALL balances
  // ═══════════════════════════════════════════════════════════

  console.log('\n  📚 Posting journal entries...\n');

  // 1. Opening Balances (as of Jan 1, 2026) — one big entry
  // This sets up the company's starting financial position
  await postJE(
    new Date('2026-01-02'), 'Opening balances — fiscal year 2026',
    'manual', null,
    [
      { code: '1010', description: 'Opening — Chase Checking', debit: 124820.30, credit: 0 },
      { code: '1020', description: 'Opening — Chase Savings', debit: 80091.80, credit: 0 },
      { code: '1100', description: 'Opening — AR', debit: 31200.00, credit: 0 },
      { code: '1200', description: 'Opening — Prepaids', debit: 2400.00, credit: 0 },
      { code: '2110', description: 'Opening — Amex', debit: 0, credit: 8240.13 },
      { code: '2120', description: 'Opening — Chase Ink', debit: 0, credit: 3200.15 },
      { code: '2200', description: 'Opening — AP', debit: 0, credit: 15800.00 },
      { code: '2300', description: 'Opening — Sales Tax', debit: 0, credit: 3120.00 },
      { code: '3000', description: 'Opening — Capital', debit: 0, credit: 120000.00 },
      { code: '3100', description: 'Opening — Retained Earnings', debit: 0, credit: 88151.82 },
    ]
  );
  console.log('    1. Opening balances posted');

  // 2. Q1 Revenue — Product Sales and Service Revenue earned Jan–Apr
  await postJE(new Date('2026-01-31'), 'Revenue — January product sales', 'invoice', null, [
    { code: '1100', debit: 38000.00, credit: 0 },
    { code: '4000', debit: 0, credit: 24000.00 },
    { code: '4100', debit: 0, credit: 14000.00 },
  ]);
  await postJE(new Date('2026-02-28'), 'Revenue — February product sales', 'invoice', null, [
    { code: '1100', debit: 41300.00, credit: 0 },
    { code: '4000', debit: 0, credit: 22100.00 },
    { code: '4100', debit: 0, credit: 19200.00 },
  ]);
  await postJE(new Date('2026-03-31'), 'Revenue — March product sales', 'invoice', null, [
    { code: '1100', debit: 45600.00, credit: 0 },
    { code: '4000', debit: 0, credit: 28600.00 },
    { code: '4100', debit: 0, credit: 17000.00 },
  ]);
  await postJE(new Date('2026-04-30'), 'Revenue — April product sales', 'invoice', null, [
    { code: '1100', debit: 35700.00, credit: 0 },
    { code: '4000', debit: 0, credit: 18100.00 },
    { code: '4100', debit: 0, credit: 17600.00 },
  ]);
  console.log('    2. Q1 Revenue posted (4 months, $160,600)');

  // 3. Customer payments received (reduces AR, increases cash)
  await postJE(new Date('2026-02-15'), 'Payment — customer payments Jan batch', 'payment', null, [
    { code: '1010', description: 'Deposit', debit: 31200.00, credit: 0 },
    { code: '1100', description: 'AR reduction', debit: 0, credit: 31200.00 },
  ]);
  await postJE(new Date('2026-03-20'), 'Payment — customer payments Feb/Mar batch', 'payment', null, [
    { code: '1010', description: 'Deposit', debit: 58000.00, credit: 0 },
    { code: '1100', description: 'AR reduction', debit: 0, credit: 58000.00 },
  ]);
  console.log('    3. Customer payments posted ($89,200)');

  // 4. Q1 Expenses — various categories
  await postJE(new Date('2026-01-25'), 'COGS — inventory purchases Jan', 'bill', null, [
    { code: '5000', debit: 22100.00, credit: 0 },
    { code: '2200', debit: 0, credit: 22100.00 },
  ]);
  await postJE(new Date('2026-02-22'), 'COGS — inventory purchases Feb', 'bill', null, [
    { code: '5000', debit: 25400.00, credit: 0 },
    { code: '2200', debit: 0, credit: 25400.00 },
  ]);
  await postJE(new Date('2026-03-20'), 'COGS — inventory purchases Mar', 'bill', null, [
    { code: '5000', debit: 28900.00, credit: 0 },
    { code: '2200', debit: 0, credit: 28900.00 },
  ]);
  await postJE(new Date('2026-04-22'), 'COGS — inventory purchases Apr', 'bill', null, [
    { code: '5000', debit: 30100.00, credit: 0 },
    { code: '2200', debit: 0, credit: 30100.00 },
  ]);
  await postJE(new Date('2026-01-31'), 'Software subscriptions — Q1', 'bill', null, [
    { code: '6100', debit: 9500.00, credit: 0 },
    { code: '2200', debit: 0, credit: 9500.00 },
  ]);
  await postJE(new Date('2026-02-28'), 'Professional fees — legal review', 'bill', null, [
    { code: '6200', debit: 7200.00, credit: 0 },
    { code: '2200', debit: 0, credit: 7200.00 },
  ]);
  await postJE(new Date('2026-03-15'), 'Rent — office Q1', 'bill', null, [
    { code: '6300', debit: 5400.00, credit: 0 },
    { code: '2200', debit: 0, credit: 5400.00 },
  ]);
  await postJE(new Date('2026-03-31'), 'Marketing — ad spend Q1', 'bill', null, [
    { code: '6400', debit: 4200.00, credit: 0 },
    { code: '2200', debit: 0, credit: 4200.00 },
  ]);
  await postJE(new Date('2026-04-15'), 'Travel — conference', 'bill', null, [
    { code: '6500', debit: 3400.00, credit: 0 },
    { code: '2200', debit: 0, credit: 3400.00 },
  ]);
  await postJE(new Date('2026-04-30'), 'Utilities — Q1', 'bill', null, [
    { code: '6600', debit: 2100.00, credit: 0 },
    { code: '2200', debit: 0, credit: 2100.00 },
  ]);
  console.log('    4. Q1 expenses posted (10 bills)');

  // 5. Vendor payments (reduce AP, reduce cash)
  await postJE(new Date('2026-01-30'), 'Payment — vendor bills Jan', 'payment', null, [
    { code: '2200', debit: 22100.00, credit: 0 },
    { code: '1010', debit: 0, credit: 22100.00 },
  ]);
  await postJE(new Date('2026-02-28'), 'Payment — vendor bills Feb', 'payment', null, [
    { code: '2200', debit: 25400.00, credit: 0 },
    { code: '1010', debit: 0, credit: 25400.00 },
  ]);
  await postJE(new Date('2026-03-31'), 'Payment — vendor bills Mar', 'payment', null, [
    { code: '2200', debit: 42700.00, credit: 0 },
    { code: '1010', debit: 0, credit: 42700.00 },
  ]);
  await postJE(new Date('2026-04-30'), 'Payment — vendor bills Apr', 'payment', null, [
    { code: '2200', debit: 30100.00, credit: 0 },
    { code: '1010', debit: 0, credit: 30100.00 },
  ]);
  console.log('    5. Vendor payments posted ($120,300)');

  // 6. May invoices (the ones we show in the UI)
  const inv1048 = await db.invoice.create({
    data: {
      id: 'INV-1048', companyId: cid, customerId: contacts['Maria Chen'].id,
      issueDate: new Date('2026-05-16'), dueDate: new Date('2026-06-15'),
      terms: 'Net 30', subtotal: 22500.00, taxRate: 8.5, taxAmount: 2000.00, total: 24500.00,
      status: 'sent', sentAt: new Date('2026-05-16'),
      lineItems: { create: [
        { description: 'Website redesign — Phase 2', quantity: 1, unitPrice: 15000.00, amount: 15000.00, sortOrder: 0 },
        { description: 'Content migration', quantity: 1, unitPrice: 7500.00, amount: 7500.00, sortOrder: 1 },
      ]},
    },
  });
  await postJE(new Date('2026-05-16'), 'Invoice INV-1048 — Acme Corp (website redesign)',
    'invoice', 'INV-1048', [
    { code: '1100', debit: 24500.00, credit: 0, description: 'AR for INV-1048' },
    { code: '4100', debit: 0, credit: 22500.00, description: 'Service revenue INV-1048' },
    { code: '2300', debit: 0, credit: 2000.00, description: 'Sales tax INV-1048' },
  ]);

  const inv1047 = await db.invoice.create({
    data: {
      id: 'INV-1047', companyId: cid, customerId: contacts['James Okonkwo'].id,
      issueDate: new Date('2026-05-09'), dueDate: new Date('2026-06-08'),
      terms: 'Net 30', subtotal: 16800.00, taxRate: 8.5, taxAmount: 1400.00, total: 18200.00,
      status: 'overdue',
      lineItems: { create: [
        { description: 'API integration services', quantity: 1, unitPrice: 12000.00, amount: 12000.00, sortOrder: 0 },
        { description: 'QA testing', quantity: 1, unitPrice: 4800.00, amount: 4800.00, sortOrder: 1 },
      ]},
    },
  });
  await postJE(new Date('2026-05-09'), 'Invoice INV-1047 — Nexus Labs (API integration)',
    'invoice', 'INV-1047', [
    { code: '1100', debit: 18200.00, credit: 0, description: 'AR for INV-1047' },
    { code: '4100', debit: 0, credit: 16800.00, description: 'Service revenue INV-1047' },
    { code: '2300', debit: 0, credit: 1400.00, description: 'Sales tax INV-1047' },
  ]);

  const inv1045 = await db.invoice.create({
    data: {
      id: 'INV-1045', companyId: cid, customerId: contacts['Sarah Mills'].id,
      issueDate: new Date('2026-05-23'), dueDate: new Date('2026-06-22'),
      terms: 'Net 30', subtotal: 11200.00, taxRate: 8.5, taxAmount: 900.00, total: 12100.00,
      status: 'sent', sentAt: new Date('2026-05-23'),
      lineItems: { create: [
        { description: 'Brand strategy consultation', quantity: 1, unitPrice: 11200.00, amount: 11200.00, sortOrder: 0 },
      ]},
    },
  });
  await postJE(new Date('2026-05-23'), 'Invoice INV-1045 — Orbit Media (brand strategy)',
    'invoice', 'INV-1045', [
    { code: '1100', debit: 12100.00, credit: 0, description: 'AR for INV-1045' },
    { code: '4100', debit: 0, credit: 11200.00, description: 'Service revenue INV-1045' },
    { code: '2300', debit: 0, credit: 900.00, description: 'Sales tax INV-1045' },
  ]);

  const inv1044 = await db.invoice.create({
    data: {
      id: 'INV-1044', companyId: cid, customerId: contacts['David Park'].id,
      issueDate: new Date('2026-05-01'), dueDate: new Date('2026-06-01'),
      terms: 'Net 30', subtotal: 8700.00, taxRate: 8.5, taxAmount: 720.55, total: 9420.55,
      status: 'paid', paidAt: new Date('2026-05-28'), paidAmount: 9420.55,
      paymentAccountId: chaseChecking.id,
      lineItems: { create: [
        { description: 'Monthly retainer — May', quantity: 1, unitPrice: 8700.00, amount: 8700.00, sortOrder: 0 },
      ]},
    },
  });
  await postJE(new Date('2026-05-01'), 'Invoice INV-1044 — Blue Ridge Inc (monthly retainer)',
    'invoice', 'INV-1044', [
    { code: '1100', debit: 9420.55, credit: 0, description: 'AR for INV-1044' },
    { code: '4100', debit: 0, credit: 8700.00, description: 'Service revenue INV-1044' },
    { code: '2300', debit: 0, credit: 720.55, description: 'Sales tax INV-1044' },
  ]);
  // Payment received for INV-1044
  await postJE(new Date('2026-05-28'), 'Payment INV-1044 — Blue Ridge Inc',
    'payment', 'INV-1044', [
    { code: '1010', debit: 9420.55, credit: 0, description: 'Cash received INV-1044' },
    { code: '1100', debit: 0, credit: 9420.55, description: 'AR reduction INV-1044' },
  ]);
  console.log('    6. May invoices posted (4 invoices: INV-1044, INV-1045, INV-1047, INV-1048)');

  // 7. May bills
  const bill2044 = await db.bill.create({
    data: {
      id: 'BILL-2044', companyId: cid, kind: 'bill', vendorId: contacts['AWS Billing'].id,
      billDate: new Date('2026-05-20'), dueDate: new Date('2026-06-19'), terms: 'Net 30',
      referenceNo: 'AWS-2026-05', subtotal: 1884.30, taxRate: 8.5, taxAmount: 160.17, total: 2044.47,
      status: 'open',
      lineItems: { create: [
        { description: 'AWS cloud hosting — May', amount: 1884.30, sortOrder: 0 },
      ]},
    },
  });
  await postJE(new Date('2026-05-20'), 'Bill BILL-2044 — AWS (cloud hosting)', 'bill', 'BILL-2044', [
    { code: '6100', debit: 1884.30, credit: 0, description: 'AWS cloud hosting' },
    { code: '6100', debit: 160.17, credit: 0, description: 'Sales tax on AWS' },
    { code: '2200', debit: 0, credit: 2044.47, description: 'AP for BILL-2044' },
  ]);

  const bill2043 = await db.bill.create({
    data: {
      id: 'BILL-2043', companyId: cid, kind: 'expense', vendorId: contacts['Office Lease'].id,
      billDate: new Date('2026-06-01'), dueDate: new Date('2026-06-15'), terms: 'Net 15',
      subtotal: 3600.00, taxAmount: 0, total: 3600.00, status: 'paid',
      paidAt: new Date('2026-06-03'), paidAmount: 3600.00, paymentAccountId: chaseChecking.id,
      lineItems: { create: [
        { description: 'Office rent — June 2026', amount: 3600.00, sortOrder: 0 },
      ]},
    },
  });
  await postJE(new Date('2026-06-01'), 'Bill BILL-2043 — WeWork (June rent)', 'bill', 'BILL-2043', [
    { code: '6300', debit: 3600.00, credit: 0, description: 'Office rent June' },
    { code: '2200', debit: 0, credit: 3600.00, description: 'AP for BILL-2043' },
  ]);
  await postJE(new Date('2026-06-03'), 'Payment BILL-2043 — WeWork (June rent)', 'payment', 'BILL-2043', [
    { code: '2200', debit: 3600.00, credit: 0, description: 'AP reduction BILL-2043' },
    { code: '1010', debit: 0, credit: 3600.00, description: 'Cash paid BILL-2043' },
  ]);
  console.log('    7. May/June bills posted (BILL-2043 paid, BILL-2044 open)');

  // 8. Other income
  await postJE(new Date('2026-04-15'), 'Other income — consulting', 'invoice', null, [
    { code: '1100', debit: 5100.00, credit: 0 },
    { code: '4908', debit: 0, credit: 5100.00 },
  ]);
  await postJE(new Date('2026-05-10'), 'Other income — training fees', 'invoice', null, [
    { code: '1100', debit: 3050.00, credit: 0 },
    { code: '4908', debit: 0, credit: 3050.00 },
  ]);
  console.log('    8. Other income posted');

  // 9. Remaining expenses to match original seed balances
  await postJE(new Date('2026-05-05'), 'Software subscriptions — Q2', 'bill', null, [
    { code: '6100', debit: 12855.53, credit: 0 },
    { code: '2200', debit: 0, credit: 12855.53 },
  ]);
  await postJE(new Date('2026-05-12'), 'Professional fees — consulting', 'bill', null, [
    { code: '6200', debit: 9200.00, credit: 0 },
    { code: '2200', debit: 0, credit: 9200.00 },
  ]);
  await postJE(new Date('2026-05-18'), 'Marketing — ad spend Q2', 'bill', null, [
    { code: '6400', debit: 5800.00, credit: 0 },
    { code: '2200', debit: 0, credit: 5800.00 },
  ]);
  await postJE(new Date('2026-05-25'), 'Owner draw — May', 'manual', null, [
    { code: '3900', debit: 6000.00, credit: 0 },
    { code: '1010', debit: 0, credit: 6000.00 },
  ]);
  await postJE(new Date('2026-06-05'), 'Owner draw — June', 'manual', null, [
    { code: '3900', debit: 6000.00, credit: 0 },
    { code: '1010', debit: 0, credit: 6000.00 },
  ]);
  console.log('    9. Q2 expenses and owner draws posted');

  // 10. Update financial account balances
  const chaseBal = Number((await db.chartOfAccount.findUnique({ where: { id: accounts['1010'].id } }))!.balance);
  const amexBal = Number((await db.chartOfAccount.findUnique({ where: { id: accounts['2110'].id } }))!.balance);
  await db.financialAccount.update({ where: { id: chaseChecking.id }, data: { currentBalance: chaseBal } });
  await db.financialAccount.update({ where: { id: amexCard.id }, data: { currentBalance: -amexBal } });
  console.log('   10. Financial account balances synced from GL');

  // ─── Bank transactions (posted to GL as journal entries) ───
  const txnData = [
    { date: new Date('2026-05-12'), description: 'Stripe payout — May', amount: 4820.00, catCode: '4000' },
    { date: new Date('2026-05-11'), description: 'AWS — cloud hosting', amount: -1284.30, catCode: '6100' },
    { date: new Date('2026-05-10'), description: 'Office rent — May', amount: -3500.00, catCode: '6300' },
    { date: new Date('2026-05-09'), description: 'Payment — Vertex Partners', amount: 23110.00, catCode: '4000' },
    { date: new Date('2026-05-07'), description: 'Payroll — bi-weekly', amount: -18400.00, catCode: '6200' },
    { date: new Date('2026-05-05'), description: 'Shopify payout', amount: 2140.55, catCode: '4000' },
    { date: new Date('2026-05-04'), description: 'Staples — office supplies', amount: -142.18, catCode: '6600' },
    { date: new Date('2026-06-01'), description: 'Client payment — Acme Corp', amount: 15000.00, catCode: '4100' },
    { date: new Date('2026-06-02'), description: 'Google Workspace — annual', amount: -720.00, catCode: '6100' },
    { date: new Date('2026-06-03'), description: 'WeWork — June rent', amount: -3600.00, catCode: '6300' },
    { date: new Date('2026-06-05'), description: 'Transfer to savings', amount: -5000.00, catCode: '1020' },
    { date: new Date('2026-06-05'), description: 'Transfer from checking', amount: 5000.00, catCode: '1010' },
  ];

  for (const t of txnData) {
    const isInflow = t.amount > 0;
    const absAmount = Math.abs(t.amount);

    // Create transaction record
    const tx = await db.transaction.create({
      data: {
        companyId: cid,
        financialAccountId: chaseChecking.id,
        date: t.date,
        description: t.description,
        amount: t.amount,
        categoryId: accounts[t.catCode]?.id,
        status: 'categorized',
        source: 'csv',
      },
    });

    // Post to GL immediately
    let entryLines: { code: string; description: string; debit: number; credit: number }[];
    if (isInflow) {
      entryLines = [
        { code: '1010', description: t.description, debit: absAmount, credit: 0 },
        { code: t.catCode, description: `Revenue — ${t.description}`, debit: 0, credit: absAmount },
      ];
    } else {
      entryLines = [
        { code: t.catCode, description: t.description, debit: absAmount, credit: 0 },
        { code: '1010', description: `Payment — ${t.description}`, debit: 0, credit: absAmount },
      ];
    }

    const entry = await db.journalEntry.create({
      data: {
        companyId: cid,
        entryDate: t.date,
        description: t.description,
        sourceType: 'payment',
        sourceId: tx.id,
        lines: { create: entryLines.map((l) => ({ glAccountCode: l.code, description: l.description, debit: l.debit, credit: l.credit })) },
      },
    });

    // Update GL balances
    for (const l of entryLines) {
      const acct = accounts[l.code];
      if (!acct) continue;
      const net = l.debit - l.credit;
      const balanceChange = (acct.type === 'asset' || acct.type === 'expense') ? net : -net;
      await db.chartOfAccount.update({ where: { id: acct.id }, data: { balance: { increment: balanceChange } } });
      if (acct.parentCode && accounts[acct.parentCode]) {
        await db.chartOfAccount.update({ where: { id: accounts[acct.parentCode].id }, data: { balance: { increment: balanceChange } } });
      }
    }

    // Link transaction to GL entry
    await db.transaction.update({ where: { id: tx.id }, data: { status: 'reconciled', matchRef: entry.id } });
  }

  // Sync financial account balances from GL
  const chaseFinalBal = Number((await db.chartOfAccount.findUnique({ where: { id: accounts['1010'].id } }))!.balance);
  const amexFinalBal = Number((await db.chartOfAccount.findUnique({ where: { id: accounts['2110'].id } }))!.balance);
  await db.financialAccount.update({ where: { id: chaseChecking.id }, data: { currentBalance: chaseFinalBal } });
  await db.financialAccount.update({ where: { id: amexCard.id }, data: { currentBalance: -amexFinalBal } });
  console.log(`  ✓ ${txnData.length} bank transactions created and posted to GL`);

  // ─── Final balances report ───
  console.log('\n  📊 Final GL Balances:');
  const finalAccounts = await db.chartOfAccount.findMany({ where: { companyId: cid, active: true }, orderBy: { code: 'asc' } });
  for (const a of finalAccounts) {
    if (Math.abs(Number(a.balance)) > 0.01) {
      console.log(`     ${a.code} ${a.name}: ${Number(a.balance) >= 0 ? '$' : '-$'}${Math.abs(Number(a.balance)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
  }

  // Verify TB balances
  const totalDebit = finalAccounts
    .filter(a => a.type === 'asset' || a.type === 'expense')
    .reduce((s, a) => s + Math.max(0, Number(a.balance)), 0);
  const totalCredit = finalAccounts
    .filter(a => a.type === 'liability' || a.type === 'equity' || a.type === 'income')
    .reduce((s, a) => s + Math.max(0, Number(a.balance)), 0);
  console.log(`\n  ⚖️  Trial Balance check: Debits $${totalDebit.toLocaleString()} ≈ Credits $${totalCredit.toLocaleString()}`);
  console.log(`     (${Math.abs(totalDebit - totalCredit) < 1 ? '✅ BALANCED' : '⚠️ Off by $' + Math.abs(totalDebit - totalCredit).toFixed(2)})`);

  const jeCount = await db.journalEntry.count({ where: { companyId: cid } });
  const jlCount = await db.journalLine.count({ where: { journalEntry: { companyId: cid } } });
  console.log(`\n✅ Seed complete — ${jeCount} journal entries, ${jlCount} journal lines, full audit trail.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
