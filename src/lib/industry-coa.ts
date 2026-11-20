/**
 * Industry chart-of-accounts packs (LedgerPro improvement plan,
 * Phase 1 item 2 — design §1 of DESIGN-TAX-DOMAIN.md).
 *
 * Templates are CORE + PACK, never separate full charts: every company
 * gets the shared CORE template from src/lib/default-coa.ts (the
 * existing default / corporation templates, unchanged), and choosing an
 * industry layers that industry's pack (10–25 accounts) on top. A pack
 * only ADDS the accounts that make that industry's books different —
 * its revenue lines, cost-of-sales structure, inventory types, capital
 * assets, and industry-specific liabilities.
 *
 * Every pack account is born GIFI-coded from the verified CRA catalogue
 * (src/lib/gifi-catalogue.ts, RC4088 Rev. 23) — no code here was typed
 * from memory, and the test suite re-validates every code against the
 * catalogue. The deliberately-uncoded design exemptions (Retained
 * Earnings / Opening Balance Equity / Owner's Capital / Owner's Draw)
 * live in CORE and stay uncoded; packs contain none of them.
 *
 * GL account codes are unique per company (@@unique([companyId,
 * code])), so pack codes are allocated outside CORE's ranges and are
 * unique across packs. Where two packs genuinely need the same account
 * (rental revenue, the related-party pair), they share ONE account
 * object below, so the same real-world account always carries the same
 * GL code, name, and GIFI code in every industry.
 *
 * This module is data + pure helpers only — it must never import the
 * Prisma-backed db module (the onboarding page imports the industry
 * options for its dropdown).
 */

import type { DefaultChartAccount } from './default-coa';

export type IndustryKey =
  | 'professional_services'
  | 'it_software'
  | 'retail'
  | 'wholesale'
  | 'restaurant'
  | 'construction'
  | 'real_estate_rental'
  | 'trucking'
  | 'healthcare'
  | 'ecommerce'
  | 'farming'
  | 'holding'
  | 'general';

export interface IndustryOption {
  key: IndustryKey;
  /** Wizard wording (design §1.3). */
  label: string;
  description: string;
}

export const INDUSTRY_OPTIONS: readonly IndustryOption[] = [
  { key: 'professional_services', label: 'Professional services & consulting', description: 'Accounting, legal, engineering, business consulting' },
  { key: 'it_software', label: 'IT services & software', description: 'Software, SaaS, IT services' },
  { key: 'retail', label: 'Retail store', description: 'A shop selling goods to the public' },
  { key: 'wholesale', label: 'Wholesale & distribution', description: 'Warehousing and selling to other businesses' },
  { key: 'restaurant', label: 'Restaurant & food services', description: 'Restaurant, café, catering, food truck' },
  { key: 'construction', label: 'Construction & trades', description: 'Contracting, building, skilled trades' },
  { key: 'real_estate_rental', label: 'Real estate rental (long-term)', description: 'Holding and renting out property' },
  { key: 'trucking', label: 'Trucking & transport', description: 'Freight, hauling, delivery fleets' },
  { key: 'healthcare', label: 'Healthcare clinic', description: 'Dental, physio, optometry, veterinary' },
  { key: 'ecommerce', label: 'E-commerce / online sales', description: 'Selling online and through marketplaces' },
  { key: 'farming', label: 'Farming', description: 'Crop or livestock farming corporation' },
  { key: 'holding', label: 'Holding company / investments', description: 'Holds investments or shares of other companies' },
  { key: 'general', label: 'Something else / general', description: 'The standard chart, no industry pack' },
];

const INDUSTRY_KEYS: ReadonlySet<string> = new Set(INDUSTRY_OPTIONS.map((o) => o.key));

/**
 * Values the pre-templates onboarding dropdown used (it held the value
 * in React state only, so nothing was ever stored under them — the
 * aliases exist so any in-flight client still sends a value we honour).
 */
const LEGACY_INDUSTRY_ALIASES: Readonly<Record<string, IndustryKey>> = {
  technology: 'it_software',
  professional: 'professional_services',
  realestate: 'real_estate_rental',
};

/**
 * Normalize a user-supplied industry value to a canonical pack key.
 * Returns null for empty / missing / 'general' is NOT null — 'general'
 * is a real key meaning CORE only. Unknown values return null; callers
 * that must distinguish "no industry" from "garbage" use
 * isKnownIndustryValue().
 */
