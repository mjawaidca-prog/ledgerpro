/**
 * Industry re-detection (LedgerPro improvement plan, Phase 2 item 5).
 *
 * Phase 1 item 2 gave every company a CORE + industry-PACK chart, but
 * the industry is whatever the owner picked at signup — sometimes
 * nothing, sometimes a guess. This module scores the company's REAL
 * activity (which accounts actually carry transactions and journal
 * lines, and what its imported payees/descriptions look like) against
 * each of the 13 industry packs and decides whether a different pack
 * fits the books better.
 *
 * Deterministic rules only — no LLM, no network, no db import. The
 * profile is built by src/lib/industry-detect-data.ts; the suggestion
 * rules (dismissals, current industry) live in
 * src/lib/industry-suggestion.ts. A suggestion is only ever OFFERED —
 * applying it goes through the existing PUT /api/companies flow, which
 * layers the pack idempotently and removes nothing.
 *
 * How scoring works: every industry owns a table of SIGNALS. A signal
 * matches either the chart (a pack GL code / GIFI code / account-name
 * keyword on an account that has real activity) or the transaction
 * text (payee/description keywords, by count or by share of the
 * expense/income side). An industry's score is the share of its total
 * signal weight that matched. The bar is deliberately conservative:
 * enough underlying activity, a high score, at least three matched
 * signals, and a clear margin over the runner-up — a coin-flip between
 * two industries suggests nothing.
 */

import { industryLabel, normalizeIndustry, type IndustryKey } from './industry-coa';

// ── Profile (input) ─────────────────────────────────────────────────

export interface AccountActivity {
  code: string;
  name: string;
  type: string;
  gifiCode: string | null;
  /** Stored GL balance (signed). */
  balance: number;
  /** Categorized bank transactions pointing at this account. */
  txCount: number;
  /** Journal lines posted to this account code (non-voided entries). */
  journalCount: number;
}

export interface TextActivity {
  /** description + merchant + payee guess, concatenated. */
  text: string;
  /** Absolute amount. */
  amount: number;
}

export interface IndustryActivityProfile {
  accounts: AccountActivity[];
  /** Money-out transaction text (amount < 0 on the statement). */
  expenseTexts: TextActivity[];
  /** Money-in transaction text (amount > 0). */
  incomeTexts: TextActivity[];
  totalExpenseAmount: number;
  totalIncomeAmount: number;
  /** Categorized transactions + journal lines — the "enough data" gate. */
  activityCount: number;
}

// ── Signals ─────────────────────────────────────────────────────────

interface AccountSignal {
  kind: 'account';
  id: string;
  weight: number;
  evidence: string;
  glCodes?: readonly string[];
  gifiCodes?: readonly string[];
  nameKeywords?: readonly string[];
}

interface TextSignal {
  kind: 'text';
  id: string;
  weight: number;
  /** May contain {pct}, replaced with the matched share of the side. */
  evidence: string;
  side: 'expense' | 'income' | 'any';
  keywords: readonly string[];
  minCount?: number;
  minSharePct?: number;
}

type Signal = AccountSignal | TextSignal;

const acct = (s: Omit<AccountSignal, 'kind'>): AccountSignal => ({ kind: 'account', ...s });
const text = (s: Omit<TextSignal, 'kind'>): TextSignal => ({ kind: 'text', ...s });

/**
 * The signal tables. GL/GIFI codes come from the packs in
 * industry-coa.ts (the same account always carries the same code in
 * every pack, so a code match is meaningful even on a custom chart);
 * name keywords catch the accounts users create themselves, which is
 * where most of the signal lives for a CORE-only company.
 */
