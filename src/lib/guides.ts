import type { HelpArticle } from './help-content';
import { WALKTHROUGH_ARTICLES } from './help-walkthroughs';
import { LEDGERPRO_URL } from './seo';

export type PublicGuide = {
  /** Route segment below /guides. */
  slug: string;
  /** Slug of the in-product walkthrough this public guide is rendered from. */
  sourceSlug: string;
  /** Search-facing H1. The body still comes from the source walkthrough. */
  title: string;
  /** Absolute browser title used in metadata and structured data. */
  metaTitle: string;
  /** Meta description and social-sharing summary. */
  description: string;
  /** Short public introduction shown below the H1. */
  intro: string;
  /** Related public guide slugs, in display order. */
  related: string[];
  /** Sitemap priority; the GST/HST guide is the flagship Canadian topic. */
  priority: number;
  article: HelpArticle;
};

type PublicGuideDefinition = Omit<PublicGuide, 'article'>;

const GUIDE_DEFINITIONS: PublicGuideDefinition[] = [
  {
    slug: 'company-setup-chart-of-accounts',
    sourceSlug: 'walkthrough-company-setup',
    title: 'How to set up a company and chart of accounts',
    metaTitle: 'Company & Chart of Accounts Setup in LedgerPro | Canada Guide',
    description:
      'See how to set up a Canadian company in LedgerPro, add its GST/HST registration, review the chart of accounts, and configure bank, card, and cash accounts.',
    intro:
      'Follow Prairie Peak Renovations through the setup decisions every LedgerPro company makes: profile, tax registration, accounts, and a second related company.',
    related: ['import-bank-statement-without-duplicates', 'intercompany-loans-and-management-fees', 'gst-hst-return-lines-101-115'],
    priority: 0.8,
  },
  {
    slug: 'import-bank-statement-without-duplicates',
    sourceSlug: 'walkthrough-bank-import',
    title: 'How to import a bank statement without importing it twice',
    metaTitle: 'Import Bank Statements Without Duplicates | LedgerPro Guide',
    description:
      'Learn how to import CSV, OFX, or PDF bank statements into LedgerPro and use transaction fingerprints to prevent duplicate bookkeeping entries.',
    intro:
      'A clean import is the start of clean books. This guide shows how statement rows enter one account at a time — and how LedgerPro recognises an overlapping import before it can double the ledger.',
    related: ['categorize-and-post-bank-transactions', 'receipt-capture-small-business', 'trial-balance-profit-loss-balance-sheet'],
    priority: 0.85,
  },
  {
    slug: 'categorize-and-post-bank-transactions',
    sourceSlug: 'walkthrough-categorize-and-post',
    title: 'How to categorize and post bank transactions',
    metaTitle: 'Categorize & Post Bank Transactions | LedgerPro Guide',
    description:
      'Learn how to categorize imported bank transactions, split GST/HST correctly, apply rules to repeat purchases, and post each row as a balanced journal entry.',
    intro:
      'An imported bank row is only a suggestion until it is categorized and posted. Follow the exact moment a row becomes accounting — including the GST/HST split and the journal behind it.',
    related: ['import-bank-statement-without-duplicates', 'receipt-capture-small-business', 'gst-hst-return-lines-101-115'],
    priority: 0.85,
  },
  {
    slug: 'receipt-capture-small-business',
    sourceSlug: 'walkthrough-receipts',
    title: 'Receipt capture: snap it, attach it, or record a cash expense',
    metaTitle: 'Receipt Capture Guide for Canadian Small Businesses | LedgerPro',
    description:
      'Learn how to capture receipts on desktop or by phone, attach them to bank transactions, and record cash expenses with GST/HST in LedgerPro.',
    intro:
      'Paper receipts fade and disappear; the accounting evidence should not. This guide follows a receipt from phone capture or upload to the bank row — and shows the separate route for a purchase paid in cash.',
    related: ['categorize-and-post-bank-transactions', 'enter-bills-and-track-supplier-payments', 'gst-hst-return-lines-101-115'],
    priority: 0.85,
  },
  {
    slug: 'create-invoices-and-track-payments',
    sourceSlug: 'walkthrough-invoices-and-payments',
    title: 'How to create invoices and track customer payments',
    metaTitle: 'Create Invoices & Track Payments in LedgerPro | Canada Guide',
    description:
      'Learn how to create Canadian customer invoices in LedgerPro, track partial and overdue payments, and connect money received to accounts receivable.',
    intro:
      'Prairie Peak’s quarter contains paid, partly paid, overdue, and not-yet-due invoices. Use that realistic mix to see how LedgerPro handles the full receivables cycle — including why payments are matched through the bank.',
    related: ['enter-bills-and-track-supplier-payments', 'trial-balance-profit-loss-balance-sheet', 'gst-hst-return-lines-101-115'],
    priority: 0.8,
  },
  {
    slug: 'enter-bills-and-track-supplier-payments',
    sourceSlug: 'walkthrough-bills-and-payments',
    title: 'How to enter bills and track supplier payments',
    metaTitle: 'Enter Bills & Track Supplier Payments | LedgerPro Guide',
    description:
      'Learn how to enter supplier bills in LedgerPro, record full or partial payments, and keep accounts payable and GST/HST accurate.',
    intro:
      'A bill records what the business owes before any money moves. Follow Prairie Peak’s supplier bills from entry to payment, and see how the remaining balances agree to accounts payable.',
    related: ['create-invoices-and-track-payments', 'receipt-capture-small-business', 'trial-balance-profit-loss-balance-sheet'],
    priority: 0.8,
  },
  {
    slug: 'gst-hst-return-lines-101-115',
    sourceSlug: 'walkthrough-gst-return',
    title: 'GST/HST return lines 101–115, explained with an example',
    metaTitle: 'GST/HST Return Lines 101–115 Explained | LedgerPro Canada',
    description:
      'Understand GST/HST return lines 101 to 115 with a worked Canadian example showing sales, tax collected, input tax credits, and the net tax owing.',
    intro:
      'This is the flagship guide: Prairie Peak’s real Q3 2026 figures, computed from its posted journals. Read each line the way CRA does — sales, GST/HST collected, input tax credits, and net tax — then see the workpaper behind the return.',
    related: ['categorize-and-post-bank-transactions', 'trial-balance-profit-loss-balance-sheet', 'receipt-capture-small-business'],
    priority: 0.95,
  },
  {
    slug: 'payroll-sync-nexvar-pay-ledgerpro',
    sourceSlug: 'walkthrough-payroll-sync',
    title: 'How payroll sync posts one journal for every pay run',
    metaTitle: 'Payroll Sync Between Nexvar Pay & LedgerPro | Guide',
    description:
      'See how Nexvar Pay posts one balanced payroll journal to LedgerPro for each finalized pay run, including wages, deductions, and employer payroll taxes.',
    intro:
      'Payroll should not be retyped into the accounting system. This guide shows the granular journal Nexvar Pay sends to LedgerPro, how duplicate sync is prevented, and how employee payments and CRA remittances clear the liabilities.',
    related: ['categorize-and-post-bank-transactions', 'trial-balance-profit-loss-balance-sheet', 'company-setup-chart-of-accounts'],
    priority: 0.8,
  },
  {
    slug: 'intercompany-loans-and-management-fees',
    sourceSlug: 'walkthrough-intercompany',
    title: 'Intercompany loans and management fees between sister companies',
    metaTitle: 'Intercompany Loans & Management Fees | LedgerPro Guide',
    description:
      'Learn how to record an intercompany loan and management fee between related Canadian companies while keeping both sets of books mirrored in LedgerPro.',
    intro:
      'Related companies need more than a note saying “transfer.” Follow a $25,000 loan and a GST-bearing management fee through both Prairie Peak companies and prove that the mirror balances agree.',
    related: ['company-setup-chart-of-accounts', 'trial-balance-profit-loss-balance-sheet', 'gst-hst-return-lines-101-115'],
    priority: 0.85,
  },
  {
    slug: 'trial-balance-profit-loss-balance-sheet',
    sourceSlug: 'walkthrough-reports',
    title: 'How to read the trial balance, P&L, and balance sheet',
    metaTitle: 'Trial Balance, P&L & Balance Sheet Guide | LedgerPro',
    description:
      'Learn how to read a trial balance, profit and loss statement, and balance sheet in LedgerPro using a complete Prairie Peak example.',
    intro:
      'Reports are only useful when the reader knows what would make them wrong. Start with the trial-balance proof, scan a payroll-heavy quarter’s loss honestly, and connect the balance sheet back to invoices, bills, and tax workpapers.',
    related: ['gst-hst-return-lines-101-115', 'create-invoices-and-track-payments', 'enter-bills-and-track-supplier-payments'],
    priority: 0.85,
  },
];

