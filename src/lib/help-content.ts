export type HelpSection = {
  heading: string;
  text?: string;
  steps?: string[];
  notes?: string[];
};

export type HelpArticle = {
  slug: string;
  title: string;
  category: string;
  summary: string;
  keywords: string[];
  sections: HelpSection[];
  action?: { label: string; href: string };
};

export const HELP_CATEGORIES = [
  'All topics',
  'Getting started',
  'Sales and expenses',
  'Banking',
  'Accounting controls',
  'Canadian tax',
  'Reporting and groups',
  'Security and support',
] as const;

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'about-ledgerpro',
    title: 'About LedgerPro',
    category: 'Getting started',
    summary: 'Understand LedgerPro’s main workflows, availability labels, and current product boundaries.',
    keywords: ['overview', 'features', 'limitations', 'availability'],
    sections: [
      {
        heading: 'What LedgerPro does',
        text: 'LedgerPro is browser-based double-entry accounting software for Canadian small businesses, bookkeepers, accountants, and related-company groups. It covers company setup, invoicing, bills and expenses, statement imports, reconciliation, journals, budgets, foreign currency, financial reports, Canadian sales-tax workpapers, and multi-company reporting.',
      },
      {
        heading: 'Feature labels',
        notes: [
          'Available means the feature is present when your role, plan, and setup permit it.',
          'Controlled activation means an owner or administrator must complete company-specific setup and approval first.',
          'External step means LedgerPro prepares or records evidence, but filing, payment, or another final action happens outside LedgerPro.',
        ],
      },
    ],
    action: { label: 'Open dashboard', href: '/dashboard' },
  },
  {
    slug: 'company-setup',
    title: 'Set up a company',
    category: 'Getting started',
    summary: 'Create the company profile, choose the fiscal year and currency, and confirm the accounting setup.',
    keywords: ['onboarding', 'profile', 'fiscal year', 'province', 'currency'],
    sections: [
      {
        heading: 'Initial setup',
        steps: [
          'Enter the legal company name and business information.',
          'Choose the province, home currency, fiscal-year start, and fiscal-year end.',
          'Add the applicable GST/HST registration number and other registrations.',
          'Review the chart of accounts and add each bank or credit-card account.',
          'Confirm the active company before entering the first transaction.',
        ],
      },
      {
        heading: 'Important control',
        text: 'Changing the home currency after ledger activity exists is restricted. Advanced Canadian tax treatment and account mappings require reviewed activation.',
      },
    ],
    action: { label: 'Open company settings', href: '/settings' },
  },
  {
    slug: 'navigation-dashboard-search',
    title: 'Navigate the dashboard',
    category: 'Getting started',
    summary: 'Use the dashboard, global search, quick actions, notifications, and company switcher safely.',
    keywords: ['dashboard', 'search', 'notifications', 'switch company', 'quick actions'],
    sections: [
      {
        heading: 'Dashboard and search',
        notes: [
          'Change Month, Quarter, or Year to update the dashboard reporting window.',
          'Use global search to locate invoices, contacts, and transactions.',
          'Dashboard values are navigation summaries; use the general ledger and reconciled reports for final review.',
        ],
      },
      {
        heading: 'Switch companies safely',
        text: 'Use the company switcher and confirm the selected company before creating or approving a transaction. LedgerPro verifies that you are a member of the selected company.',
      },
    ],
    action: { label: 'Open dashboard', href: '/dashboard' },
  },
  {
    slug: 'users-and-roles',
    title: 'Manage users and roles',
    category: 'Getting started',
    summary: 'Invite users and assign Owner, Admin, Bookkeeper, or Viewer access.',
    keywords: ['invite', 'team', 'owner', 'admin', 'bookkeeper', 'viewer', 'permissions'],
    sections: [
      {
        heading: 'Invite a user',
        steps: [
          'Open Company Settings, then Team.',
          'Choose Invite Team Member.',
          'Enter the person’s email and assign the minimum role required.',
          'Confirm the correct person joined before changing another administrator’s access.',
        ],
      },
      {
        heading: 'Access-control practice',
        notes: [
          'Do not share accounts; every user should have an individual login.',
          'Review Owner and Admin access regularly and remove access promptly when duties change.',
          'Use Viewer for people who need reports but should not post transactions.',
        ],
      },
    ],
    action: { label: 'Manage team', href: '/settings/team' },
  },
  {
    slug: 'chart-of-accounts-opening-balances',
    title: 'Chart of accounts and opening balances',
    category: 'Accounting controls',
    summary: 'Organize GL accounts and import a balanced opening trial balance.',
    keywords: ['chart', 'accounts', 'opening balance', 'trial balance', 'conversion', 'migration'],
    sections: [
      {
        heading: 'Prepare the ledger',
        notes: [
          'Keep account codes stable after reports and integrations depend on them.',
          'Use separate recoverable and output tax accounts where reviewed tax reporting requires them.',
          'Link every bank and credit-card account to the correct GL account.',
        ],
      },
      {
        heading: 'Import an opening trial balance',
        steps: [
          'Obtain a final trial balance as of the conversion date.',
          'Open Company Settings and choose Import Opening Trial Balance.',
          'Upload the supported file and map account code, name, type, debit, and credit.',
          'Resolve every invalid or unmapped account.',
          'Confirm total debits equal total credits before posting.',
        ],
      },
    ],
    action: { label: 'Open chart of accounts', href: '/chart-of-accounts' },
  },
  {
    slug: 'contacts',
    title: 'Manage customers and vendors',
    category: 'Sales and expenses',
    summary: 'Create customer, vendor, or combined contacts and review their balances.',
    keywords: ['customer', 'vendor', 'contact', 'balance', 'receivable', 'payable'],
    sections: [
      {
        heading: 'Create a contact',
        steps: [
          'Open Contacts and choose Add Contact.',
          'Select Customer, Vendor, or Combined contact.',
          'Enter the legal or trading name consistently.',
          'Choose the contact currency when foreign-currency documents will be used.',
          'Save and confirm the contact appears under the active company.',
        ],
      },
      {
        heading: 'Correct a balance',
        text: 'Correct the underlying invoice, bill, receipt, payment, or reversal instead of typing over a displayed receivable or payable balance.',
      },
    ],
    action: { label: 'Open contacts', href: '/contacts' },
  },
  {
    slug: 'invoices',
    title: 'Create invoices and record payments',
    category: 'Sales and expenses',
    summary: 'Prepare, post, send, collect, and reverse customer invoices and payments.',
    keywords: ['invoice', 'sales', 'customer', 'payment', 'receipt', 'reverse'],
    sections: [
      {
        heading: 'Create an invoice',
        steps: [
          'Open Sales & Invoices and choose New Invoice.',
          'Select the customer, currency, issue date, due date, and payment terms.',
          'Enter each line’s description, income account, quantity, unit price, and tax code.',
          'Review subtotal, tax, and total, then save or post according to the available workflow.',
        ],
      },
      {
        heading: 'Payments and corrections',
        notes: [
          'Recording a payment relieves accounts receivable and increases the selected bank balance.',
          'Use the payment reversal action for an open-period error so the audit trail is preserved.',
          'Closed-period corrections require an approved current-period adjustment.',
        ],
      },
    ],
    action: { label: 'Open invoices', href: '/invoices' },
  },
  {
    slug: 'bills-and-expenses',
    title: 'Record bills and expenses',
    category: 'Sales and expenses',
    summary: 'Use bills for amounts owed and expenses for purchases paid immediately.',
    keywords: ['bill', 'expense', 'vendor', 'payable', 'purchase', 'payment'],
    sections: [
      {
        heading: 'Choose the correct workflow',
        notes: [
          'Use a Bill when the amount is owed to a vendor and will be paid later.',
          'Use an Expense when payment occurs immediately from a bank or credit-card account.',
        ],
      },
      {
        heading: 'Post a bill',
        steps: [
          'Select or create the vendor.',
          'Enter the bill date, reference, due date, currency, lines, accounts, and tax treatment.',
          'Review supporting evidence and post the bill.',
          'Record payment against the bill when it is paid; do not create a second expense.',
        ],
      },
    ],
    action: { label: 'Open expenses', href: '/expenses' },
  },
  {
    slug: 'bank-statement-import',
    title: 'Import a bank statement',
    category: 'Banking',
    summary: 'Import CSV, OFX, or text-based PDF statements with duplicate and locked-period controls.',
    keywords: ['bank', 'statement', 'csv', 'ofx', 'pdf', 'import', 'duplicate'],
    sections: [
      {
        heading: 'Import workflow',
        steps: [
          'Open Banking and select the correct bank or credit-card account.',
          'Choose Import statement and upload CSV, OFX, or a supported text-based PDF.',
          'Map or confirm date, description, amount, debit, and credit fields.',
          'Review the dry run for new rows, duplicates, locked-period rows, and rule suggestions.',
          'Resolve duplicate decisions deliberately, then commit the import.',
        ],
      },
      {
        heading: 'Source-document control',
        text: 'Scanned image-only PDFs and unusual layouts may not contain reliable transaction text. Compare imported totals and row counts with the original statement before committing.',
      },
    ],
    action: { label: 'Open banking', href: '/banking' },
  },
  {
    slug: 'bank-review-and-matching',
    title: 'Review, match, split, and categorize',
    category: 'Banking',
    summary: 'Match receipts and payments, split rows, record transfers, and use bank rules carefully.',
    keywords: ['match', 'categorize', 'split', 'transfer', 'rules', 'bank review'],
    sections: [
      {
        heading: 'Review each imported row',
        notes: [
          'Match customer receipts to invoices and vendor payments to bills where possible.',
          'Use Split when one statement line belongs to several accounts; the parts must equal the statement amount.',
          'Use transfer matching for movements between your own accounts instead of recording income or expense.',
          'Bank rules suggest classifications; review every suggestion before posting.',
        ],
      },
      {
        heading: 'Reviewed-tax limitation',
        text: 'When reviewed Canadian tax mode is active, do not bypass the supported invoice, bill, or expense workflow with a simple tax-amount classification. Create or match the reviewed source document first.',
      },
    ],
    action: { label: 'Review bank activity', href: '/banking' },
  },
  {
    slug: 'bank-reconciliation',
    title: 'Reconcile financial accounts',
    category: 'Banking',
    summary: 'Compare LedgerPro activity to an external statement and lock the completed reconciliation.',
    keywords: ['reconcile', 'reconciliation', 'ending balance', 'locked', 'statement'],
    sections: [
      {
        heading: 'Complete a reconciliation',
        steps: [
          'Finish importing and reviewing the statement period.',
          'Choose Reconcile for the correct account.',
          'Enter the statement closing date and closing balance.',
          'Mark transactions that appear on the statement and investigate every difference.',
          'Close only when the reconciliation difference is zero.',
        ],
      },
      {
        heading: 'Locked reconciliation',
        text: 'Closing locks rows through the statement date. Reopen through the controlled workflow only when a genuine correction is required; LedgerPro records the reason and action.',
      },
    ],
    action: { label: 'Open banking', href: '/banking' },
  },
  {
    slug: 'journals-recurring-budgets-period-close',
    title: 'Journals, recurring entries, budgets, and period close',
    category: 'Accounting controls',
    summary: 'Use balanced manual entries, schedules, budgets, and close controls responsibly.',
    keywords: ['journal', 'recurring', 'budget', 'close', 'period', 'month end'],
    sections: [
      {
        heading: 'Manual and recurring entries',
        notes: [
          'Use journals for adjustments that do not belong in an invoice, bill, expense, payment, or bank workflow.',
          'Every journal must balance and include a date, reference, description, accounts, debit and credit amounts, and supporting explanation.',
          'Recurring templates create proposed runs. Review contacts, tax, dates, allocations, and fiscal years before posting.',
        ],
      },
      {
        heading: 'Close a period',
        steps: [
          'Complete bank and credit-card reconciliations.',
          'Review receivable, payable, payroll, tax, intercompany, and equity balances.',
          'Post approved accruals, depreciation, allocations, and recurring entries.',
          'Run the trial balance and financial statements, then close the period after approval.',
        ],
      },
    ],
    action: { label: 'Open journals', href: '/journal' },
  },
  {
    slug: 'foreign-currency',
    title: 'Work with foreign currencies',
    category: 'Accounting controls',
    summary: 'Use document exchange rates, settlement gains or losses, revaluation, and consolidation translation.',
    keywords: ['fx', 'foreign currency', 'exchange rate', 'revaluation', 'gain', 'loss'],
    sections: [
      {
        heading: 'Transactions and settlement',
        notes: [
          'Enable only currencies the company actually uses and link foreign-currency bank accounts to the correct GL account.',
          'LedgerPro loads daily Bank of Canada rates and permits dated manual rates.',
          'A document’s rate is frozen when it is posted. Settlement differences are recorded as realized foreign-exchange gains or losses.',
        ],
      },
      {
        heading: 'Month end',
        text: 'Use FX Revaluation to restate eligible foreign-currency monetary balances at the closing rate. Review the proposed unrealized entry and the next-period auto-reversal before posting.',
      },
    ],
    action: { label: 'Open FX rates', href: '/settings/exchange-rates' },
  },
  {
    slug: 'financial-reports',
    title: 'Run financial reports',
    category: 'Reporting and groups',
    summary: 'Review the trial balance, general ledger, financial statements, aging, cash flow, and management reports.',
    keywords: ['reports', 'trial balance', 'general ledger', 'profit loss', 'balance sheet', 'aging'],
    sections: [
      {
        heading: 'Reporting discipline',
        notes: [
          'Confirm the active company, fiscal year, date range, and reporting currency.',
          'Resolve unreconciled bank activity and unclassified tax lines before relying on final figures.',
          'Drill into report amounts and compare them to source documents and the general ledger.',
          'Export or print only after filters and comparative periods are correct.',
        ],
      },
    ],
    action: { label: 'Open reports', href: '/reports' },
  },
  {
    slug: 'canadian-sales-tax',
    title: 'Understand Canadian sales tax',
    category: 'Canadian tax',
    summary: 'Understand controlled GST, HST, QST, PST, and RST treatment and evidence requirements.',
    keywords: ['gst', 'hst', 'qst', 'pst', 'rst', 'itc', 'tax'],
    sections: [
      {
        heading: 'Controlled tax treatment',
        text: 'LedgerPro stores GST, HST, QST, PST, and RST as separate components. The reviewed tax engine uses a controlled activation: company registration, approved registrations, effective dates, delivery evidence, place-of-supply evidence, tax codes, and GL mappings must be reviewed before it is enabled.',
      },
      {
        heading: 'Sales and purchases',
        notes: [
          'A posted sale credits revenue and the applicable output-tax liability while debiting accounts receivable.',
          'A supported purchase debits the expense or asset and recoverable tax while crediting accounts payable or bank.',
          'Nonrecoverable purchase tax remains with the related expense or asset.',
          'Payment settlement clears receivables or payables; it does not record the original sales tax again.',
        ],
      },
    ],
    action: { label: 'Open tax workpapers', href: '/reports/tax-workpapers' },
  },
  {
    slug: 'tax-workpapers-and-filing',
    title: 'Prepare tax workpapers and record filing',
    category: 'Canadian tax',
    summary: 'Prepare, reconcile, review, and record external filing evidence without treating LedgerPro as the filing portal.',
    keywords: ['tax workpaper', 'return', 'filing', 'cra', 'revenu quebec', 'remittance'],
    sections: [
      {
        heading: 'Workpaper workflow',
        steps: [
          'Open Reports, then Tax Workpapers.',
          'Choose the registration and reporting period.',
          'Create the workpaper and resolve every unclassified or unsupported line.',
          'Compare source-document snapshots to control accounts and opening balances.',
          'Review blockers before preparing, reviewing, and approving the workpaper.',
          'After filing outside LedgerPro, record the external confirmation and payment evidence.',
        ],
      },
      {
        heading: 'External filing boundary',
        text: 'LedgerPro does not submit a tax return or payment to CRA, Revenu Québec, or a provincial authority. The user or accountant files and pays through the appropriate authority, then records the evidence in LedgerPro.',
      },
    ],
    action: { label: 'Open tax workpapers', href: '/reports/tax-workpapers' },
  },
  {
    slug: 'accountant-multi-company',
    title: 'Manage multiple companies',
    category: 'Reporting and groups',
    summary: 'Switch among authorized companies and use the accountant dashboard safely.',
    keywords: ['accountant', 'multiple companies', 'client', 'firm', 'dashboard'],
    sections: [
      {
        heading: 'Firm workflow',
        notes: [
          'Each company keeps its own chart of accounts, fiscal year, contacts, transactions, tax setup, and reports.',
          'Always confirm the active company before posting or approving an item.',
          'Use individual memberships rather than shared credentials.',
          'Restrict Owner and Admin roles and remove access promptly when responsibility changes.',
        ],
      },
    ],
    action: { label: 'Open accountant dashboard', href: '/accountant' },
  },
  {
    slug: 'related-parties-and-consolidation',
    title: 'Related parties and consolidation',
    category: 'Reporting and groups',
    summary: 'Record mirrored intercompany activity, reconcile reciprocal balances, and prepare consolidated reports.',
    keywords: ['intercompany', 'related party', 'consolidation', 'elimination', 'due to', 'due from'],
    sections: [
      {
        heading: 'Related-party transactions',
        steps: [
          'Create a relationship between the authorized companies.',
          'Confirm reciprocal Due From and Due To accounts in both charts of accounts.',
          'Post the related-party transaction through the controlled workflow.',
          'Reconcile reciprocal balances and investigate unmatched items.',
        ],
      },
      {
        heading: 'Consolidated reporting',
        text: 'The consolidated report builder combines selected wholly owned companies, translates foreign entities, and can derive intercompany and investment eliminations. Review every drill-down and elimination before relying on the package. Partial-ownership consolidation is not currently supported.',
      },
    ],
    action: { label: 'Open related parties', href: '/intercompany' },
  },
  {
    slug: 'backup-export-and-migration',
    title: 'Backup, export, and migration',
    category: 'Security and support',
    summary: 'Export a portable company backup, restore into a new company, and plan accounting-system conversion.',
    keywords: ['backup', 'restore', 'export', 'migration', 'conversion', 'data portability'],
    sections: [
      {
        heading: 'Company backup',
        text: 'Owners and admins can download a portable JSON company backup from Company Settings. It includes company profile, chart of accounts, contacts, transactions, journals, invoices, bills, budgets, recurring templates, rules, period closes, FX revaluations, and related configuration.',
      },
      {
        heading: 'Restore and migration',
        notes: [
          'Restore creates a new company and does not overwrite the existing company.',
          'Standard conversion imports a chart of accounts and opening trial balance as of an agreed date.',
          'CSV, OFX, or supported PDF statements can provide historical bank activity.',
          'Full source-system transaction history is not automatically converted and requires a scoped conversion plan.',
        ],
      },
    ],
    action: { label: 'Open backup settings', href: '/settings' },
  },
  {
    slug: 'security-and-data-handling',
    title: 'Security and data handling',
    category: 'Security and support',
    summary: 'Learn how authentication, company isolation, authorization, audit history, payments, and portability work.',
    keywords: ['security', 'privacy', 'data', 'canada', 'encryption', 'stripe', 'supabase', 'vercel'],
    sections: [
      {
        heading: 'Application safeguards',
        notes: [
          'LedgerPro is delivered over HTTPS. Passwords are stored as bcrypt hashes rather than plaintext.',
          'Every protected request verifies the signed-in user’s membership in the active company.',
          'Owner, Admin, Bookkeeper, and Viewer roles restrict sensitive changes and accounting actions.',
          'Balanced journals, closed periods, locked reconciliations, tax snapshots, and reversals protect accounting integrity.',
          'Material actions are recorded in the audit log with user, company, time, and available change details.',
          'Stripe-hosted checkout is used for subscription payment details; LedgerPro verifies signed webhook events.',
        ],
      },
      {
        heading: 'Data location and responsibility',
        text: 'The production Supabase project’s selected primary region is Canada Central. Other providers, logs, support records, payment processing, email, backups, and subprocessors may require a broader residency review. Organizations with strict requirements should obtain written confirmation. Users remain responsible for access reviews, exports, source documents, approved accounting decisions, and legally required retention.',
      },
    ],
    action: { label: 'Open audit log', href: '/settings/audit-log' },
  },
  {
    slug: 'troubleshooting-and-controls',
    title: 'Troubleshooting and control checklist',
    category: 'Security and support',
    summary: 'Resolve common posting, bank, payment, workpaper, and reporting issues.',
    keywords: ['troubleshoot', 'error', 'locked', 'cannot post', 'wrong report', 'month end'],
    sections: [
      {
        heading: 'Common checks',
        notes: [
          'Wrong company: use the company switcher and verify the legal entity before entering data.',
          'Transaction will not post: check your role, onboarding status, closed periods, required accounts, dates, evidence, and tax setup.',
          'Bank row is locked: review reconciliation history and reopen only through the controlled action.',
          'Payment cannot be reversed: newer payments support exact reversal; older payments may require accountant review and a controlled correction.',
          'Tax workpaper cannot be reviewed: resolve blockers, unclassified lines, registrations, dates, control accounts, evidence, and reviewer role.',
          'Report looks wrong: confirm company, dates, fiscal year, currency, reconciliations, aging, and general-ledger detail.',
        ],
      },
    ],
  },
  {
    slug: 'product-boundaries-and-faq',
    title: 'Product boundaries and FAQ',
    category: 'Security and support',
    summary: 'Get direct answers about bank feeds, APIs, integrations, payroll, filing, migration, and subscriptions.',
    keywords: ['faq', 'bank feed', 'api', 'bill.com', 'procore', 'payroll', 'pricing', 'trial'],
    sections: [
      {
        heading: 'Not currently available',
        notes: [
          'Direct automatic bank feeds.',
          'A public third-party API with published endpoints and rate limits.',
          'Direct Bill.com, Procore, or comparable integration.',
          'Payroll processing.',
          'Direct CRA, Revenu Québec, or provincial return submission or tax-authority payment initiation.',
          'Automatic conversion of every historical transaction from another accounting system.',
          'Partial-ownership consolidation.',
        ],
      },
      {
        heading: 'Plans and trials',
        text: 'Trial length, plan prices, limits, and offers can change. Use the live Pricing or Billing page as the authoritative commercial source.',
      },
    ],
    action: { label: 'Open billing', href: '/settings/billing' },
  },
  {
    slug: 'glossary',
    title: 'Accounting glossary',
    category: 'Getting started',
    summary: 'Review common LedgerPro and accounting terms used throughout the application.',
    keywords: ['definitions', 'terms', 'glossary', 'accounting'],
    sections: [
      {
        heading: 'Common terms',
        notes: [
          'Accounts receivable: amounts customers owe for posted invoices.',
          'Accounts payable: amounts the company owes vendors for posted bills.',
          'Active company: the company currently selected for viewing and entry.',
          'Audit log: time-stamped record of material actions and available change details.',
          'Closed period: accounting date range protected against ordinary posting changes.',
          'Input tax credit: eligible GST/HST recoverable on supported purchases.',
          'Reconciliation: comparison of LedgerPro activity with an external statement or control schedule.',
          'Tax snapshot: frozen line and component facts stored when a reviewed-tax document posts.',
          'Trial balance: listing of GL balances used to confirm total debits equal total credits.',
          'Workpaper: evidence-backed schedule used to prepare, reconcile, review, and record external filing.',
        ],
      },
    ],
  },
];