const SIGNALS: Readonly<Partial<Record<IndustryKey, readonly Signal[]>>> = {
  trucking: [
    acct({ id: 'ifta-accounts', weight: 3, evidence: 'IFTA fuel-tax accounts have activity', glCodes: ['1280', '2570'], nameKeywords: ['ifta'] }),
    acct({ id: 'freight-revenue', weight: 3, evidence: 'Freight & hauling revenue accounts have activity', glCodes: ['4330', '4340'] }),
    acct({ id: 'fuel-accounts', weight: 2, evidence: 'Fuel accounts have activity', nameKeywords: ['fuel'] }),
    acct({ id: 'driver-wages', weight: 2, evidence: 'Driver wage accounts have activity', nameKeywords: ['driver'] }),
    text({ id: 'fuel-share', weight: 3, evidence: 'Fuel purchases are {pct}% of expenses', side: 'expense', keywords: ['petro-canada', 'petro canada', 'flying j', 'pilot travel', 'shell', 'esso', 'husky', 'diesel', 'fuel'], minSharePct: 20 }),
    text({ id: 'truck-parts', weight: 2, evidence: 'Payments to tire shops and truck dealers', side: 'any', keywords: ['tire', 'tyre', 'kenworth', 'peterbilt', 'freightliner', 'mack truck', 'volvo truck'], minCount: 2 }),
  ],
  construction: [
    acct({ id: 'holdbacks-receivable', weight: 4, evidence: 'Holdbacks receivable has activity', glCodes: ['1250'], nameKeywords: ['holdback'] }),
    acct({ id: 'holdbacks-payable', weight: 3, evidence: 'Holdbacks payable has activity', glCodes: ['2530'], nameKeywords: ['holdback'] }),
    acct({ id: 'contract-wip', weight: 2, evidence: 'Contract work-in-progress accounts have activity', glCodes: ['1260', '2540'] }),
    acct({ id: 'subcontractors', weight: 2, evidence: 'Subcontractor accounts have activity', nameKeywords: ['subcontractor'] }),
    text({ id: 'building-suppliers', weight: 2, evidence: 'Payments to building-material suppliers', side: 'expense', keywords: ['home depot', 'rona', 'lumber', 'building supplies', 'concrete', 'gravel', 'plumbing supply', 'electrical supply'], minCount: 3 }),
    text({ id: 'wsib', weight: 1, evidence: 'WSIB / WCB premiums', side: 'any', keywords: ['wsib', 'wcb'], minCount: 1 }),
  ],
  real_estate_rental: [
    acct({ id: 'rental-revenue', weight: 4, evidence: 'Rental revenue has activity', glCodes: ['4290'], gifiCodes: ['8141'] }),
    acct({ id: 'tenant-deposits', weight: 2, evidence: 'Tenant deposit accounts have activity', glCodes: ['2560'], nameKeywords: ['tenant'] }),
    text({ id: 'rent-share', weight: 3, evidence: 'Rent is {pct}% of income', side: 'income', keywords: ['rent'], minSharePct: 50 }),
    acct({ id: 'rental-accounts', weight: 2, evidence: 'Rental property accounts have activity', nameKeywords: ['rental'] }),
    text({ id: 'property-mgmt', weight: 2, evidence: 'Property management / condo fee payments', side: 'any', keywords: ['property management', 'condo fees', 'condominium fees'], minCount: 2 }),
  ],
  farming: [
    acct({ id: 'farm-gifi', weight: 4, evidence: 'Farm revenue and expense accounts have activity', gifiCodes: ['9370', '9371', '9376', '9470', '9471', '9542', '9545', '9662', '9663', '9664', '9711', '9712', '9713', '9763', '9764', '9798', '9814'] }),
    acct({ id: 'farm-accounts', weight: 2, evidence: 'Farm input accounts (feed, seed, fertilizer) have activity', nameKeywords: ['feed', 'fertilizer', 'seed', 'livestock', 'farm'] }),
    acct({ id: 'quota', weight: 2, evidence: 'A quota asset is on the books', glCodes: ['1690'], nameKeywords: ['quota'] }),
    acct({ id: 'fcc-loans', weight: 2, evidence: 'Farm Credit (FCC) loans are on the books', glCodes: ['2580'], nameKeywords: ['farm credit', 'fcc'] }),
    text({ id: 'farm-inputs', weight: 3, evidence: 'Farm input payments (feed, seed, fertilizer) are common', side: 'expense', keywords: ['fertilizer', 'seed', 'feed', 'livestock', 'cattle', 'veterinary', 'herbicide', 'pesticide'], minCount: 3 }),
    text({ id: 'farm-income', weight: 2, evidence: 'Crop, livestock and farm program income', side: 'income', keywords: ['grain', 'canola', 'wheat', 'cattle', 'livestock', 'agristability', 'crop insurance'], minCount: 2 }),
  ],
  professional_services: [
    acct({ id: 'wip', weight: 3, evidence: 'Work-in-progress / unbilled revenue accounts have activity', glCodes: ['1210', '1220'] }),
    acct({ id: 'consulting-revenue', weight: 3, evidence: 'Consulting and management-fee revenue accounts have activity', glCodes: ['4150', '4160'], gifiCodes: ['8241', '8239'] }),
    text({ id: 'consulting-income', weight: 2, evidence: 'Consulting / advisory income', side: 'income', keywords: ['consulting', 'advisory', 'retainer'], minCount: 3 }),
    acct({ id: 'prof-liability', weight: 1, evidence: 'Professional liability insurance', nameKeywords: ['professional liability'] }),
    acct({ id: 'prof-dues', weight: 1, evidence: 'Professional dues and licences', nameKeywords: ['dues', 'licences', 'memberships'] }),
  ],
  it_software: [
    acct({ id: 'saas-revenue', weight: 3, evidence: 'Subscription / SaaS revenue accounts have activity', glCodes: ['2460', '4180', '4190'], nameKeywords: ['subscription', 'saas'] }),
    acct({ id: 'hosting', weight: 2, evidence: 'Hosting and cloud platform costs', nameKeywords: ['hosting', 'cloud'] }),
    acct({ id: 'rnd', weight: 2, evidence: 'Research & development spending', glCodes: ['6160'], nameKeywords: ['research & development'] }),
    text({ id: 'cloud-platforms', weight: 3, evidence: 'Cloud platform payments (AWS / Azure / Google Cloud)', side: 'expense', keywords: ['amazon web services', 'aws', 'google cloud', 'microsoft azure', 'azure', 'digitalocean', 'heroku', 'vercel'], minCount: 3 }),
    text({ id: 'subscription-income', weight: 2, evidence: 'Subscription income', side: 'income', keywords: ['subscription', 'saas'], minCount: 3 }),
  ],
  retail: [
    acct({ id: 'retail-inventory', weight: 3, evidence: 'Inventory — goods for sale accounts have activity', glCodes: ['1130', '1140'], gifiCodes: ['1121', '1122'] }),
    acct({ id: 'gift-cards', weight: 3, evidence: 'Gift card / customer deposit liabilities have activity', glCodes: ['2470', '2480'] }),
    acct({ id: 'retail-purchases', weight: 2, evidence: 'Retail purchase / shrinkage accounts', nameKeywords: ['goods for resale', 'shrinkage'] }),
    text({ id: 'pos', weight: 2, evidence: 'Point-of-sale and merchant processor activity', side: 'expense', keywords: ['square', 'shopify', 'lightspeed', 'clover', 'moneris', 'global payments'], minCount: 2 }),
    acct({ id: 'merchant-fees', weight: 1, evidence: 'Merchant fee accounts', nameKeywords: ['merchant'] }),
  ],
  wholesale: [
    acct({ id: 'warehouse-inventory', weight: 3, evidence: 'Warehouse stock / inventory-in-transit accounts', glCodes: ['1160', '1170'] }),
    acct({ id: 'warehouse-costs', weight: 2, evidence: 'Warehouse and freight-out costs', glCodes: ['5110', '5120'], nameKeywords: ['warehouse'] }),
    acct({ id: 'rebates-payable', weight: 2, evidence: 'Volume rebates payable', glCodes: ['2510'] }),
    text({ id: 'logistics', weight: 2, evidence: 'Warehouse / logistics payments', side: 'any', keywords: ['warehouse', 'distribution centre', 'logistics'], minCount: 2 }),
    acct({ id: 'freight-charged', weight: 1, evidence: 'Freight charged to customers', glCodes: ['4230'] }),
  ],
  restaurant: [
    acct({ id: 'food-inventory', weight: 3, evidence: 'Food and beverage inventory accounts', glCodes: ['1180', '1190'], gifiCodes: ['1126'] }),
    acct({ id: 'food-sales', weight: 3, evidence: 'Food, beverage and catering sales accounts', glCodes: ['4240', '4250', '4260'] }),
    acct({ id: 'tips-payable', weight: 3, evidence: 'Tips payable — money held for staff', glCodes: ['2520'], nameKeywords: ['tips payable'] }),
    text({ id: 'food-suppliers', weight: 2, evidence: 'Food supplier and delivery-platform activity', side: 'expense', keywords: ['sysco', 'gordon food', 'gfs', 'uber eats', 'skip the dishes', 'skipthedishes', 'doordash'], minCount: 2 }),
    acct({ id: 'kitchen', weight: 2, evidence: 'Kitchen equipment / supplies accounts', nameKeywords: ['kitchen'] }),
  ],
  healthcare: [
    acct({ id: 'payer-billings', weight: 3, evidence: 'Payer billing accounts (provincial plan / insurer / patient)', glCodes: ['4350', '4360', '4370'] }),
    acct({ id: 'clinical', weight: 2, evidence: 'Clinical supplies accounts', glCodes: ['1290', '5230'], nameKeywords: ['clinical'] }),
    acct({ id: 'malpractice', weight: 2, evidence: 'Malpractice insurance', nameKeywords: ['malpractice'] }),
    text({ id: 'health-plan', weight: 2, evidence: 'Health-plan and clinical supplier activity', side: 'any', keywords: ['ohip', 'alberta health', 'medical services plan', 'dental supply', 'henry schein', 'laboratory'], minCount: 2 }),
    acct({ id: 'clinic', weight: 2, evidence: 'Clinic accounts', nameKeywords: ['clinic'] }),
  ],
  ecommerce: [
    acct({ id: 'online-sales-split', weight: 3, evidence: 'Online sales split by country / jurisdiction', glCodes: ['4380', '4400', '4410'] }),
    acct({ id: 'fulfillment-inventory', weight: 2, evidence: 'Inventory held at fulfillment centres', glCodes: ['1320'], nameKeywords: ['3pl', 'fulfillment'] }),
    acct({ id: 'marketplace-fees', weight: 2, evidence: 'Marketplace fee accounts', glCodes: ['7290'], nameKeywords: ['marketplace'] }),
    text({ id: 'platforms', weight: 3, evidence: 'Marketplace and online payment platform activity', side: 'expense', keywords: ['amazon', 'shopify', 'ebay', 'etsy', 'paypal', 'stripe'], minCount: 3 }),
    text({ id: 'shipping', weight: 2, evidence: 'Frequent shipping and postage', side: 'expense', keywords: ['canada post', 'ups', 'fedex', 'purolator', 'shipping'], minCount: 3 }),
  ],
  holding: [
    acct({ id: 'dividend-split', weight: 4, evidence: 'Dividend income split by source (Canadian / foreign)', gifiCodes: ['8096', '8097'] }),
    acct({ id: 'investments', weight: 3, evidence: 'Long-term and subsidiary investment accounts', glCodes: ['1700', '1710'] }),
    text({ id: 'dividends', weight: 3, evidence: 'Dividend income receipts', side: 'income', keywords: ['dividend'], minCount: 2 }),
    acct({ id: 'realized-gains', weight: 1, evidence: 'Realized gains on investments', glCodes: ['4550'], nameKeywords: ['realized gains'] }),
    acct({ id: 'related-party', weight: 1, evidence: 'Due from / to related corporations', glCodes: ['1350', '2590'] }),
  ],
};