export function normalizeIndustry(value: unknown): IndustryKey | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === '') return null;
  if (INDUSTRY_KEYS.has(v)) return v as IndustryKey;
  return LEGACY_INDUSTRY_ALIASES[v] ?? null;
}

/** True when the value is empty (no industry) or a known pack key / alias. */
export function isKnownIndustryValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  if (value.trim() === '') return true;
  return normalizeIndustry(value) !== null;
}

export function industryLabel(key: string | null | undefined): string | null {
  const normalized = normalizeIndustry(key);
  if (!normalized) return null;
  return INDUSTRY_OPTIONS.find((o) => o.key === normalized)?.label ?? null;
}

// ── Shared accounts ─────────────────────────────────────────────────
// One object, referenced by every pack that needs the account, so the
// account is identical (GL code, name, GIFI code) wherever it appears.

const RENTAL_REVENUE: DefaultChartAccount = { code: '4290', name: 'Rental Revenue', type: 'income', detailType: 'Rental revenue', description: 'Long-term real estate rental revenue', gifiCode: '8141' };
const TENANT_DEPOSITS: DefaultChartAccount = { code: '2560', name: 'Tenant Deposits Received', type: 'liability', subType: 'current_liability', detailType: 'Deposits received', description: 'Security deposits held for tenants — a liability, never revenue', gifiCode: '2961' };
const RENTAL_PROPERTY_TAXES: DefaultChartAccount = { code: '7110', name: 'Property Taxes — Rental Properties', type: 'expense', detailType: 'Property taxes', gifiCode: '9180' };
const PROPERTY_MANAGEMENT_FEES: DefaultChartAccount = { code: '7130', name: 'Property Management Fees', type: 'expense', detailType: 'Management fees', gifiCode: '9270' };
const DUE_FROM_RELATED: DefaultChartAccount = { code: '1350', name: 'Due from Related Corporations', type: 'asset', subType: 'current_asset', detailType: 'Related party receivable', description: 'Amounts owed by related corporations (long-term portion reclassifies at year-end)', gifiCode: '2241' };
const DUE_TO_RELATED: DefaultChartAccount = { code: '2590', name: 'Due to Related Corporations', type: 'liability', subType: 'current_liability', detailType: 'Related party payable', description: 'Amounts owed to related corporations', gifiCode: '2863' };

// ── The 12 industry packs (design §1.3) ─────────────────────────────