const walkthroughBySlug = new Map(WALKTHROUGH_ARTICLES.map((article) => [article.slug, article]));

export const PUBLIC_GUIDES: PublicGuide[] = GUIDE_DEFINITIONS.map((definition) => {
  const article = walkthroughBySlug.get(definition.sourceSlug);
  if (!article) {
    throw new Error(`Missing walkthrough article for public guide: ${definition.sourceSlug}`);
  }
  return { ...definition, article };
});

export const PUBLIC_GUIDE_SLUGS = PUBLIC_GUIDES.map((guide) => guide.slug);

export const PUBLIC_GUIDE_BY_SLUG = new Map(PUBLIC_GUIDES.map((guide) => [guide.slug, guide]));

export function getPublicGuide(slug: string): PublicGuide | undefined {
  return PUBLIC_GUIDE_BY_SLUG.get(slug);
}

export function getRelatedPublicGuides(guide: PublicGuide): PublicGuide[] {
  return guide.related
    .map((slug) => PUBLIC_GUIDE_BY_SLUG.get(slug))
    .filter((related): related is PublicGuide => Boolean(related));
}

export function getGuideUrl(guide: PublicGuide): string {
  return `${LEDGERPRO_URL}/guides/${guide.slug}`;
}

export function getGuideImageUrls(guide: PublicGuide): string[] {
  const urls = new Set<string>();
  for (const section of guide.article.sections) {
    for (const image of section.images ?? []) {
      urls.add(image.src.startsWith('http') ? image.src : `${LEDGERPRO_URL}${image.src}`);
    }
  }
  return [...urls];
}

export function countGuideImages(guide: PublicGuide): number {
  return guide.article.sections.reduce((total, section) => total + (section.images?.length ?? 0), 0);
}
