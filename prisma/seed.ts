import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL!
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding LedgerPro — Northwind Trading FY 2026...')

  // ── Chart of Accounts ──────────────────────────────────────────────
  const coa = await Promise.all([
    // Assets
    prisma.chartOfAccountsEntry.upsert({ where: { code: '1010' }, update: { description: 'Primary operating account' }, create: { code: '1010', name: 'Chase Business Checking', type: 'asset', detailType: 'Checking', description: 'Primary operating account', balance: 98450 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '1020' }, update: { description: 'Corporate charge card' }, create: { code: '1020', name: 'Amex Business Credit Card', type: 'asset', detailType: 'Credit Card', description: 'Corporate charge card', balance: -22340 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '1030' }, update: { description: 'Payment processor clearing' }, create: { code: '1030', name: 'Stripe Payouts Clearing', type: 'asset', detailType: 'Other Current Asset', description: 'Payment processor clearing', balance: 44130 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '1200' }, update: { description: 'Money owed by customers' }, create: { code: '1200', name: 'Accounts Receivable', type: 'asset', detailType: 'Accounts Receivable', description: 'Money owed by customers', balance: 58430 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '1500' }, update: { description: 'Goods held for resale' }, create: { code: '1500', name: 'Inventory Asset', type: 'asset', detailType: 'Inventory', description: 'Goods held for resale', balance: 34200 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '1800' }, update: { description: 'Property & equipment' }, create: { code: '1800', name: 'Fixed Assets', type: 'asset', detailType: 'Fixed Asset', description: 'Property & equipment', balance: 85000 } }),
    // Liabilities
    prisma.chartOfAccountsEntry.upsert({ where: { code: '2000' }, update: { description: 'Money owed to vendors' }, create: { code: '2000', name: 'Accounts Payable', type: 'liability', detailType: 'Accounts Payable', description: 'Money owed to vendors', balance: 18700 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '2100' }, update: { description: 'Sales tax collected' }, create: { code: '2100', name: 'Sales Tax Payable', type: 'liability', detailType: 'Other Current Liability', description: 'Sales tax collected', balance: 3240 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '2200' }, update: { description: 'Withholdings owed' }, create: { code: '2200', name: 'Payroll Liabilities', type: 'liability', detailType: 'Other Current Liability', description: 'Withholdings owed', balance: 9800 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '2500' }, update: { description: 'Term loans & notes' }, create: { code: '2500', name: 'Long-term Debt', type: 'liability', detailType: 'Long Term Liability', description: 'Term loans & notes', balance: 120000 } }),
    // Equity
    prisma.chartOfAccountsEntry.upsert({ where: { code: '3000' }, update: { description: 'Contributed capital' }, create: { code: '3000', name: "Owner's Equity", type: 'equity', detailType: "Owner's Equity", description: 'Contributed capital', balance: 250000 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '3100' }, update: { description: 'Accumulated profits' }, create: { code: '3100', name: 'Retained Earnings', type: 'equity', detailType: 'Retained Earnings', description: 'Accumulated profits', balance: 89000 } }),
    // Income
    prisma.chartOfAccountsEntry.upsert({ where: { code: '4000' }, update: { description: 'Revenue from goods sold' }, create: { code: '4000', name: 'Sales Income', type: 'income', detailType: 'Sales', description: 'Revenue from goods sold', balance: 84210 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '4100' }, update: { description: 'Revenue from services' }, create: { code: '4100', name: 'Service Revenue', type: 'income', detailType: 'Service/Fee Income', description: 'Revenue from services', balance: 22400 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '4200' }, update: { description: 'Miscellaneous income' }, create: { code: '4200', name: 'Other Income', type: 'income', detailType: 'Other Income', description: 'Miscellaneous income', balance: 1800 } }),
    // Expenses
    prisma.chartOfAccountsEntry.upsert({ where: { code: '5000' }, update: { description: 'Direct costs of sales' }, create: { code: '5000', name: 'Cost of Goods Sold', type: 'expense', detailType: 'Supplies & Materials', description: 'Direct costs of sales', balance: 28400 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '6000' }, update: { description: 'Salaries and wages' }, create: { code: '6000', name: 'Payroll Expense', type: 'expense', detailType: 'Wages & Salaries', description: 'Salaries and wages', balance: 36800 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '6100' }, update: { description: 'Office lease' }, create: { code: '6100', name: 'Rent & Lease', type: 'expense', detailType: 'Rent & Lease', description: 'Office lease', balance: 7000 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '6200' }, update: { description: 'SaaS tools' }, create: { code: '6200', name: 'Software & Subscriptions', type: 'expense', detailType: 'Software', description: 'SaaS tools', balance: 2840 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '6300' }, update: { description: 'Office consumables' }, create: { code: '6300', name: 'Office Supplies', type: 'expense', detailType: 'Office Expenses', description: 'Office consumables', balance: 480 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '6400' }, update: { description: 'Campaigns & ads' }, create: { code: '6400', name: 'Marketing & Advertising', type: 'expense', detailType: 'Advertising', description: 'Campaigns & ads', balance: 3200 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '6500' }, update: { description: 'Business travel' }, create: { code: '6500', name: 'Travel & Entertainment', type: 'expense', detailType: 'Travel', description: 'Business travel', balance: 1240 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '6600' }, update: { description: 'Transaction fees' }, create: { code: '6600', name: 'Bank Charges & Fees', type: 'expense', detailType: 'Bank Charges', description: 'Transaction fees', balance: 180 } }),
    prisma.chartOfAccountsEntry.upsert({ where: { code: '6700' }, update: { description: 'Business insurance' }, create: { code: '6700', name: 'Insurance', type: 'expense', detailType: 'Insurance', description: 'Business insurance', balance: 1800 } }),
  ])

  const coaMap: Record<string, { id: string; code: string }> = Object.fromEntries(coa.map((c) => [c.code, c]))

  // ── Bank Accounts ──────────────────────────────────────────────────
  const chaseChecking = await prisma.account.upsert({
    where: { id: 'acc-chase-4021' },
    update: {},
    create: {
      id: 'acc-chase-4021',
      name: 'Chase Business Checking',
      mask: '4021',
      kind: 'checking',
      currentBalance: 98450.00,
      glAccountCode: '1010',
      syncStatus: 'synced',
      lastSyncedAt: new Date('2026-05-12T08:00:00Z'),
      displayColor: '#1f6feb',
      logoInitials: 'CB',
    },
  })

  const amexCard = await prisma.account.upsert({
    where: { id: 'acc-amex-6700' },
    update: {},
    create: {
      id: 'acc-amex-6700',
      name: 'Amex Business',
      mask: '6700',
      kind: 'credit_card',
      currentBalance: -22340.00,
      glAccountCode: '1020',
      syncStatus: 'synced',
      lastSyncedAt: new Date('2026-05-12T08:00:00Z'),
      displayColor: '#1f6feb',
      logoInitials: 'AX',
    },
  })

  const stripePayouts = await prisma.account.upsert({
    where: { id: 'acc-stripe-9230' },
    update: {},
    create: {
      id: 'acc-stripe-9230',
      name: 'Stripe Payouts',
      mask: '9230',
      kind: 'payout_clearing',
      currentBalance: 44130.00,
      glAccountCode: '1030',
      syncStatus: 'synced',
      lastSyncedAt: new Date('2026-05-12T08:00:00Z'),
      displayColor: '#635bff',
      logoInitials: 'SP',
    },
  })

  // ── Contacts ──────────────────────────────────────────────────────
  const atlasLogistics = await prisma.contact.upsert({
    where: { id: 'contact-atlas' },
    update: {},
    create: {
      id: 'contact-atlas',
      name: 'Atlas Logistics',
      company: 'Atlas Logistics LLC',
      type: 'customer',
      email: 'billing@atlaslogistics.com',
      phone: '(415) 555-0142',
      outstandingBalance: 12450.00,
      status: 'active',
    },
  })

  const harborFoods = await prisma.contact.upsert({
    where: { id: 'contact-harbor' },
    update: {},
    create: {
      id: 'contact-harbor',
      name: 'Harbor Foods',
      company: 'Harbor Foods Inc.',
      type: 'customer',
      email: 'ap@harborfoods.com',
      phone: '(312) 555-0198',
      outstandingBalance: 1540.00,
      status: 'active',
    },
  })

  const vertexPartners = await prisma.contact.upsert({
    where: { id: 'contact-vertex' },
    update: {},
    create: {
      id: 'contact-vertex',
      name: 'Vertex Partners',
      company: 'Vertex Partners Group',
      type: 'customer',
      email: 'invoices@vertexpartners.io',
      phone: '(212) 555-0201',
      outstandingBalance: 7300.00,
      status: 'active',
    },
  })

  const brightlineStudio = await prisma.contact.upsert({
    where: { id: 'contact-brightline' },
    update: {},
    create: {
      id: 'contact-brightline',
      name: 'Brightline Studio',
      company: 'Brightline Creative Studio',
      type: 'customer',
      email: 'finance@brightlinestudio.com',
      phone: '(503) 555-0077',
      outstandingBalance: 980.00,
      status: 'active',
    },
  })

  const peakSupply = await prisma.contact.upsert({
    where: { id: 'contact-peak' },
    update: {},
    create: {
      id: 'contact-peak',
      name: 'Peak Supply Co.',
      company: 'Peak Supply Co.',
      type: 'supplier',
      email: 'orders@peaksupply.com',
      phone: '(720) 555-0155',
      outstandingBalance: 4800.00,
      status: 'active',
    },
  })

  const aws = await prisma.contact.upsert({
    where: { id: 'contact-aws' },
    update: {},
    create: {
      id: 'contact-aws',
      name: 'Amazon Web Services',
      company: 'Amazon Web Services, Inc.',
      type: 'supplier',
      email: 'aws-billing@amazon.com',
      outstandingBalance: 0,
      status: 'active',
    },
  })

  // ── Transactions ───────────────────────────────────────────────────
  const txns = [
    { id: 'txn-001', accountId: chaseChecking.id, date: new Date('2026-05-12'), description: 'Stripe payout', merchant: 'Stripe', amount: 4820.00, categoryId: coaMap['4000'].id, status: 'categorized' as const, source: 'feed' as const },
    { id: 'txn-002', accountId: amexCard.id, date: new Date('2026-05-11'), description: 'AWS — cloud hosting', merchant: 'Amazon Web Services', amount: -1284.30, categoryId: coaMap['6200'].id, status: 'categorized' as const, source: 'feed' as const },
    { id: 'txn-003', accountId: chaseChecking.id, date: new Date('2026-05-10'), description: 'Office rent — May', merchant: 'Harbor Properties', amount: -3500.00, categoryId: coaMap['6100'].id, status: 'categorized' as const, source: 'feed' as const },
    { id: 'txn-004', accountId: chaseChecking.id, date: new Date('2026-05-09'), description: 'Payment — Vertex Partners', merchant: 'Vertex Partners', amount: 23110.00, categoryId: coaMap['4000'].id, status: 'categorized' as const, source: 'feed' as const },
    { id: 'txn-005', accountId: chaseChecking.id, date: new Date('2026-05-07'), description: 'Payroll — bi-weekly', merchant: 'ADP Payroll', amount: -18400.00, categoryId: coaMap['6000'].id, status: 'categorized' as const, source: 'feed' as const },
    { id: 'txn-006', accountId: chaseChecking.id, date: new Date('2026-05-05'), description: 'Shopify payout', merchant: 'Shopify', amount: 2140.55, categoryId: coaMap['4000'].id, status: 'categorized' as const, source: 'feed' as const },
    { id: 'txn-007', accountId: amexCard.id, date: new Date('2026-05-04'), description: 'Staples — supplies', merchant: 'Staples', amount: -142.18, categoryId: coaMap['6300'].id, status: 'categorized' as const, source: 'feed' as const },
    { id: 'txn-008', accountId: chaseChecking.id, date: new Date('2026-05-02'), description: 'Atlas Logistics — INV-1048', merchant: 'Atlas Logistics', amount: 18500.00, categoryId: coaMap['4000'].id, status: 'categorized' as const, source: 'feed' as const },
    { id: 'txn-009', accountId: amexCard.id, date: new Date('2026-05-01'), description: 'Google Workspace', merchant: 'Google', amount: -180.00, categoryId: coaMap['6200'].id, status: 'categorized' as const, source: 'feed' as const },
    { id: 'txn-010', accountId: chaseChecking.id, date: new Date('2026-04-28'), description: 'Brightline Studio payment', merchant: 'Brightline Studio', amount: 5200.00, categoryId: coaMap['4100'].id, status: 'categorized' as const, source: 'feed' as const },
    { id: 'txn-011', accountId: amexCard.id, date: new Date('2026-04-25'), description: 'LinkedIn Ads', merchant: 'LinkedIn', amount: -850.00, categoryId: coaMap['6400'].id, status: 'categorized' as const, source: 'feed' as const },
    { id: 'txn-012', accountId: chaseChecking.id, date: new Date('2026-04-22'), description: 'Office rent — April', merchant: 'Harbor Properties', amount: -3500.00, categoryId: coaMap['6100'].id, status: 'categorized' as const, source: 'feed' as const },
  ]

  for (const txn of txns) {
    await prisma.transaction.upsert({ where: { id: txn.id }, update: {}, create: txn })
  }

  // ── Invoices ───────────────────────────────────────────────────────
  const invoices = [
    { id: 'INV-1048', customerId: atlasLogistics.id, issueDate: new Date('2026-04-15'), dueDate: new Date('2026-05-15'), amount: 18500.00, status: 'paid' as const },
    { id: 'INV-1047', customerId: vertexPartners.id, issueDate: new Date('2026-04-10'), dueDate: new Date('2026-05-10'), amount: 23110.00, status: 'paid' as const },
    { id: 'INV-1046', customerId: harborFoods.id, issueDate: new Date('2026-04-08'), dueDate: new Date('2026-05-08'), amount: 4320.00, status: 'paid' as const },
    { id: 'INV-1045', customerId: brightlineStudio.id, issueDate: new Date('2026-04-05'), dueDate: new Date('2026-05-05'), amount: 5200.00, status: 'paid' as const },
    { id: 'INV-1044', customerId: atlasLogistics.id, issueDate: new Date('2026-03-28'), dueDate: new Date('2026-04-28'), amount: 8400.00, status: 'paid' as const },
    { id: 'INV-1043', customerId: vertexPartners.id, issueDate: new Date('2026-03-20'), dueDate: new Date('2026-04-20'), amount: 15600.00, status: 'paid' as const },
    { id: 'INV-1042', customerId: atlasLogistics.id, issueDate: new Date('2026-04-03'), dueDate: new Date('2026-05-03'), amount: 12450.00, status: 'overdue' as const },
    { id: 'INV-1041', customerId: brightlineStudio.id, issueDate: new Date('2026-04-24'), dueDate: new Date('2026-05-24'), amount: 980.00, status: 'sent' as const },
    { id: 'INV-1038', customerId: harborFoods.id, issueDate: new Date('2026-03-28'), dueDate: new Date('2026-04-27'), amount: 1540.00, status: 'overdue' as const },
    { id: 'INV-1037', customerId: vertexPartners.id, issueDate: new Date('2026-04-14'), dueDate: new Date('2026-05-14'), amount: 7300.00, status: 'overdue' as const },
    { id: 'INV-1036', customerId: atlasLogistics.id, issueDate: new Date('2026-05-01'), dueDate: new Date('2026-05-31'), amount: 11200.00, status: 'sent' as const },
    { id: 'INV-1035', customerId: harborFoods.id, issueDate: new Date('2026-05-10'), dueDate: new Date('2026-06-09'), amount: 6275.00, status: 'draft' as const },
  ]

  for (const inv of invoices) {
    const { id, ...data } = inv
    await prisma.invoice.upsert({
      where: { id },
      update: {},
      create: {
        id,
        ...data,
        lines: {
          create: [
            {
              description: 'Professional services',
              qty: 1,
              rate: data.amount,
              taxRate: 0,
              amount: data.amount,
            },
          ],
        },
      },
    })
  }

  // ── Bills ──────────────────────────────────────────────────────────
  const bills = [
    { id: 'BILL-2043', kind: 'bill' as const, vendorId: aws.id, date: new Date('2026-05-01'), categoryId: coaMap['6200'].id, paymentAccountId: amexCard.id, amount: 1284.30, status: 'paid' as const },
    { id: 'BILL-2042', kind: 'expense' as const, payee: 'Staples', date: new Date('2026-05-04'), categoryId: coaMap['6300'].id, paymentAccountId: amexCard.id, amount: 142.18, status: 'paid' as const },
    { id: 'BILL-2041', kind: 'bill' as const, vendorId: peakSupply.id, date: new Date('2026-04-20'), categoryId: coaMap['5000'].id, paymentAccountId: chaseChecking.id, amount: 4800.00, status: 'open' as const },
    { id: 'BILL-2040', kind: 'expense' as const, payee: 'LinkedIn', date: new Date('2026-04-25'), categoryId: coaMap['6400'].id, paymentAccountId: amexCard.id, amount: 850.00, status: 'paid' as const },
    { id: 'BILL-2039', kind: 'expense' as const, payee: 'Harbor Properties', date: new Date('2026-05-01'), categoryId: coaMap['6100'].id, paymentAccountId: chaseChecking.id, amount: 3500.00, status: 'paid' as const },
    { id: 'BILL-2038', kind: 'expense' as const, payee: 'Harbor Properties', date: new Date('2026-04-01'), categoryId: coaMap['6100'].id, paymentAccountId: chaseChecking.id, amount: 3500.00, status: 'paid' as const },
  ]

  for (const bill of bills) {
    await prisma.bill.upsert({ where: { id: bill.id }, update: {}, create: bill })
  }

  // ── Bank feed: items to review / excluded (populate Banking tabs) ──
  const feedTxns = [
    { id: 'txn-101', accountId: stripePayouts.id, date: new Date('2026-05-18'), description: 'Stripe payout',   merchant: 'Stripe',          amount: 4820.00,  suggestedCategoryId: coaMap['4000'].id, status: 'to_review' as const, source: 'feed' as const, matchRef: '2 invoices' },
    { id: 'txn-102', accountId: amexCard.id,      date: new Date('2026-05-17'), description: 'AWS',             merchant: 'Amazon Web Services', amount: -1284.30, suggestedCategoryId: coaMap['6200'].id, status: 'to_review' as const, source: 'feed' as const },
    { id: 'txn-103', accountId: chaseChecking.id, date: new Date('2026-05-16'), description: 'WeWork',          merchant: 'WeWork',          amount: -3500.00, suggestedCategoryId: coaMap['6100'].id, status: 'to_review' as const, source: 'feed' as const },
    { id: 'txn-104', accountId: amexCard.id,      date: new Date('2026-05-15'), description: 'Delta Air Lines', merchant: 'Delta',           amount: -642.40,  suggestedCategoryId: coaMap['6500'].id, status: 'to_review' as const, source: 'feed' as const },
    { id: 'txn-105', accountId: chaseChecking.id, date: new Date('2026-05-14'), description: 'Gusto',           merchant: 'Gusto',           amount: -89.00,   suggestedCategoryId: coaMap['6600'].id, status: 'to_review' as const, source: 'feed' as const },
    { id: 'txn-106', accountId: stripePayouts.id, date: new Date('2026-05-13'), description: 'Shopify payout',  merchant: 'Shopify',         amount: 2140.55,  suggestedCategoryId: coaMap['4000'].id, status: 'to_review' as const, source: 'feed' as const },
    { id: 'txn-107', accountId: amexCard.id,      date: new Date('2026-05-12'), description: 'Staples',         merchant: 'Staples',         amount: -142.18,  suggestedCategoryId: coaMap['6300'].id, status: 'to_review' as const, source: 'feed' as const },
    { id: 'txn-108', accountId: chaseChecking.id, date: new Date('2026-05-11'), description: 'Payment — Vertex Partners', merchant: 'Vertex Partners', amount: 23110.00, suggestedCategoryId: coaMap['4000'].id, status: 'to_review' as const, source: 'feed' as const, matchRef: 'INV-1044' },
    { id: 'txn-201', accountId: chaseChecking.id, date: new Date('2026-05-03'), description: 'Owner transfer → savings', merchant: 'Transfer', amount: -5000.00, status: 'excluded' as const, source: 'feed' as const, excludeReason: 'Transfer' },
    { id: 'txn-202', accountId: stripePayouts.id, date: new Date('2026-05-02'), description: 'Stripe payout (dup)', merchant: 'Stripe',      amount: 4820.00,  status: 'excluded' as const, source: 'feed' as const, excludeReason: 'Duplicate' },
  ]
  for (const txn of feedTxns) {
    await prisma.transaction.upsert({ where: { id: txn.id }, update: {}, create: txn })
  }

  // ── Monthly snapshots (cash-on-hand + income/expense trends) ───────
  const snapshots = [
    { periodKey: '2025-10', label: 'Oct', cashOnHand: 96400,  income: 58400, expenses: 38200 },
    { periodKey: '2025-11', label: 'Nov', cashOnHand: 102300, income: 64900, expenses: 40500 },
    { periodKey: '2025-12', label: 'Dec', cashOnHand: 88100,  income: 61200, expenses: 39800 },
    { periodKey: '2026-01', label: 'Jan', cashOnHand: 109600, income: 72400, expenses: 44100 },
    { periodKey: '2026-02', label: 'Feb', cashOnHand: 118200, income: 69800, expenses: 41200 },
    { periodKey: '2026-03', label: 'Mar', cashOnHand: 112900, income: 78600, expenses: 46900 },
    { periodKey: '2026-04', label: 'Apr', cashOnHand: 131400, income: 80100, expenses: 43400 },
    { periodKey: '2026-05', label: 'May', cashOnHand: 142580, income: 84210, expenses: 41980 },
  ]
  for (const s of snapshots) {
    await prisma.monthlySnapshot.upsert({ where: { periodKey: s.periodKey }, update: s, create: s })
  }

  console.log('Seed complete!')
  console.log(`  ${coa.length} chart of accounts entries`)
  console.log('  3 bank accounts')
  console.log('  6 contacts')
  console.log(`  ${txns.length + feedTxns.length} transactions (${feedTxns.length} bank-feed)`)
  console.log(`  ${invoices.length} invoices`)
  console.log(`  ${bills.length} bills`)
  console.log(`  ${snapshots.length} monthly snapshots`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