const PROFESSIONAL_SERVICES_PACK: readonly DefaultChartAccount[] = [
  { code: '1210', name: 'Work in Progress', type: 'asset', subType: 'current_asset', detailType: 'Work in progress', description: 'Unbilled time and costs on client engagements in progress', gifiCode: '1125' },
  { code: '1220', name: 'Unbilled Revenue', type: 'asset', subType: 'current_asset', detailType: 'Accrued revenue', description: 'Work performed and earned, not yet invoiced', gifiCode: '1480' },
  { code: '1510', name: 'Computer Equipment', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1774' },
  { code: '1520', name: 'Leasehold Improvements', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1918' },
  { code: '4150', name: 'Consulting Fees', type: 'income', detailType: 'Consulting fees', gifiCode: '8241' },
  { code: '4160', name: 'Management & Administration Fees', type: 'income', detailType: 'Management fees', gifiCode: '8239' },
  { code: '5050', name: 'Subcontractor Costs', type: 'expense', detailType: 'COGS', description: 'Contract professionals engaged on client work', gifiCode: '8360' },
  { code: '6150', name: 'Professional Liability Insurance', type: 'expense', detailType: 'Insurance', description: 'Errors & omissions / professional liability coverage', gifiCode: '8690' },
  { code: '6250', name: 'Dues, Licences & Memberships', type: 'expense', detailType: 'Dues & subscriptions', description: 'Professional body dues and practice licences', gifiCode: '8760' },
  { code: '6550', name: 'Training & Continuing Education', type: 'expense', detailType: 'Other expense', description: 'CPD and professional development', gifiCode: '9270' },
  { code: '6950', name: 'Bad Debt Expense', type: 'expense', detailType: 'Bad debts', gifiCode: '8590' },
];

const IT_SOFTWARE_PACK: readonly DefaultChartAccount[] = [
  { code: '1530', name: 'Computer Equipment & Servers', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1774' },
  { code: '1540', name: 'Capitalized Software', type: 'asset', subType: 'other_asset', detailType: 'Intangible assets', description: 'Purchased or capitalized software (development costs expensed unless capitalized by policy)', gifiCode: '2010' },
  { code: '2460', name: 'Deferred Revenue — Subscriptions', type: 'liability', subType: 'current_liability', detailType: 'Deferred revenue', description: 'Subscriptions billed in advance, earned monthly', gifiCode: '3328' },
  { code: '4180', name: 'Subscription / SaaS Revenue', type: 'income', detailType: 'Service revenue', gifiCode: '8000' },
  { code: '4190', name: 'Implementation & Onboarding Fees', type: 'income', detailType: 'Service revenue', gifiCode: '8000' },
  { code: '5060', name: 'Hosting & Platform Costs', type: 'expense', detailType: 'COGS', description: 'Cloud hosting and platform costs of delivering the service', gifiCode: '8450' },
  { code: '5070', name: 'Contractor Developers', type: 'expense', detailType: 'COGS', gifiCode: '8360' },
  { code: '6160', name: 'Research & Development', type: 'expense', detailType: 'Research & development', description: 'R&D expense detail — feeds SR&ED conversations (flagged, not computed)', gifiCode: '9282' },
  { code: '6170', name: 'Cloud Software Tools', type: 'expense', detailType: 'Computer expenses', gifiCode: '9150' },
  { code: '6960', name: 'Payment Processing Fees', type: 'expense', detailType: 'Bank charges', gifiCode: '8715' },
];

const RETAIL_PACK: readonly DefaultChartAccount[] = [
  { code: '1130', name: 'Inventory — Goods for Sale', type: 'asset', subType: 'current_asset', detailType: 'Inventory', gifiCode: '1121' },
  { code: '1140', name: 'Inventory — Parts & Supplies', type: 'asset', subType: 'current_asset', detailType: 'Inventory', gifiCode: '1122' },
  { code: '1550', name: 'Store Fixtures & Equipment', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1787' },
  { code: '2470', name: 'Gift Cards Outstanding', type: 'liability', subType: 'current_liability', detailType: 'Deferred revenue', description: 'Gift cards sold, not yet redeemed — breakage recognized on expiry', gifiCode: '2961' },
  { code: '2480', name: 'Customer Deposits & Layaways', type: 'liability', subType: 'current_liability', detailType: 'Deposits received', gifiCode: '2961' },
  { code: '5080', name: 'Purchases — Goods for Resale', type: 'expense', detailType: 'COGS', gifiCode: '8320' },
  { code: '5090', name: 'Freight-In', type: 'expense', detailType: 'COGS', description: 'Freight and duty on goods purchased', gifiCode: '8457' },
  { code: '6180', name: 'Store Supplies & Packaging', type: 'expense', detailType: 'Supplies', gifiCode: '9130' },
  { code: '6970', name: 'Merchant & Card Processing Fees', type: 'expense', detailType: 'Bank charges', gifiCode: '8715' },
  { code: '6980', name: 'Inventory Shrinkage & Write-Downs', type: 'expense', detailType: 'Other expense', description: 'Shrinkage, spoilage, and inventory write-downs', gifiCode: '8458' },
];

const WHOLESALE_PACK: readonly DefaultChartAccount[] = [
  { code: '1160', name: 'Inventory — Warehouse Stock', type: 'asset', subType: 'current_asset', detailType: 'Inventory', gifiCode: '1121' },
  { code: '1170', name: 'Inventory in Transit', type: 'asset', subType: 'current_asset', detailType: 'Inventory', gifiCode: '1121' },
  { code: '1560', name: 'Warehouse Equipment', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', description: 'Racking, forklifts, and warehouse equipment', gifiCode: '1785' },
  { code: '2510', name: 'Volume Rebates Payable', type: 'liability', subType: 'current_liability', detailType: 'Accounts payable', gifiCode: '2620' },
  { code: '4230', name: 'Freight Charged to Customers', type: 'income', detailType: 'Other income', gifiCode: '8000' },
  { code: '5110', name: 'Freight-Out', type: 'expense', detailType: 'COGS', description: 'Delivery and freight on goods sold', gifiCode: '9275' },
  { code: '5120', name: 'Warehouse Labour', type: 'expense', detailType: 'COGS', gifiCode: '8340' },
  { code: '6190', name: 'Warehouse Rent', type: 'expense', detailType: 'Rent & lease', gifiCode: '8910' },
  { code: '7010', name: 'Packaging & Shipping Supplies', type: 'expense', detailType: 'Supplies', gifiCode: '9130' },
  { code: '7020', name: 'Customer Rebates & Incentives', type: 'expense', detailType: 'Other expense', gifiCode: '9270' },
];

const RESTAURANT_PACK: readonly DefaultChartAccount[] = [
  { code: '1180', name: 'Inventory — Food', type: 'asset', subType: 'current_asset', detailType: 'Inventory', gifiCode: '1126' },
  { code: '1190', name: 'Inventory — Beverages', type: 'asset', subType: 'current_asset', detailType: 'Inventory', gifiCode: '1126' },
  { code: '1570', name: 'Kitchen Equipment', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1758' },
  { code: '2520', name: 'Tips Payable', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities', description: 'Controlled tips collected for staff, flowed through payroll', gifiCode: '2627' },
  { code: '4240', name: 'Food Sales', type: 'income', detailType: 'Product sales', gifiCode: '8000' },
  { code: '4250', name: 'Beverage Sales', type: 'income', detailType: 'Product sales', gifiCode: '8000' },
  { code: '4260', name: 'Catering Revenue', type: 'income', detailType: 'Service revenue', gifiCode: '8000' },
  { code: '5130', name: 'Food Purchases', type: 'expense', detailType: 'COGS', gifiCode: '8320' },
  { code: '5140', name: 'Beverage Purchases', type: 'expense', detailType: 'COGS', gifiCode: '8320' },
  { code: '5150', name: 'Packaging & Takeout Supplies', type: 'expense', detailType: 'COGS', gifiCode: '8320' },
  { code: '5160', name: 'Direct Wages — Kitchen & Service', type: 'expense', detailType: 'COGS', gifiCode: '8340' },
  { code: '7030', name: 'Delivery Platform Commissions', type: 'expense', detailType: 'Other expense', description: 'SkipTheDishes / Uber Eats / DoorDash commissions', gifiCode: '9270' },
  { code: '7050', name: 'Smallwares & Kitchen Supplies', type: 'expense', detailType: 'Supplies', gifiCode: '9130' },
];

const CONSTRUCTION_PACK: readonly DefaultChartAccount[] = [
  { code: '1250', name: 'Holdbacks Receivable', type: 'asset', subType: 'current_asset', detailType: 'Accounts receivable', description: 'Holdbacks withheld by customers under lien legislation', gifiCode: '1068' },
  { code: '1260', name: 'Work in Progress — Contracts', type: 'asset', subType: 'current_asset', detailType: 'Work in progress', description: 'Costs in excess of billings on contracts in progress (job detail lives in subledgers/tags)', gifiCode: '1125' },
  { code: '1580', name: 'Construction Equipment', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1746' },
  { code: '1590', name: 'Vehicles & Trailers', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1742' },
  { code: '2530', name: 'Holdbacks Payable', type: 'liability', subType: 'current_liability', detailType: 'Accounts payable', description: 'Holdbacks withheld from subcontractors under lien legislation', gifiCode: '2620' },
  { code: '2540', name: 'Billings in Excess of Costs', type: 'liability', subType: 'current_liability', detailType: 'Deferred revenue', description: 'Contract billings ahead of work performed (deferred contract revenue)', gifiCode: '3328' },
  { code: '4270', name: 'Contract Revenue', type: 'income', detailType: 'Service revenue', description: 'Revenue recognized per contract progress', gifiCode: '8000' },
  { code: '4280', name: 'Time & Materials Revenue', type: 'income', detailType: 'Service revenue', gifiCode: '8000' },
  { code: '5170', name: 'Materials Purchases', type: 'expense', detailType: 'COGS', gifiCode: '8320' },
  { code: '5180', name: 'Subcontractor Payments', type: 'expense', detailType: 'COGS', description: 'T5018-reportable construction subcontractors', gifiCode: '8360' },
  { code: '5190', name: 'Equipment Hire & Operation', type: 'expense', detailType: 'COGS', gifiCode: '8451' },
  { code: '5200', name: 'Direct Labour — Jobs', type: 'expense', detailType: 'COGS', gifiCode: '8340' },
  { code: '7060', name: 'Bonding & Construction Insurance', type: 'expense', detailType: 'Insurance', gifiCode: '8690' },
  { code: '7070', name: 'Permits & Licences', type: 'expense', detailType: 'Dues & subscriptions', gifiCode: '8760' },
  { code: '7080', name: 'WSIB / WCB Premiums', type: 'expense', detailType: 'Payroll expenses', gifiCode: '8622' },
  { code: '7090', name: 'Fuel — Equipment & Vehicles', type: 'expense', detailType: 'Fuel', gifiCode: '9224' },
  { code: '7100', name: 'Equipment Repairs & Maintenance', type: 'expense', detailType: 'Repairs & maintenance', gifiCode: '8964' },
];

const REAL_ESTATE_RENTAL_PACK: readonly DefaultChartAccount[] = [
  { code: '1600', name: 'Land', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', description: 'Land is non-depreciable — kept separate from buildings so the asset register feeds the right CCA class', gifiCode: '1600' },
  { code: '1610', name: 'Buildings', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1680' },
  { code: '1620', name: 'Capital Improvements — Buildings', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', description: 'Capital improvements are capitalized to the asset register, never expensed as repairs', gifiCode: '1680' },
  TENANT_DEPOSITS,
  RENTAL_REVENUE,
  { code: '4300', name: 'Other Rental Income', type: 'income', detailType: 'Rental revenue', description: 'Parking, laundry, and other tenant charges', gifiCode: '8140' },
  RENTAL_PROPERTY_TAXES,
  { code: '7120', name: 'Repairs & Maintenance — Rental Properties', type: 'expense', detailType: 'Repairs & maintenance', description: 'Repairs only — capital work goes to Capital Improvements', gifiCode: '8960' },
  PROPERTY_MANAGEMENT_FEES,
  { code: '7140', name: 'Condominium Fees', type: 'expense', detailType: 'Condo fees', gifiCode: '8913' },
  { code: '7150', name: 'Utilities — Rental Properties', type: 'expense', detailType: 'Utilities', gifiCode: '9220' },
  { code: '7160', name: 'Snow Removal & Landscaping', type: 'expense', detailType: 'Repairs & maintenance', gifiCode: '8960' },
  { code: '7170', name: 'Insurance — Rental Properties', type: 'expense', detailType: 'Insurance', gifiCode: '8690' },
];

const TRUCKING_PACK: readonly DefaultChartAccount[] = [
  { code: '1280', name: 'IFTA / Fuel Tax Receivable', type: 'asset', subType: 'current_asset', detailType: 'Tax recoverable', gifiCode: '1066' },
  { code: '1630', name: 'Tractors & Trucks', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', description: 'Per-unit asset records — disposals are frequent', gifiCode: '1742' },
  { code: '1640', name: 'Trailers', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1783' },
  { code: '2570', name: 'IFTA Fuel Tax Payable', type: 'liability', subType: 'current_liability', detailType: 'Sales tax payable', gifiCode: '2680' },
  { code: '4330', name: 'Freight & Hauling Revenue', type: 'income', detailType: 'Service revenue', gifiCode: '8000' },
  { code: '4340', name: 'Fuel Surcharge Revenue', type: 'income', detailType: 'Service revenue', gifiCode: '8000' },
  { code: '5210', name: 'Driver Wages', type: 'expense', detailType: 'COGS', gifiCode: '8340' },
  { code: '5220', name: 'Owner-Operator Subcontractors', type: 'expense', detailType: 'COGS', description: 'T4A-relevant contract drivers', gifiCode: '8360' },
  { code: '7180', name: 'Fuel — Fleet', type: 'expense', detailType: 'Fuel', gifiCode: '9224' },
  { code: '7190', name: 'Repairs — Tires', type: 'expense', detailType: 'Repairs & maintenance', gifiCode: '8962' },
  { code: '7200', name: 'Repairs — Mechanical', type: 'expense', detailType: 'Repairs & maintenance', gifiCode: '8962' },
  { code: '7210', name: 'Plates, Permits & IFTA Licences', type: 'expense', detailType: 'Dues & subscriptions', description: 'IRP plates and IFTA licensing', gifiCode: '8760' },
  { code: '7220', name: 'Fleet Insurance', type: 'expense', detailType: 'Insurance', description: 'Commercial fleet coverage', gifiCode: '8690' },
  { code: '7230', name: 'Tolls & Scales', type: 'expense', detailType: 'Other expense', gifiCode: '9270' },
];

const HEALTHCARE_PACK: readonly DefaultChartAccount[] = [
  { code: '1290', name: 'Inventory — Clinical Supplies', type: 'asset', subType: 'current_asset', detailType: 'Inventory', gifiCode: '1122' },
  { code: '1650', name: 'Clinical Equipment', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1785' },
  { code: '4350', name: 'Provincial Plan Billings', type: 'income', detailType: 'Service revenue', description: 'Revenue by payer — all payer lines share one GIFI code', gifiCode: '8000' },
  { code: '4360', name: 'Private / Insurer Billings', type: 'income', detailType: 'Service revenue', gifiCode: '8000' },
  { code: '4370', name: 'Patient Billings', type: 'income', detailType: 'Service revenue', gifiCode: '8000' },
  { code: '5230', name: 'Clinical Supplies Used', type: 'expense', detailType: 'COGS', gifiCode: '9130' },
  { code: '5240', name: 'Laboratory & Imaging Fees', type: 'expense', detailType: 'COGS', gifiCode: '8450' },
  { code: '7240', name: 'Associate / Clinician Contract Payments', type: 'expense', detailType: 'Professional fees', description: 'T4A-relevant associate and locum payments', gifiCode: '8360' },
  { code: '7250', name: 'Professional Staff Wages', type: 'expense', detailType: 'Payroll expenses', gifiCode: '9066' },
  { code: '7260', name: 'Support Staff Wages', type: 'expense', detailType: 'Payroll expenses', gifiCode: '9066' },
  { code: '7270', name: 'Malpractice & Clinic Insurance', type: 'expense', detailType: 'Insurance', gifiCode: '8690' },
  { code: '7280', name: 'Medical Licences & College Fees', type: 'expense', detailType: 'Dues & subscriptions', gifiCode: '8760' },
];

const ECOMMERCE_PACK: readonly DefaultChartAccount[] = [
  { code: '1310', name: 'Inventory — Goods for Sale', type: 'asset', subType: 'current_asset', detailType: 'Inventory', gifiCode: '1121' },
  { code: '1320', name: 'Inventory at 3PL / Fulfillment Centres', type: 'asset', subType: 'current_asset', detailType: 'Inventory', gifiCode: '1121' },
  { code: '4380', name: 'Online Sales — Canada', type: 'income', detailType: 'Product sales', description: 'Revenue split by jurisdiction at the source — GST/HST place of supply depends on it', gifiCode: '8000' },
  { code: '4400', name: 'Online Sales — United States', type: 'income', detailType: 'Product sales', gifiCode: '8000' },
  { code: '4410', name: 'Online Sales — Rest of World', type: 'income', detailType: 'Product sales', gifiCode: '8000' },
  { code: '4420', name: 'Sales Returns & Allowances', type: 'income', detailType: 'Contra revenue', description: 'Contra-revenue: refunds and allowances against online sales', gifiCode: '8000' },
  { code: '5250', name: 'Product Purchases', type: 'expense', detailType: 'COGS', gifiCode: '8320' },
  { code: '5260', name: 'Fulfillment & 3PL Fees', type: 'expense', detailType: 'COGS', gifiCode: '8450' },
  { code: '7290', name: 'Marketplace Fees', type: 'expense', detailType: 'Other expense', description: 'Amazon / Shopify / marketplace seller fees', gifiCode: '9270' },
  { code: '7300', name: 'Payment Processing Fees', type: 'expense', detailType: 'Bank charges', gifiCode: '8715' },
  { code: '7310', name: 'Shipping & Postage', type: 'expense', detailType: 'Delivery & freight', gifiCode: '9275' },
  { code: '7320', name: 'Online Advertising', type: 'expense', detailType: 'Marketing', gifiCode: '8520' },
];

const FARMING_PACK: readonly DefaultChartAccount[] = [
  { code: '1330', name: 'Inventory — Crops & Feed', type: 'asset', subType: 'current_asset', detailType: 'Inventory', description: 'Farming corporations track crop/feed inventory — the mandatory inventory adjustment is a year-end conversation', gifiCode: '1120' },
  { code: '1340', name: 'Inventory — Livestock', type: 'asset', subType: 'current_asset', detailType: 'Inventory', gifiCode: '1120' },
  { code: '1660', name: 'Farm Machinery & Equipment', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1740' },
  { code: '1670', name: 'Farm Buildings', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1680' },
  { code: '1690', name: 'Quota', type: 'asset', subType: 'other_asset', detailType: 'Intangible assets', description: 'Dairy / poultry quota where held', gifiCode: '2014' },
  { code: '2580', name: 'Farm Credit / FCC Loans Payable', type: 'liability', subType: 'long_term_liability', detailType: 'Loans payable', gifiCode: '3142' },
  { code: '4430', name: 'Wheat Sales', type: 'income', detailType: 'Farm revenue', gifiCode: '9371' },
  { code: '4440', name: 'Canola Sales', type: 'income', detailType: 'Farm revenue', gifiCode: '9376' },
  { code: '4450', name: 'Other Grain & Oilseed Sales', type: 'income', detailType: 'Farm revenue', gifiCode: '9370' },
  { code: '4460', name: 'Cattle Sales', type: 'income', detailType: 'Farm revenue', gifiCode: '9471' },
  { code: '4470', name: 'Other Livestock Revenue', type: 'income', detailType: 'Farm revenue', gifiCode: '9470' },
  { code: '4480', name: 'Program Payments — AgriStability / AgriInvest', type: 'income', detailType: 'Farm revenue', gifiCode: '9545' },
  { code: '4490', name: 'Crop Insurance Proceeds', type: 'income', detailType: 'Farm revenue', gifiCode: '9542' },
  { code: '7340', name: 'Fertilizers & Lime', type: 'expense', detailType: 'Farm expenses', gifiCode: '9662' },
  { code: '7350', name: 'Seeds & Plants', type: 'expense', detailType: 'Farm expenses', gifiCode: '9664' },
  { code: '7360', name: 'Pesticides & Herbicides', type: 'expense', detailType: 'Farm expenses', gifiCode: '9663' },
  { code: '7370', name: 'Feed & Supplements', type: 'expense', detailType: 'Farm expenses', gifiCode: '9711' },
  { code: '7380', name: 'Livestock Purchases', type: 'expense', detailType: 'Farm expenses', gifiCode: '9712' },
  { code: '7390', name: 'Veterinary & Breeding Fees', type: 'expense', detailType: 'Farm expenses', gifiCode: '9713' },
  { code: '7400', name: 'Machinery Fuel', type: 'expense', detailType: 'Farm expenses', gifiCode: '9764' },
  { code: '7410', name: 'Machinery Repairs', type: 'expense', detailType: 'Farm expenses', gifiCode: '9763' },
  { code: '7420', name: 'Custom & Contract Work', type: 'expense', detailType: 'Farm expenses', gifiCode: '9798' },
  { code: '7430', name: 'Farm Labour', type: 'expense', detailType: 'Farm expenses', gifiCode: '9814' },
];

const HOLDING_PACK: readonly DefaultChartAccount[] = [
  DUE_FROM_RELATED,
  { code: '1360', name: 'Short-Term Investments & GICs', type: 'asset', subType: 'current_asset', detailType: 'Investments', gifiCode: '1181' },
  { code: '1700', name: 'Long-Term Investments', type: 'asset', subType: 'other_asset', detailType: 'Investments', description: 'Portfolio investments held long-term', gifiCode: '2300' },
  { code: '1710', name: 'Investments in Subsidiaries', type: 'asset', subType: 'other_asset', detailType: 'Investments', gifiCode: '2244' },
  DUE_TO_RELATED,
  { code: '4500', name: 'Dividend Income — Canadian', type: 'income', detailType: 'Dividend income', description: 'The dividend-source split matters for Sch 53 / GRIP and Part IV in Nexvar Tax', gifiCode: '8096' },
  { code: '4510', name: 'Dividend Income — Foreign', type: 'income', detailType: 'Dividend income', gifiCode: '8097' },
  { code: '4520', name: 'Interest Income — Bonds & Debentures', type: 'income', detailType: 'Interest income', gifiCode: '8092' },
  { code: '4530', name: 'Interest Income — Other', type: 'income', detailType: 'Interest income', gifiCode: '8094' },
  { code: '4540', name: 'Management Fees — Subsidiaries', type: 'income', detailType: 'Management fees', description: 'Management fees charged to subsidiaries', gifiCode: '8239' },
  { code: '4550', name: 'Realized Gains on Investments', type: 'income', detailType: 'Other income', gifiCode: '8210' },
  { code: '7440', name: 'Investment Management & Custody Fees', type: 'expense', detailType: 'Other expense', gifiCode: '9270' },
  { code: '7450', name: 'Interest Expense — Investment Loans', type: 'expense', detailType: 'Interest expense', gifiCode: '8710' },
];

/** Primary packs by industry key. 'general' is CORE only — no pack. */
export const INDUSTRY_PACKS: Readonly<Partial<Record<IndustryKey, readonly DefaultChartAccount[]>>> = {
  professional_services: PROFESSIONAL_SERVICES_PACK,
  it_software: IT_SOFTWARE_PACK,
  retail: RETAIL_PACK,
  wholesale: WHOLESALE_PACK,
  restaurant: RESTAURANT_PACK,
  construction: CONSTRUCTION_PACK,
  real_estate_rental: REAL_ESTATE_RENTAL_PACK,
  trucking: TRUCKING_PACK,
  healthcare: HEALTHCARE_PACK,
  ecommerce: ECOMMERCE_PACK,
  farming: FARMING_PACK,
  holding: HOLDING_PACK,
};

// ── Add-on packs (design §1.3) ──────────────────────────────────────
// Applied on top of any primary pack. The composition helper
// (chartTemplateForCompany in src/lib/default-coa.ts) accepts add-on
// keys today; no UI offers them yet.

export type AddonPackKey = 'rental' | 'payroll' | 'usd' | 'related_party';

export const ADDON_PACKS: Readonly<Record<AddonPackKey, readonly DefaultChartAccount[]>> = {
  rental: [RENTAL_REVENUE, TENANT_DEPOSITS, RENTAL_PROPERTY_TAXES, PROPERTY_MANAGEMENT_FEES],
  payroll: [
    { code: '2630', name: 'Vacation Pay Payable', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities', gifiCode: '2627' },
    { code: '2640', name: 'WCB / WSIB Payable', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities', gifiCode: '2627' },
    { code: '7460', name: 'Wages — Hourly', type: 'expense', detailType: 'Payroll expenses', gifiCode: '9066' },
    { code: '7470', name: 'Management Salaries', type: 'expense', detailType: 'Payroll expenses', gifiCode: '9065' },
  ],
  usd: [
    { code: '1370', name: 'USD Bank Account', type: 'asset', subType: 'current_asset', detailType: 'Bank', parentCode: '1000', gifiCode: '1003' },
    { code: '1380', name: 'Foreign Currency Bank Account', type: 'asset', subType: 'current_asset', detailType: 'Bank', parentCode: '1000', gifiCode: '1005' },
  ],
  related_party: [
    { code: '1390', name: 'Trade Receivables — Related Parties', type: 'asset', subType: 'current_asset', detailType: 'Accounts receivable', gifiCode: '1064' },
    DUE_FROM_RELATED,
    DUE_TO_RELATED,
    { code: '4570', name: 'Sales to Related Parties', type: 'income', detailType: 'Product sales', gifiCode: '8020' },
  ],
};

/** The pack accounts for an industry value (empty for general / none / unknown). */
export function industryPackAccounts(industry?: string | null): readonly DefaultChartAccount[] {
  const key = normalizeIndustry(industry);
  if (!key || key === 'general') return [];
  return INDUSTRY_PACKS[key] ?? [];
}

/** The accounts of one add-on pack (empty for an unknown key). */
export function addonPackAccounts(key: string | null | undefined): readonly DefaultChartAccount[] {
  if (!key) return [];
  return ADDON_PACKS[key as AddonPackKey] ?? [];
}
