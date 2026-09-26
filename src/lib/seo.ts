export const LEDGERPRO_URL = 'https://ledger.nexvarlab.com';
export const NEXVAR_URL = 'https://www.nexvarlab.online';

export type SeoFeature = {
  slug: string;
  title: string;
  metaTitle: string;
  description: string;
  eyebrow: string;
  intro: string;
  benefits: Array<{ title: string; body: string }>;
  workflow: string[];
  faq: Array<{ question: string; answer: string }>;
};

export const SEO_FEATURES: Record<string, SeoFeature> = {
  invoicing: {
    slug: 'invoicing',
    title: 'Invoicing software that keeps the books in balance',
    metaTitle: 'Small Business Invoicing Software Canada | LedgerPro',
    description:
      'Create invoices, track customer payments, and keep accounts receivable connected to a real double-entry ledger with LedgerPro.',
    eyebrow: 'Canadian invoicing software',
    intro:
      'LedgerPro connects every invoice and payment to the general ledger. Canadian small businesses can follow what customers owe without maintaining a separate spreadsheet or rebuilding the accounting entry later.',
    benefits: [
      {
        title: 'Professional customer invoices',
        body: 'Create clear invoices with line-by-line revenue categorization, due dates, customer details, and payment status in one workflow.',
      },
      {
        title: 'Accounts receivable that stays current',
        body: 'See outstanding and overdue amounts while the accounts receivable aging report remains connected to posted transactions.',
      },
      {
        title: 'Automatic double-entry posting',
        body: 'Sending an invoice and recording its payment create the balanced entries needed to keep revenue, tax, receivables, and cash aligned.',
      },
      {
        title: 'Canadian sales tax support',
        body: 'Apply the appropriate GST, HST, QST, or provincial sales-tax treatment and carry the result into tax workpapers and reports.',
      },
    ],
    workflow: [
      'Select the customer and add invoice lines.',
      'Choose revenue accounts and applicable Canadian sales tax.',
      'Send the invoice and monitor its status.',
      'Record payment and update the ledger automatically.',
    ],
    faq: [
      {
        question: 'Does LedgerPro post invoices to the general ledger?',
        answer: 'Yes. Posted invoices and their payments create balanced journal entries so receivables, revenue, tax, and cash stay connected.',
      },
      {
        question: 'Can I track overdue customer balances?',
        answer: 'Yes. LedgerPro includes payment status and accounts receivable aging so you can identify outstanding and overdue invoices.',
      },
    ],
  },
  'bank-reconciliation': {
    slug: 'bank-reconciliation',
    title: 'Bank reconciliation built for clean, reviewable books',
    metaTitle: 'Bank Reconciliation Software for Canadian Businesses | LedgerPro',
    description:
      'Import or sync bank activity, match transfers, categorize transactions, and reconcile Canadian business accounts in LedgerPro.',
    eyebrow: 'Bank reconciliation software',
    intro:
      'LedgerPro brings bank and credit-card activity into a controlled accounting workflow. Review suggestions, match transfers between your own accounts, and reconcile to the statement without losing the audit trail.',
    benefits: [
      {
        title: 'Direct bank feeds and statement import',
        body: 'Connect eligible bank accounts or import CSV, OFX, QFX, and PDF statements for a practical path from bank activity to reviewed books.',
      },
      {
        title: 'Transfer and duplicate controls',
        body: 'Identify likely transfers between your accounts and flag possible duplicate imports before they distort income or expenses.',
      },
      {
        title: 'Review before posting',
        body: 'Accept, adjust, split, or reject suggested categories so automation supports your judgment instead of silently changing the ledger.',
      },
      {
        title: 'Statement-to-ledger reconciliation',
        body: 'Compare cleared activity with the statement ending balance and retain the completed reconciliation for later review.',
      },
    ],
    workflow: [
      'Connect an eligible account or upload a supported statement.',
      'Review duplicate, transfer, and category suggestions.',
      'Post approved transactions to the correct accounts.',
      'Complete the reconciliation against the statement balance.',
    ],
    faq: [
      {
        question: 'Which bank statement formats can LedgerPro import?',
        answer: 'LedgerPro supports CSV, OFX, QFX, and PDF statement workflows for bank and credit-card accounts.',
      },
      {
        question: 'Are bank-feed transactions posted automatically?',
        answer: 'LedgerPro uses a review-first workflow. Suggested categories and matches can be checked before transactions are posted to the books.',
      },
    ],
  },
  'financial-reporting': {
    slug: 'financial-reporting',
    title: 'Financial reports generated from a real double-entry ledger',
    metaTitle: 'Financial Reporting Software for Small Business | LedgerPro',
    description:
      'Generate balance sheets, profit and loss statements, cash-flow reports, aging, trial balances, and management packages with LedgerPro.',
    eyebrow: 'Small business financial reporting',
    intro:
      'LedgerPro calculates reports from balanced postings rather than a disconnected reporting cache. Owners, bookkeepers, and accountants can move from transaction detail to year-end working papers with a consistent audit trail.',
    benefits: [
      {
        title: 'Core financial statements',
        body: 'Review the balance sheet, profit and loss statement, cash-flow report, trial balance, and general ledger from the same accounting records.',
      },
      {
        title: 'Receivable and payable aging',
        body: 'See customer and vendor balances by age to support collections, payment planning, and month-end review.',
      },
      {
        title: 'Management reporting',
        body: 'Create comparative reports, budget-versus-actual analysis, and a combined management package for owners, lenders, or boards.',
      },
      {
        title: 'Accountant-ready exports',
        body: 'Use fiscal-year-aware reports and GIFI trial-balance export to reduce manual preparation at year end.',
      },
    ],
    workflow: [
      'Post and review transactions in the double-entry ledger.',
      'Choose the company, fiscal period, and comparison period.',
      'Open the report and drill into supporting activity.',
      'Export or print the report for review and year-end work.',
    ],
    faq: [
      {
        question: 'Which financial reports are included?',
        answer: 'LedgerPro includes the balance sheet, profit and loss, cash flow, trial balance, general ledger, AR/AP aging, budget versus actual, and management reporting.',
      },
      {
        question: 'Does LedgerPro support non-calendar fiscal years?',
        answer: 'Yes. Reporting follows the fiscal year configured for the company rather than assuming every business uses a calendar year.',
      },
    ],
  },
  'canadian-sales-tax': {
    slug: 'canadian-sales-tax',
    title: 'Canadian sales tax records with review controls',
    metaTitle: 'GST, HST, QST & PST Accounting Software Canada | LedgerPro',
    description:
      'Track GST, HST, QST, PST, and related Canadian sales-tax amounts with reviewable transactions and tax workpapers in LedgerPro.',
    eyebrow: 'GST/HST/QST/PST accounting',
    intro:
      'LedgerPro is designed for Canadian businesses that need tax amounts connected to the underlying invoice, bill, payment, and journal entry. Reviewable workpapers help your accountant trace balances without rebuilding them from spreadsheets.',
    benefits: [
      {
        title: 'Province-aware tax codes',
        body: 'Configure the tax treatment used by your business and apply it consistently to sales and purchases.',
      },
      {
        title: 'Input and output tax tracking',
        body: 'Keep tax collected and recoverable amounts tied to posted transactions for a clearer period-end review.',
      },
      {
        title: 'Controlled tax workpapers',
        body: 'Preview, review, and retain filing-period support with the transaction detail behind the reported balances.',
      },
      {
        title: 'Accountant collaboration',
        body: 'Provide fiscal-year reports, general-ledger detail, and GIFI-aligned exports that reduce manual year-end cleanup.',
      },
    ],
    workflow: [
      'Configure the tax codes relevant to the company.',
      'Apply tax when entering invoices, bills, and adjustments.',
      'Review period activity and supporting transactions.',
      'Use the workpaper and reports to support filing and payment review.',
    ],
    faq: [
      {
        question: 'Which Canadian sales taxes can LedgerPro track?',
        answer: 'LedgerPro supports workflows for GST, HST, QST, PST, RST, and related province-specific tax configurations.',
      },
      {
        question: 'Does LedgerPro file a tax return for me?',
        answer: 'LedgerPro prepares accounting records and reviewable workpapers. Filing and payment should still be reviewed against the applicable tax authority requirements.',
      },
    ],
  },
};

export const SEO_FEATURE_SLUGS = Object.keys(SEO_FEATURES);
