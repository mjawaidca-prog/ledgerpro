import { WALKTHROUGH_ARTICLES } from './help-walkthroughs';

export type HelpImage = {
  src: string;
  alt: string;
  caption?: string;
};

export type HelpSection = {
  heading: string;
  text?: string;
  steps?: string[];
  notes?: string[];
  images?: HelpImage[];
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
  'Developer API',
] as const;

const BASE_HELP_ARTICLES: HelpArticle[] = [
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
    slug: 'payroll-sync-nexvar-pay',
    title: 'Payroll sync with Nexvar Pay',
    category: 'Accounting controls',
    summary: 'Connect Nexvar Pay so every finalized pay run posts its own balanced journal — labelled Payroll — Nexvar Pay — with nothing to re-type.',
    keywords: ['payroll', 'nexvar pay', 'sync', 'pay run', 'wages', 'cpp', 'ei', 'remittance', 'integration'],
    sections: [
      {
        heading: 'What it does',
        text: 'Nexvar Pay is Nexvar Lab’s payroll product: it calculates pay, CPP, EI, and taxes and produces pay stubs and T4s. LedgerPro does not calculate payroll. When the two are connected, finalizing a pay run in Nexvar Pay posts one balanced journal entry here automatically, so the books always match the payroll — no re-typing totals and no year-end reconstruction.',
      },
      {
        heading: 'What posts',
        notes: [
          'One aggregate journal per finalized pay run, dated on the pay date and labelled Payroll — Nexvar Pay in the journal list.',
          'Mode 2 (granular, recommended): wages to 6920 Salaries & Wages, the employer CPP/EI share to 6940 Employer Payroll Taxes, and amounts owed to 2410 CPP Payable, 2420 EI Payable, 2430 Income Tax Payable, and 2440 Wages Payable.',
          'Mode 1 (simple): the whole cost to one payroll expense account and the amounts owed to one or two payables — for charts without the granular payroll accounts.',
          'Only totals cross over. Employee names, SINs, bank details, and pay stubs never leave Nexvar Pay.',
        ],
      },
      {
        heading: 'Connect the two products',
        steps: [
          'Open Payroll in the main menu — it shows this company’s connection status.',
          'In LedgerPro, open Settings → Developer / API and create a key with Read and Write posting permissions (API access must be enabled for the company, and your plan must include it).',
          'In Nexvar Pay, open the matching company → Settings → Integrations, paste the key, and choose the mapping mode.',
          'Use Test Connection — it confirms every mapped account exists and is active in this company’s chart.',
          'Turn on “Sync pay runs to LedgerPro”. From then on, finalized pay runs post here on their own.',
        ],
      },
      {
        heading: 'Reversals and safeguards',
        notes: [
          'The sync is off by default and is switched on per company, in Nexvar Pay.',
          'Reversing or deleting a finalized run in Nexvar Pay posts an equal-and-opposite reversing entry here. Payroll journals cannot be voided from the LedgerPro journal screen — reverse them in Nexvar Pay so the two products stay in sync.',
          'A run dated in a closed or filed period is held back, never forced in; the sync record shows FAILED or BLOCKED with the reason.',
          'Nothing can post twice: every run carries a unique posting key, and a retry after a failure replays safely against it.',
        ],
      },
      {
        heading: 'If a run does not post',
        notes: [
          'Open the pay run in Nexvar Pay and read its sync badge — FAILED shows the cause (for example a revoked key, API access switched off, or an inactive account).',
          'Fix the cause, then press Retry on the run. Retrying is safe and never creates a duplicate entry.',
          'The Payroll page in LedgerPro shows how many runs have posted and when the most recent one landed.',
        ],
      },
    ],
    action: { label: 'Open the Payroll page', href: '/payroll' },
  },
  {
    slug: 'receipt-capture',
    title: 'Receipt capture',
    category: 'Banking',
    summary: 'Photograph or upload a receipt, confirm the merchant, total, and tax it reads, and attach the image to its bank transaction as audit evidence.',
    keywords: ['receipt', 'photo', 'scan', 'ocr', 'capture', 'evidence', 'attach', 'expense receipt'],
    sections: [
      {
        heading: 'How it works',
        steps: [
          'Open Receipts in the main menu and choose Add a receipt — on a phone this opens the camera.',
          'LedgerPro reads the merchant, date, total, and tax, and suggests a category from your categorization and bank rules.',
          'Check the suggested fields and correct anything it misread — nothing is used until you confirm it.',
          'Choose the bank transaction the receipt belongs to and choose Attach & categorize. The transaction is categorized (not posted), and the image stays attached as evidence.',
          'Post the transaction from Banking whenever you are ready, as usual.',
        ],
      },
      {
        heading: 'What to know',
        notes: [
          'JPEG, PNG, WebP, and PDF receipts up to 5 MB. Text-based PDFs (for example emailed receipts) are read most reliably; a photo of a faded thermal receipt may need the fields typed in.',
          'iPhone HEIC photos are not supported yet — set the camera to "Most Compatible" (JPEG) or share the receipt as a PDF.',
          'The total on the receipt is evidence; the amount that categorizes and posts is always the bank transaction amount. If the two differ, the page warns you before you attach.',
          'Tax is split at posting time by the province on the transaction, the same way rule-categorized rows are handled — recoverable GST/HST goes to your input tax credit account and PST stays in the expense.',
          'An attached receipt can be detached back to the inbox, but it cannot be deleted while attached — receipts are audit evidence. Unattached receipts can be deleted from the inbox.',
        ],
      },
    ],
    action: { label: 'Open Receipts', href: '/receipts' },
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
          'A public app marketplace or self-serve developer portal. (The public third-party API itself is available on the Pro and Enterprise plans for integrations — see the Developer API articles — but there is no public developer signup or published rate-limit schedule yet.)',
          'Direct Bill.com, Procore, or comparable integration.',
          'Payroll processing inside LedgerPro — pay is calculated in Nexvar Pay, and its finalized totals post here through the payroll sync (see “Payroll sync with Nexvar Pay”).',
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
  {
    slug: 'developer-api-overview',
    title: 'Developer API overview',
    category: 'Developer API',
    summary: 'What the public API is, what it can do, and how to get started.',
    keywords: ['api', 'developer', 'integration', 'openapi', 'rest'],
    sections: [
      {
        heading: 'What the API is',
        text: 'LedgerPro has a versioned public API at https://ledgerpro.nexvarlab.com/api/v1 for authorized applications and accountants. "Public" means documented access for approved integrations — it never opens customer financial data to unauthenticated callers.',
      },
      {
        heading: 'What it covers',
        notes: [
          'Read-only: company profile, chart of accounts, contacts, invoices, bills, payments, bank transactions, journal entries, approved tax codes, and the five core reports.',
          'Controlled writes: draft documents, reviewed-tax posting, recorded payments, balanced journals, and controlled voids/reversals.',
          'Webhooks: signed notifications (invoice.created/posted, bill.created/updated, payment.recorded, journal.posted).',
        ],
      },
      {
        heading: 'Get started',
        steps: [
          'Make sure the company has an active Pro or Enterprise subscription — production API access is a plan entitlement.',
          'Open Settings → Developer / API Access (owners only).',
          'Enable API access for the company and create a key with the permissions your integration needs.',
          'Copy the secret once — only its SHA-256 hash is stored.',
          'Call https://ledgerpro.nexvarlab.com/api/v1/company with Authorization: Bearer lp_live_… to confirm (the root /api/v1 returns a JSON index).',
          'The full endpoint reference is at /api/v1/openapi.json.',
        ],
      },
    ],
    action: { label: 'Open API settings', href: '/settings/developer' },
  },
  {
    slug: 'developer-api-auth',
    title: 'API authentication and permissions',
    category: 'Developer API',
    summary: 'API keys, permission scopes, expiry, revocation and rate limits.',
    keywords: ['api', 'key', 'bearer', 'permissions', 'rate limit', 'scopes'],
    sections: [
      {
        heading: 'Authentication',
        text: 'Every request authenticates with Authorization: Bearer lp_live_<32 hex chars>. Keys belong to exactly one company — an accountant serving several clients holds separately authorized keys per client. The dashboard session cookie grants nothing on /api/v1.',
      },
      {
        heading: 'Permissions',
        notes: [
          'read — all GET endpoints.',
          'write_draft — create/update contacts; create draft invoices and bills.',
          'write_posting — post documents, record payments, create journals, void and reverse.',
        ],
      },
      {
        heading: 'Rate limits',
        notes: [
          'Default: 120 requests/minute and 5,000/day per key.',
          'Reports: 10 requests/minute and 500/day (stricter class).',
          '429 responses carry retryAfterSeconds. Limits are shared across all server instances.',
        ],
      },
      {
        heading: 'Lifecycle',
        notes: [
          'Production API access requires an active or trialing Pro or Enterprise subscription — other plans are rejected with 403 api_plan_required, and key creation is gated the same way.',
          'Keys expire on their expiry date, and owners can revoke them instantly.',
          'Revoked and expired keys return 401 with codes api_key_revoked / api_key_expired.',
          'The company-level switch and the platform switch disable access immediately without deleting history.',
        ],
      },
    ],
  },
  {
    slug: 'developer-api-pagination',
    title: 'API pagination and change sync',
    category: 'Developer API',
    summary: 'Cursor pagination, the updatedAfter sync filter, and decimal-string money.',
    keywords: ['api', 'pagination', 'cursor', 'sync', 'updatedAfter', 'decimal'],
    sections: [
      {
        heading: 'Pagination',
        text: 'List endpoints are cursor-paginated: limit (default 50, max 100) and cursor. Responses carry pagination: { nextCursor, hasMore }. Pass nextCursor back as cursor to fetch the next page; the cursor is opaque and stable.',
      },
      {
        heading: 'Change sync',
        notes: [
          'updatedAfter (ISO datetime) returns records changed since a point in time.',
          'Append-only posted facts (payments, journal entries) use createdAfter instead.',
          'Voided and reversed records are included with their status/voidedAt so synchronizing clients can mirror them.',
        ],
      },
      {
        heading: 'Money',
        text: 'Financial values are decimal strings ("100.50", tax rates "0.130", FX "1.34567890") with explicit currencies. Never parse them as floats. Reports include meta with reportingPeriod, accountingBasis ("accrual") and generatedAt.',
      },
    ],
  },
  {
    slug: 'developer-api-errors',
    title: 'API error codes',
    category: 'Developer API',
    summary: 'The error envelope and the codes your integration should handle.',
    keywords: ['api', 'errors', 'codes', 'troubleshooting'],
    sections: [
      {
        heading: 'Envelope',
        text: 'Failures return { error: { code, message, fields?, retryAfterSeconds? } }. Build retry logic on code, never on message text.',
      },
      {
        heading: 'Common codes',
        notes: [
          'invalid_api_key — missing, malformed or unknown key (401).',
          'api_key_revoked / api_key_expired — key lifecycle (401).',
          'insufficient_permissions — the key lacks the required scope (403).',
          'api_access_disabled — the company switch is off (403).',
          'api_plan_required — the company has no active Pro/Enterprise subscription (403).',
          'rate_limited — over a limit window; honor retryAfterSeconds (429).',
          'validation_error — field-level problems; see fields (400).',
          'not_found — the id does not exist in this company (404).',
          'idempotency_key_required — writes need an Idempotency-Key header (400).',
          'idempotency_key_conflict — that key was already used for a different payload, company, method or path; retry with a new key (409).',
          'idempotency_legacy_record — that key predates payload verification; inspect the existing result and use a new key (409).',
          'closed_period / document_not_draft / document_not_posted / tax_decision_required / tax_settlement_reversal_required — accounting controls (409).',
        ],
      },
    ],
  },
  {
    slug: 'developer-api-tax-fx',
    title: 'API tax and FX restrictions',
    category: 'Developer API',
    summary: 'The accounting controls the API can never bypass.',
    keywords: ['api', 'tax', 'fx', 'closed period', 'controls'],
    sections: [
      {
        heading: 'Tax',
        text: 'Posting drafts runs the same reviewed-tax engine as the dashboard: company tax configuration must be ready, every line needs a decision referencing an approved tax-code version with jurisdiction evidence, and recovery selections must reference existing reviewed decisions.',
      },
      {
        heading: 'Foreign currency',
        notes: [
          'Foreign-currency drafts must freeze an fxRate at creation; it is never recomputed later.',
          'Payments settle at the document’s frozen rate; settlementRate overrides are validated.',
          'Home-currency documents derive 1.00 — a missing rate is never treated as zero.',
        ],
      },
      {
        heading: 'Periods and journals',
        notes: [
          'Posting, payments and journals are blocked inside closed periods (409).',
          'Journals must balance; every line needs an active GL account from the company.',
          'Voiding a posted document requires no unreversed payments remain.',
        ],
      },
    ],
  },
  {
    slug: 'developer-api-webhooks',
    title: 'API webhooks: verify and dedupe',
    category: 'Developer API',
    summary: 'Signature verification, retries, replay and duplicate handling.',
    keywords: ['api', 'webhooks', 'signature', 'hmac', 'retry', 'replay'],
    sections: [
      {
        heading: 'Verifying a delivery',
        steps: [
          'Concatenate the x-ledgerpro-timestamp header, a dot, and the raw request body.',
          'Compute HMAC-SHA256 with your endpoint secret.',
          'Compare (constant-time) against x-ledgerpro-signature after stripping the sha256= prefix.',
          'Reject deliveries whose signature does not match.',
        ],
      },
      {
        heading: 'Dedupe and retries',
        notes: [
          'Every event has a stable x-ledgerpro-event-id — dedupe on it.',
          'Failed deliveries retry on a fixed ladder (1m → 5m → 30m → 2h → 6h) then stop.',
          'Replays reuse the same event id; successes are never re-sent.',
          'Destinations must resolve to public addresses only — private/internal URLs are rejected.',
        ],
      },
    ],
  },
  {
    slug: 'developer-api-sandbox',
    title: 'API sandbox and pilot',
    category: 'Developer API',
    summary: 'Testing on synthetic data before touching real books.',
    keywords: ['api', 'sandbox', 'test', 'synthetic', 'pilot', 'staging'],
    sections: [
      {
        heading: 'Sandbox',
        notes: [
          'Approved developers receive separate credentials against an isolated environment with synthetic companies (e.g. the P1-F Synthetic Ontario Pilot) and synthetic chart of accounts.',
          'Sandbox keys never authenticate against production data.',
          'The sandbox runs the same reviewed-tax engine and the same controls as production.',
        ],
      },
      {
        heading: 'Pilot',
        notes: [
          'Launch starts with the test company and one accountant pilot before broader access.',
          'Production API access is enforced on Pro and Enterprise plans (403 api_plan_required otherwise); sandbox access is granted to approved developers on any plan.',
          'There is no per-call billing initially; published usage allowances apply.',
        ],
      },
    ],
  },
  {
    slug: 'loans-and-interest',
    title: 'Loans and interest',
    category: 'Accounting controls',
    summary: 'Track term loans and shareholder loans with a real amortization schedule, post each payment’s principal-and-interest split on approval, and see fiscal-year interest totals.',
    keywords: ['loan', 'interest', 'amortization', 'schedule', 'shareholder loan', 'section 15(2)', 'borrowings', 'ford credit'],
    sections: [
      {
        heading: 'Create a loan from whatever the paperwork states',
        steps: [
          'Open Loans and choose New Loan.',
          'Choose the kind: a term loan from a lender, money the company lent a shareholder, or money a shareholder lent the company.',
          'Enter the lender, principal, interest rate, start date, and the accounts the loan maps to.',
          'Use the solve toggle: if the paperwork states the payment (a dealer statement usually does), enter the payment and frequency and LedgerPro works out the term; if it states the rate and term, LedgerPro works out the payment.',
          'Save. The amortization schedule is generated, and the loan gets its own liability account plus the shared Interest Expense account — a loan payment never has to sit in a mixed expense account again.',
        ],
      },
      {
        heading: 'Post a payment',
        steps: [
          'Open the loan and find the payment row in the schedule. A schedule row is a proposal only — nothing has posted yet.',
          'Choose Post. If the actual amount or date differed from the schedule, enter what really happened.',
          'LedgerPro posts one balanced journal: debit loan principal, debit interest expense, credit the bank account.',
          'When the actual amount differed, the unposted remainder of the schedule re-amortizes from the true balance at the same contractual payment.',
          'Use Missed for a skipped payment: the schedule rolls forward one period and the obligation stays visible — it never silently disappears.',
        ],
      },
      {
        heading: 'Prove the balance three ways',
        text: 'The loan page compares three balances: the schedule balance, the general-ledger loan-account balance, and the lender statement balance you enter (with its date). Differences are shown as signed amounts with a ties-out or investigate badge — surfaced, never hidden. The page also shows the current portion: principal due within the next 12 months.',
      },
      {
        heading: 'Shareholder loans',
        notes: [
          'Each advance is recorded separately and never netted silently against another. Every advance carries its own subsection 15(2) deadline: one year after the end of the taxation year in which the advance was made.',
          'Warnings appear at 180, 90, and 30 days before the deadline, and when an advance is overdue.',
          'A repayment followed by a new advance within 90 days is flagged as a series of loans and repayments — it is not treated as a cure.',
          'The subsection 80.4 deemed-interest benefit is estimated from daily balances using the prescribed rate your accountant supplies (it changes quarterly).',
          'The tool warns only — it proposes no clearing journals. The legitimate paths it names are repayment, salary (T4), or dividend (T5).',
        ],
      },
      {
        heading: 'Fiscal-year interest totals',
        text: 'The Loans list and each loan page show interest totals per loan for each fiscal year, sliced on your company’s own year-end, plus a company-wide roll-up — the figure that lands on GIFI 8710 at tax time. A loan’s schedule can also be exported as CSV.',
      },
    ],
    action: { label: 'Open Loans', href: '/loans' },
  },
  {
    slug: 'loan-statement-capture',
    title: 'Import a loan from its statement',
    category: 'Accounting controls',
    summary: 'Photograph or upload a lender statement and let LedgerPro read the balance, payment, and rate — then pre-fill a new loan or check an existing loan’s schedule against it.',
    keywords: ['loan statement', 'import', 'ai read', 'schedule check', 'statement balance', 'lender statement'],
    sections: [
      {
        heading: 'Import from statement',
        steps: [
          'Open Loans and choose Import from statement.',
          'Upload the lender statement — a PDF or a photo (JPEG, PNG, or WebP, up to 5 MB). iPhone HEIC photos are not supported; use the “Most Compatible” camera setting or a PDF.',
          'LedgerPro reads the lender name, statement date, current balance, payment amount, interest rate, and next payment date.',
          'The account number is only ever shown masked beyond its last four digits, and the full number never leaves the statement.',
        ],
      },
      {
        heading: 'Review what was read',
        notes: [
          'Every field carries the reader’s confidence. A field read below 80% confidence is outlined in amber — check those against the paper before you rely on them.',
          'A field the statement does not print stays blank from end to end. It is never inferred or guessed.',
          'One figure is labelled “calculated”: the remaining number of payments, which LedgerPro derives from the balance, payment, and rate. It was not read from the statement, and you confirm the payment frequency in the loan form.',
        ],
      },
      {
        heading: 'Two ways to use the read',
        steps: [
          'New loan: choose the new-loan path and the create form arrives pre-filled from the statement. Confirm the details (including the bank account payments move through) and create the loan.',
          'Existing loan: pick the term loan the statement belongs to and choose Compare. You see the statement balance against the schedule balance at the statement date, with the difference to the cent: Matches to the cent, Small difference (within $5), or Large difference.',
          'To accept the statement, tick the correction and choose Apply. Only unposted schedule rows are rebuilt, re-amortized from the statement balance; posted payments are never touched.',
          'Applying also records the check on the statement itself, so the comparison stays on record.',
        ],
      },
      {
        heading: 'If the read is unavailable',
        text: 'When document reading is not switched on for your deployment, the upload still stores safely and the statement is marked unavailable — no values are invented. Enter the loan manually as usual, and retry the read later from the same statement.',
      },
    ],
    action: { label: 'Import a statement', href: '/loans/import' },
  },
  {
    slug: 'fixed-assets-cca-register',
    title: 'Fixed assets and the CCA register',
    category: 'Accounting controls',
    summary: 'Record each capital asset with its CCA facts at purchase — class, cost net of input tax credits, available-for-use date — and post book depreciation once a year, on approval.',
    keywords: ['fixed assets', 'cca', 'capital cost allowance', 'depreciation', 'ucc', 'aiip', 'asset register', 'class 10'],
    sections: [
      {
        heading: 'Add an asset with its tax facts',
        steps: [
          'Open Fixed Assets and choose New asset.',
          'Describe the asset: description, serial or VIN, vendor, invoice reference, and location.',
          'Pick the CCA class. The picker offers the classes Nexvar Tax models, with plain-language labels and the same rates the tax side uses.',
          'Enter the gross cost, the input tax credit claimed, and any government assistance. The capital cost LedgerPro carries is the net — gross minus ITC minus assistance — because that net figure is what CCA is computed on.',
          'Set the acquisition date and the available-for-use date. Depreciation and CCA both key off the available-for-use date.',
        ],
      },
      {
        heading: 'Flags that matter at tax time',
        notes: [
          'AIIP flag: defaults from the dates (acquired after November 20, 2018 and available for use before 2028) and can be overridden when the property does not qualify.',
          'Would-be-Class-53 flag: Class 43 manufacturing property can carry this flag here, at purchase — so the question never has to be reconstructed at filing time.',
          'Luxury-vehicle flag: a luxury passenger vehicle sits in Class 10.1, separate from the regular Class 10 pool.',
          'Adopting an existing register mid-life: enter the opening accumulated book depreciation and the date it runs to. History is adopted as stated, not re-derived.',
        ],
      },
      {
        heading: 'Book depreciation — once a year, on approval',
        text: 'LedgerPro computes a per-asset book depreciation schedule on your fiscal calendar. The default method mirrors the tax method (class rate, declining balance, half-year rule and accelerated first-year factors), and each asset can instead use straight-line over a life you set, its own declining rate, or no depreciation. Book depreciation is not the CCA deduction — the tax claim is computed in Nexvar Tax from the exported facts.',
        steps: [
          'On the Fixed Assets page, review the year’s depreciation preview.',
          'Choose Approve & post. One balanced journal posts (depreciation or amortization expense against accumulated depreciation), once per fiscal year — a year cannot be posted twice.',
        ],
      },
      {
        heading: 'Disposals and the Nexvar Tax export',
        notes: [
          'Record a disposal with its proceeds, date, and reason. The book gain or loss (proceeds minus net book value) is computed and shown; the disposal record itself never posts a journal.',
          'An asset taken over by a shareholder carries a warning instead of silence: proceeds are deemed to be at fair market value.',
          'Download the CCA register export (cca-register/1) from the Fixed Assets page. It carries each class’s capital-cost continuity, additions with their AIIP and Class 53 flags, disposals, and the book position — the feed for Nexvar Tax’s Schedule 8.',
        ],
      },
    ],
    action: { label: 'Open Fixed Assets', href: '/fixed-assets' },
  },
  {
    slug: 'cca-write-back',
    title: 'CCA write-back from Nexvar Tax',
    category: 'Canadian tax',
    summary: 'After the T2 is filed in Nexvar Tax, import the filed CCA figures back into LedgerPro so next year’s register opens from what was actually filed — and approve the proposed Schedule 1 journal.',
    keywords: ['write-back', 'cca', 'ucc', 'filed', 'schedule 1', 'nexvar tax', 'closing ucc'],
    sections: [
      {
        heading: 'Import the filed figures',
        steps: [
          'In Nexvar Tax, produce the cca-writeback/1 file for the filed return.',
          'In LedgerPro, open Fixed Assets and find the “Nexvar Tax write-back — filed CCA & UCC” card.',
          'Paste the payload or choose the file, then choose Import write-back.',
          'Before storing anything, LedgerPro verifies the file’s integrity hash and checks it three ways: this company, this business number, and an exact fiscal year of this company.',
        ],
      },
      {
        heading: 'What the import changes',
        notes: [
          'The register’s export now reports the CCA claimed for the filed year, and each class opens the next year at its filed closing UCC. Until a write-back arrives, those fields stay empty — LedgerPro keeps no shadow UCC of its own.',
          'An amended return is a real event: import the new file and both versions stay on record, with every effect flowing from the latest.',
          'Importing the byte-identical file a second time is refused as a duplicate.',
        ],
      },
      {
        heading: 'Read the variance view',
        text: 'For each class, the filed closing UCC is compared with the closing UCC the register expected, projected from the filed opening plus the register’s own facts for the year. When the difference is exactly the claim difference, the view says the claim differed — that is arithmetic, not a guess. Assets or disposals recorded after filing are named as the cause when the dates support it; anything else is labelled unexplained and points you to a Schedule 8 comparison. The first filed year establishes the baseline, so it shows no variance.',
      },
      {
        heading: 'Approve the proposed journal',
        steps: [
          'If the write-back carries Schedule 1 adjustment lines, the card shows a proposed year-end journal built from them, through accumulated depreciation and the depreciation expense account.',
          'Review the lines, then choose Approve & post. Nothing posts before that approval.',
          'Posting into a closed period is blocked, with the period named. A superseded version’s proposal can never be posted.',
          'A write-back with no Schedule 1 lines proposes no journal — and the card says so plainly. The filed figures still land and feed the export.',
        ],
      },
    ],
    action: { label: 'Open Fixed Assets', href: '/fixed-assets' },
  },
  {
    slug: 'calculator',
    title: 'The built-in calculator',
    category: 'Getting started',
    summary: 'A desk calculator that floats over any screen — with a running tape, percent, and +Tax / −Tax keys set to your company’s sales-tax rate.',
    keywords: ['calculator', 'tape', 'tax key', 'percent', 'quick calc'],
    sections: [
      {
        heading: 'Open it anywhere',
        text: 'Choose Calculator in the left rail footer. The panel floats at the bottom-right of the screen with no backdrop and no navigation — the page underneath stays fully usable while it is open. It stays mounted as you move between screens, and its tape survives opening and closing within your session.',
      },
      {
        heading: 'How it calculates',
        notes: [
          'Chained operations run strictly left to right, like a desk calculator: 2 + 3 × 4 = 20. There is no operator precedence.',
          'Arithmetic is exact decimal math: 0.1 + 0.2 is exactly 0.3, and division by zero or an out-of-range result shows an Error state instead of a wrong number.',
          'Percent follows classic calculator behaviour: with + or − pending it takes that percentage of the running total (200 + 10 % = 220); with × or ÷ pending, or on its own, it divides by 100.',
          'The full keyboard works while the panel is open: digits, + − * /, Enter or = for equals, Backspace, Delete for clear-entry, %, and Esc to close. Keystrokes are ignored while you are typing in a page field, so forms keep their input.',
          'AC clears the calculation but deliberately keeps the tape; CE clears just the entry in progress, mid-chain included.',
        ],
      },
      {
        heading: '+Tax and −Tax',
        notes: [
          '+Tax adds sales tax to the displayed amount; −Tax backs it out. The tax rounds to the cent, the way an invoice rounds it, so adding then removing tax returns the exact starting figure.',
          'The rate defaults to your active company’s province rate, labelled on the panel (for example, “Company province: 13% HST · Ontario”). Switching companies re-derives the default.',
          'Presets cover 5% GST and 13%, 15%, and 14% HST, or enter a custom rate — a combined rate such as 14.975% works. A rate you choose yourself is remembered on this device.',
        ],
      },
      {
        heading: 'The tape',
        notes: [
          'Every completed calculation appends a line — the expression and its result — up to 50 entries.',
          'Click any tape result to recall it as the current entry.',
          'Use the copy button beside the display to copy the current value, and Clear tape to empty the tape.',
        ],
      },
    ],
  },
  {
    slug: 'gst-hst-worksheet',
    title: 'The GST/HST worksheet and NETFILE hand-off',
    category: 'Canadian tax',
    summary: 'Read every line of the GST34 (101–115) with its composition, reconcile the return against your books, and hand the four NETFILE numbers to CRA.',
    keywords: ['gst', 'hst', 'worksheet', 'netfile', 'line 101', 'line 109', 'line 115', 'reconciliation', 'confirmation number'],
    sections: [
      {
        heading: 'Every line, with its workings',
        steps: [
          'Open Reports, then GST/HST Return, and compute the period.',
          'All fourteen lines (101, 103–115) are shown. Nil lines are shown as nil, never hidden.',
          'Expand any line to see what it is made of: lines 101, 103, and 106 break down by account, with the underlying transactions; adjustment lines (104, 107, 110, 111) list their items; calculated lines (105, 108, 109, 112–115) show their formula over the other lines.',
        ],
      },
      {
        heading: 'Reconcile before you file',
        text: 'The Reconciliation card checks the differences CRA auditors ask about first. Each check carries a Pass, Review, or Difference badge with its figures shown — a difference is displayed, never absorbed into the numbers.',
        notes: [
          'Line 101 vs GL revenue accounts: passes when the only difference is whole-dollar rounding (within 50¢).',
          'Control-account continuity for GST/HST payable: opening balance plus line 103, against the ledger balance at period end.',
          'The same continuity for the recoverable (ITC) account against line 106.',
          'Lines 103 and 106 vs the document-level tax engine: a difference here is a warning rather than a failure — tax-point dates and journal dates can legitimately differ — and a period with no document detail is reported as not corroborated instead of silently passing.',
          'Return arithmetic: every calculated line is re-derived from its inputs.',
        ],
      },
      {
        heading: 'The NETFILE hand-off',
        steps: [
          'NETFILE is a four-number return: your access code plus lines 101, 109, and 114 (refund) or 115 (owing). The hand-off card shows exactly those numbers, with your registration number and period.',
          'Your access code is yours — LedgerPro shows a slot for it but never stores it.',
          'File on CRA’s site yourself. LedgerPro prepares and records the return; it does not submit it.',
          'Back in LedgerPro, record the filing. The CRA confirmation number and filing date are stored on the period, shown on the hand-off card, and the period locks.',
          'Download the audit package (the gst-worksheet/1 JSON, beside the CSV working copy) when an accountant or a CRA review asks where a number came from — it carries every line’s composition, the continuity, and the reconciliation results.',
        ],
      },
    ],
    action: { label: 'Open the GST/HST return', href: '/reports/gst-hst-return' },
  },
  {
    slug: 'year-end-package',
    title: 'The year-end package',
    category: 'Reporting and groups',
    summary: 'Run nine pre-flight checks on a cover sheet, then download one hash-stamped bundle — trial balance, CCA register, loan schedules, GST worksheets — for your accountant or Nexvar Tax.',
    keywords: ['year-end', 'package', 'pre-flight', 'cover sheet', 'accountant', 'bundle', 'close'],
    sections: [
      {
        heading: 'Run the pre-flight',
        steps: [
          'Open Reports, then Year-End Package.',
          'Pick a date — the package covers the fiscal year containing that date.',
          'Choose Run pre-flight and read the cover sheet.',
          'Every check reports Pass, Warn, Block, or Not checked. A check that cannot be run says so, with the reason — nothing is skipped silently.',
        ],
      },
      {
        heading: 'What the nine checks look for',
        notes: [
          'Trial balance balances. Out of balance blocks, with the difference named.',
          'Every account carries a GIFI decision. Undecided accounts are named with their balances as a warning — they export unmapped for mapping review; they do not block.',
          'Suspense and clearing accounts at zero. A non-zero balance blocks: that is a books problem, not a mapping problem.',
          'The fiscal year is closed, with no entries dated inside it that were posted after the close.',
          'Loans tie to the ledger — schedule vs ledger and schedule vs statement differences warn, unposted due payments warn, and shareholder-loan deadlines within 12 months are named.',
          'Asset-register tax facts are complete. An asset carrying a CCA class Nexvar Tax does not model blocks, because its Schedule 8 feed would be wrong.',
          'GST/HST periods due by year-end have a filing recorded, with the CRA confirmation. With no GST/HST registration on file this check is Not checked — filing periods belong to the registration.',
          'Bank accounts are reconciled through year-end. With no bank or credit accounts set up, this check is Not checked.',
          'Payroll T4 / PD7A tie-out is always Not checked: the T4 summary and remittance records live in Nexvar Pay. The cover sheet states that rather than implying the tie-out was verified.',
        ],
      },
      {
        heading: 'Download the bundle',
        steps: [
          'Choose Download package.',
          'With any Block, a confirmation names the blocking checks and says the books should be corrected first. The bundle is still generated if you proceed — the cover sheet inside it prints the blocks.',
          'Inside the bundle: the trial balance with the prior year’s own figures as the comparative, a general-ledger detail summary, the CCA register, loan schedules with fiscal-year interest, one GST worksheet per filing period in the year, and the payroll journals Nexvar Pay posted into these books (or an explicit note of what to bring from Nexvar Pay when there are none).',
          'The bundle (year-end-package/1) is hash-stamped. The SHA-256 shown on the page is the fingerprint the receiving side verifies.',
        ],
      },
    ],
    action: { label: 'Open the year-end package', href: '/reports/year-end-package' },
  },
  {
    slug: 'ai-categorization',
    title: 'AI categorization on bank import',
    category: 'Banking',
    summary: 'Imported rows the rules leave behind arrive with a suggested category, a confidence, and a plain-language reason — you confirm or correct, and LedgerPro learns from the correction.',
    keywords: ['ai', 'categorization', 'suggestion', 'confidence', 'bank import', 'review queue', 'bulk confirm'],
    sections: [
      {
        heading: 'Where suggestions come from',
        text: 'Suggestions are layered, most-trusted first, and each one names its source:',
        notes: [
          'Your bank rules, then your categorization rules. A rule match names the rule that fired.',
          'Your own history: how you have coded this payee before, in this direction — “You coded all 14 past payments to ‘Shell’ as Vehicle Fuel.” A payee you have coded inconsistently gets no history suggestion; mixed history teaches nothing.',
          'For payees nothing else can place, an AI suggestion may appear when the AI layer is enabled on your deployment. It chooses only from your own accounts, and it is shown as an AI suggestion, never disguised as a rule.',
        ],
      },
      {
        heading: 'Confirm, correct, or bulk-confirm',
        steps: [
          'Open the Banking review queue. A row with a suggestion shows “AI suggests …” with its confidence.',
          'Open the row. The suggestion card shows the source (From your rules / From your history / AI suggestion), the confidence, and the reason.',
          'Choose Confirm suggestion to categorize with it. Categorizing is not posting — posting stays the separate, existing step.',
          'To correct it, pick a different category instead. The correction is recorded, and the history layer learns from the final category you chose.',
          'When several rows carry high-confidence suggestions from your rules or history, a Confirm all bar appears. It confirms only those rows. An AI suggestion joins the bulk set only after you have accepted that same payee-and-account pattern individually before.',
        ],
      },
      {
        heading: 'What it never does',
        notes: [
          'Nothing is categorized silently, and nothing posts without your existing confirmation flow.',
          'A suggestion is a proposal with its reasoning shown. The confidence is there so you can judge how hard to look before confirming.',
        ],
      },
    ],
    action: { label: 'Open Banking', href: '/banking' },
  },
  {
    slug: 'receipt-reading-draft-bills',
    title: 'Receipt reading and draft expenses',
    category: 'Sales and expenses',
    summary: 'Uploaded receipts are read automatically — vendor, date, tax, and total, each with a confidence — and one click turns a read receipt into a draft expense for review.',
    keywords: ['receipt', 'ai read', 'draft expense', 'bill', 'confidence', 'extract', 'ocr'],
    sections: [
      {
        heading: 'What the read gives you',
        notes: [
          'After upload, the receipt is read and the inbox shows an “AI read” badge — or “AI read failed”, with a Retry AI read action.',
          'Vendor, date, subtotal, tax, total, currency, and line items are filled in, each carrying the reader’s own confidence.',
          'Any field read below 80% confidence is outlined in amber with a “check” hint. Look at those against the paper before relying on them.',
          'A field the receipt does not show is left blank, never invented.',
          'If the read is marked unavailable, document reading is not switched on for your deployment: nothing was read and nothing was guessed. The receipt works exactly as it did before — type the fields in, then attach it or expense it manually.',
        ],
      },
      {
        heading: 'Create the draft expense',
        steps: [
          'Open the read receipt and choose Create draft expense.',
          'LedgerPro builds a draft expense (an EXP-#### bill) in Expenses: the vendor — found, or created as a supplier — the date, and lines that balance to the cent.',
          'The tax split rides along: recoverable GST/HST is separated so that, when you post, it lands in your input tax credit account rather than inside the cost.',
          'The receipt stays linked to the draft from both sides as its source document — the audit trail behind the entry.',
          'Open the draft in Expenses, set or adjust the expense account, and post it through the normal bills flow. Creating the draft posts nothing.',
        ],
      },
      {
        heading: 'Where the category comes from',
        text: 'The draft takes the category your rules suggest for that merchant. If no rule fires, it falls back to the category you most recently used for that vendor’s bank transactions, labelled as coming from history. Either way, you confirm the account in the draft before posting.',
      },
    ],
    action: { label: 'Open Receipts', href: '/receipts' },
  },
  {
    slug: 'gifi-coding',
    title: 'GIFI coding: every account gets a decision',
    category: 'Canadian tax',
    summary: 'No account saves without a GIFI decision — a suggested code with its reason, your own pick, or a recorded choice to leave it unmapped — and a worklist keeps undecided accounts visible.',
    keywords: ['gifi', 't2', 'chart of accounts', 'mapping', 'readiness', 'worklist', 'unmapped'],
    sections: [
      {
        heading: 'The decision at account creation',
        steps: [
          'Create or edit an account on the Chart of Accounts page.',
          'The suggestion banner shows the top suggested code with its CRA description and a plain-language reason. Choose Use to accept it in one tap.',
          'Open “Other suggestions” to see the runners-up, each with its own reason and Use button — or search the full catalogue in the picker.',
          'If no code honestly fits yet, tick “Leave unmapped — I’ll code it later.” The choice is recorded on the account.',
          'Save stays disabled until one of those decisions exists. A silently blank code is no longer possible.',
        ],
      },
      {
        heading: 'Suggestions that learn',
        notes: [
          'Ranking starts from the chart template and keyword rules, then learns from your saves: when you keep choosing a different code for similar account names, the suggestion re-ranks and says why — “You usually code these as 2621 here.”',
          'Precise codes beat general ones: Holdbacks Payable is suggested its exact code, not the general payables code it used to get.',
          'A few accounts stay uncoded by design — Retained Earnings, Opening Balance Equity, Owner’s Capital, and Owner’s Draw. The form says so instead of demanding a decision, though you may still assign a code voluntarily.',
          'An account whose name mixes a payment with a borrowing (for example, “Motor Vehicle — Ford Credit Payments”) gets a notice instead of a confident suggestion: one payment mixes principal and interest, which take different codes. The clean fix is the Loan tool, or splitting the account.',
        ],
      },
      {
        heading: 'The readiness worklist',
        steps: [
          'On the Chart of Accounts page, open the GIFI readiness panel. It shows “X of Y coded” and how many accounts still need a GIFI decision.',
          'Work through the rows: apply the suggested code, pick another, or use the row’s Leave unmapped action. The choice is recorded the same way as in the account form, and worklist choices teach the suggestions too.',
          'Accounts left unmapped by choice are counted separately and leave the worklist.',
          'An undecided account still exports to Nexvar Tax as unmapped — never dropped, never given a guessed code — and lands in mapping review there.',
        ],
      },
    ],
    action: { label: 'Open chart of accounts', href: '/chart-of-accounts' },
  },
  {
    slug: 'industry-chart-templates',
    title: 'Industry chart templates and industry suggestions',
    category: 'Getting started',
    summary: 'A new company starts with the standard chart plus a pack of accounts for its industry — every pack account born GIFI-coded — and LedgerPro can suggest a better-fitting pack later, from your real activity.',
    keywords: ['industry', 'template', 'chart of accounts', 'onboarding', 'pack', 'construction', 'trucking', 'farming'],
    sections: [
      {
        heading: 'One chart, plus a pack',
        text: 'Every company starts from the same standard Canadian chart of accounts. During setup, the question “Industry — what does this business mainly do?” adds a pack of the accounts that industry actually needs: construction gets holdbacks receivable and holdbacks payable, real-estate rental gets rental revenue front and centre, farming gets the crop, livestock, and program-payment accounts, and a holding company gets the split between Canadian and foreign dividends. Every pack account arrives already GIFI-coded. Choosing “Something else / general” adds nothing — the standard chart on its own.',
      },
      {
        heading: 'Changing or adding an industry later',
        notes: [
          'Setting an industry on an existing company layers the pack onto its chart. Accounts are added, never removed, and applying the same pack twice adds nothing twice.',
          'Clearing the industry removes nothing either. Once an account exists, it is part of the company’s history.',
          'Existing companies are never retro-fitted silently — a pack is offered and applied, never imposed.',
        ],
      },
      {
        heading: 'Industry suggestions',
        steps: [
          'After real activity builds up, the dashboard may show a card: “Your books look like a … business”, with up to three pieces of evidence in plain language — for example, that rent is 99% of income, or that fuel purchases are a large share of expenses.',
          'Choose Add the pack to apply it through the same layering, or Dismiss the suggestion.',
          'A suggestion is never applied automatically.',
          'Dismissing one industry does not suppress a different suggestion later, if your books change enough to point somewhere else.',
          'No card appears when the evidence is thin, or when two industries score too closely — a close race suggests nothing.',
        ],
      },
    ],
    action: { label: 'Open dashboard', href: '/dashboard' },
  },
  {
    slug: 'books-health',
    title: 'Books Health: the anomaly and duplicate radar',
    category: 'Reporting and groups',
    summary: 'A checklist that reads your books the way a reviewer would — duplicate payments, outliers, stale coding, unreconciled accounts, loan proofs, and filing gaps — every flag naming its evidence.',
    keywords: ['books health', 'anomaly', 'duplicate', 'outlier', 'radar', 'checklist', 'dismiss'],
    sections: [
      {
        heading: 'The three groups',
        text: 'Open Reports, then Books Health. Findings are grouped as Needs attention, Worth a look, and Healthy. Every check reports in one of the three, so a clean result is stated outright — not just implied by the absence of flags. A fourth section, Dismissed, keeps what you have set aside, together with your reasons.',
      },
      {
        heading: 'What it watches',
        notes: [
          'Duplicate payments: the same payee and amount within five days (five, so a fixed weekly payment never flags itself), and identical journal lines appearing in different entries.',
          'Payments out of their usual range: at least three times a payee’s typical amount, and at least $500.',
          'Round-number clusters: three or more payments of $500 or more, in exact $100 multiples, to one payee.',
          'GIFI decisions outstanding, ranked by dollar volume so the biggest gap is worked first.',
          'Bank rows still uncategorized after 14 days, shown as one aggregate with the count, total, and oldest items.',
          'Suspense and clearing accounts that are not at zero.',
          'Bank accounts reconciled long ago — or never.',
          'Loan balances that do not tie three ways (schedule, ledger, statement), and shareholder-loan deadlines inside 90 days.',
          'GST/HST periods that have ended with no filing recorded.',
        ],
      },
      {
        heading: 'Dismissals that stick — precisely',
        steps: [
          'Open a flag and read its figures and drill-down items. Follow Review to reach the source records when the flag needs work.',
          'To set a flag aside, dismiss it with a reason. The reason stays on record.',
          'A dismissal silences exactly that item: dismiss “these two Telus payments are both real” and that pair never returns — but a new duplicate pair, or the same suspense account at a different balance, comes back as a new flag.',
          'Restore a dismissal from the Dismissed section at any time.',
        ],
      },
    ],
    action: { label: 'Open Books Health', href: '/reports/books-health' },
  },
  {
    slug: 'reconciliation-assistant',
    title: 'The reconciliation assistant',
    category: 'Banking',
    summary: 'For each unreconciled bank row, the assistant proposes what it matches — one document, an exact-sum split, a document plus a remainder, or an existing journal entry — with a confidence and its reasons. You confirm; nothing auto-clears.',
    keywords: ['reconciliation', 'assistant', 'match', 'proposal', 'split', 'bank review'],
    sections: [
      {
        heading: 'Proposals, ranked by evidence',
        text: 'In Banking review, selecting a row loads its proposals in the Reconciliation assistant panel above the categorize area. Each proposal shows its kind (Split, Partial + remainder, or Existing entry), a confidence, and its reasons in plain language — the statement names the invoice reference, the amount is exact, you matched this payee this way before.',
        notes: [
          'A proposal’s parts must add up to the bank row to the cent. The only exception is Partial + remainder, where the remainder is named explicitly and held on account through the existing match flow.',
          'Exact evidence always outranks the fuzzier remainder kind, and proposals below the confidence floor are not shown at all.',
        ],
      },
      {
        heading: 'Confirm or reject',
        steps: [
          'Choose Confirm match on the right proposal. Document matches post through exactly the same matching path as manual matching — splits are simply several documents at once.',
          'An Existing entry proposal links the row to a journal entry that already exists (loan payments and manual entries are common cases). No new journal is created.',
          'Choose Not this match to reject a pairing. The rejection is recorded and that pairing is never proposed again for that row; a rejected document is also kept out of splits for that row.',
          'Rejecting one month’s pairing does not affect next month’s row — rejections belong to the exact row and pairing.',
        ],
      },
      {
        heading: 'It learns from confirmations',
        text: 'Every confirmed match — from the assistant or from the classic match card — feeds the assistant’s memory. A payee you repeatedly match the same way earns a boost, with the reason shown: “You matched the last 3 ‘Ford Credit’ lines to loan payments.” The assistant proposes only; clearing a row always takes your confirmation.',
      },
    ],
    action: { label: 'Open Banking', href: '/banking' },
  },
  {
    slug: 'cash-flow-outlook',
    title: 'The 13-week cash-flow outlook',
    category: 'Reporting and groups',
    summary: 'Thirteen weeks of projected cash from due dates, loan schedules, your payroll pattern, and CRA due dates — every figure traceable to the items under it, and the first negative week called out by date.',
    keywords: ['cash flow', 'outlook', 'forecast', '13 weeks', 'projection', 'remittance'],
    sections: [
      {
        heading: 'What goes in',
        notes: [
          'The opening position is the current balance of your bank and cash accounts, combined, with each account’s balance listed. Credit cards are excluded — their balance is money owing, not a position.',
          'Open invoices land on their due dates; invoices already overdue appear in week 1. Open bills land on their due dates; overdue bills, and bills with no due date (labelled as such), appear in week 1.',
          'Loan payments come from each loan’s own amortization schedule, on their real dates.',
          'Recurring entries project forward on their saved cadence — only the part that actually moves through a bank account counts.',
          'Payroll follows the pattern of your last three payroll journals — their cadence and average amounts, split between pay day and source deductions — with CRA remittances placed on the 15th of the following month, the regular-remitter schedule.',
          'GST/HST net owing for unfiled periods lands on its CRA due date. A refund position is never projected; CRA refund timing is not predictable.',
        ],
      },
      {
        heading: 'Reading the outlook',
        steps: [
          'Open Reports, then Cash-Flow Outlook.',
          'The table shows each week’s money in, money out, net, and running balance, starting from the Monday of the current week.',
          'Expand any week to drill into the items under a figure — invoice and bill numbers, loan names, payroll dates. Every total is the sum of the items listed under it.',
          'If the balance dips below zero, a warning names the week, the exact date, and that day’s balance. The check walks day by day, so a mid-week dip is caught even when the week closes positive.',
          'Known items dated just after week 13 are listed under “Just beyond this window” — not dropped.',
        ],
      },
      {
        heading: 'The assumptions, in the open',
        text: 'The page prints how the outlook is built (“How this outlook is built”). Everything sits on its due date — there is no “this customer usually pays late” modelling. Payroll is not projected at all when fewer than three payroll journals exist, or when the most recent one is old enough that the pattern looks stopped; the page says so instead of guessing. If your payroll journals do not split source deductions into liability accounts, no separate remittance is projected, and the page explains why.',
      },
    ],
    action: { label: 'Open the cash-flow outlook', href: '/reports/cash-flow-outlook' },
  },
  {
    slug: 'ask-your-books',
    title: 'Ask Your Books',
    category: 'Reporting and groups',
    summary: 'Plain-language questions answered only from LedgerPro’s computed report figures — with the workings shown, and an honest refusal for anything outside the list.',
    keywords: ['ask', 'question', 'ai', 'reports', 'grounded', 'natural language'],
    sections: [
      {
        heading: 'What it can answer',
        text: 'Ask Your Books answers a fixed library of questions, each computed by the same report code behind the reports themselves:',
        notes: [
          'How much did we spend on a category this period — with the prior period beside it.',
          'Total revenue for a period.',
          'Who owes us money, over a number of days you choose.',
          'Top customers, and top vendors, for a period.',
          'The GST/HST position for a period.',
          'Loan balances and next payment dates.',
          'CCA by class — book figures: capital cost, accumulated book depreciation, and net book value.',
          'Cash by account, grouped by currency — balances in different currencies are never added together.',
          'Payroll cost for a period, from the payroll journals posted by Nexvar Pay.',
        ],
      },
      {
        heading: 'Every answer shows its workings',
        text: 'An answer carries the figures, the workings in plain language — which report, which period, and which filters produced them — and a link to the source report, so you can verify it in one click. CCA answers state plainly that LedgerPro keeps no tax UCC: UCC as filed lives in Nexvar Tax. Questions are matched against the library by pattern matching built into LedgerPro; when the AI layer is enabled on your deployment, a model may also choose — but it may only select a library question and its parameters. It never sees your ledger figures and never produces a number.',
      },
      {
        heading: 'What it refuses — honestly',
        notes: [
          'A question outside the library gets a refusal, plus the full list of questions it can answer, with examples you can click.',
          'Advice, predictions, and commands are refused the same way — “Should I claim CCA on…”, “Will we…”, “Delete…”, “How do I file…”. Ask Your Books reports on your books; it does not advise, predict, file, or change anything.',
          'A category that matches no account is answered as “no account matches”, never as a silent zero.',
          'Every question is logged with the library question chosen and its parameters — never with amounts.',
        ],
      },
    ],
    action: { label: 'Open Ask Your Books', href: '/reports/ask-books' },
  },
];

export const HELP_ARTICLES: HelpArticle[] = [...BASE_HELP_ARTICLES, ...WALKTHROUGH_ARTICLES];