// ── Scoring ─────────────────────────────────────────────────────────

export interface SignalHit {
  id: string;
  weight: number;
  evidence: string;
}

export interface IndustryScore {
  industry: IndustryKey;
  /** 0..1 — matched weight / total signal weight for the industry. */
  score: number;
  hits: SignalHit[];
}

export const MIN_ACTIVITY_FOR_DETECTION = 20;
export const SUGGESTION_SCORE_THRESHOLD = 0.45;
export const SUGGESTION_MIN_HITS = 3;
export const SUGGESTION_MARGIN = 0.1;

function accountHasActivity(a: AccountActivity): boolean {
  return a.txCount > 0 || a.journalCount > 0 || Math.abs(a.balance) >= 0.005;
}

/**
 * Word-boundary keyword match: short keywords must not fire inside
 * unrelated words ('ups' in "groups", 'rent' in "current", 'aws' in
 * "laws"). Multi-word phrases and hyphenated names still match.
 */
function containsKeyword(haystack: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

function matchAccountSignal(profile: IndustryActivityProfile, signal: AccountSignal): boolean {
  const codes = signal.glCodes ? new Set(signal.glCodes) : null;
  const gifis = signal.gifiCodes ? new Set(signal.gifiCodes) : null;
  const keywords = signal.nameKeywords?.map((k) => k.toLowerCase());
  return profile.accounts.some((a) => {
    if (!accountHasActivity(a)) return false;
    if (codes?.has(a.code)) return true;
    if (gifis && a.gifiCode && gifis.has(a.gifiCode)) return true;
    if (keywords) {
      const name = a.name.toLowerCase();
      if (keywords.some((k) => containsKeyword(name, k))) return true;
    }
    return false;
  });
}

function matchTextSignal(
  profile: IndustryActivityProfile,
  signal: TextSignal,
): { matched: boolean; sharePct: number } {
  const rows = signal.side === 'expense'
    ? profile.expenseTexts
    : signal.side === 'income'
      ? profile.incomeTexts
      : [...profile.expenseTexts, ...profile.incomeTexts];
  const sideTotal = signal.side === 'expense'
    ? profile.totalExpenseAmount
    : signal.side === 'income'
      ? profile.totalIncomeAmount
      : profile.totalExpenseAmount + profile.totalIncomeAmount;

  let count = 0;
  let amount = 0;
  for (const row of rows) {
    const haystack = row.text.toLowerCase();
    if (signal.keywords.some((k) => containsKeyword(haystack, k))) {
      count += 1;
      amount += row.amount;
    }
  }
  const sharePct = sideTotal > 0 ? (amount / sideTotal) * 100 : 0;
  const byCount = signal.minCount !== undefined && count >= signal.minCount;
  const byShare = signal.minSharePct !== undefined && sharePct >= signal.minSharePct;
  return { matched: byCount || byShare, sharePct };
}

/** Score every pack industry against the profile, best first. */
export function scoreIndustryFit(profile: IndustryActivityProfile): IndustryScore[] {
  const scores: IndustryScore[] = [];
  for (const [key, signals] of Object.entries(SIGNALS) as [IndustryKey, readonly Signal[]][]) {
    const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
    const hits: SignalHit[] = [];
    let matchedWeight = 0;
    for (const signal of signals) {
      if (signal.kind === 'account') {
        if (matchAccountSignal(profile, signal)) {
          matchedWeight += signal.weight;
          hits.push({ id: signal.id, weight: signal.weight, evidence: signal.evidence });
        }
      } else {
        const { matched, sharePct } = matchTextSignal(profile, signal);
        if (matched) {
          matchedWeight += signal.weight;
          hits.push({
            id: signal.id,
            weight: signal.weight,
            evidence: signal.evidence.replace('{pct}', String(Math.round(sharePct))),
          });
        }
      }
    }
    scores.push({
      industry: key,
      score: totalWeight > 0 ? matchedWeight / totalWeight : 0,
      hits,
    });
  }
  return scores.sort((a, b) => b.score - a.score);
}

export interface IndustryDetection {
  industry: IndustryKey;
  label: string;
  /** 0..1 */
  score: number;
  /** Up to three plain-language evidence items, strongest first. */
  evidence: string[];
}

/**
 * The suggestion decision, pure: given the profile and the company's
 * currently-set industry, return the industry to suggest — or null
 * when the data is too thin, the fit is weak or ambiguous, or the
 * books already match the set industry.
 */
export function detectIndustry(
  profile: IndustryActivityProfile,
  currentIndustry: string | null | undefined,
): IndustryDetection | null {
  if (profile.activityCount < MIN_ACTIVITY_FOR_DETECTION) return null;

  const scores = scoreIndustryFit(profile);
  const best = scores[0];
  if (!best) return null;
  if (best.score < SUGGESTION_SCORE_THRESHOLD) return null;
  if (best.hits.length < SUGGESTION_MIN_HITS) return null;

  const runnerUp = scores[1];
  if (runnerUp && best.score - runnerUp.score < SUGGESTION_MARGIN) return null;

  const current = normalizeIndustry(currentIndustry);
  if (current && current === best.industry) return null;

  const evidence = [...best.hits]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((h) => h.evidence);

  return {
    industry: best.industry,
    label: industryLabel(best.industry) ?? best.industry,
    score: best.score,
    evidence,
  };
}
