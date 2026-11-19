import { db } from '@/lib/db';

export type DefaultChartAccount = {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  subType?: 'current_asset' | 'fixed_asset' | 'other_asset' | 'current_liability' | 'long_term_liability' | 'common_shares' | 'retained_earnings' | 'owners_equity' | 'other_equity';
  detailType?: string;
  parentCode?: string;
  description?: string;
  /** CRA GIFI code (catalogue-verified, RC4088) — assigned at seed time so a new company's chart starts coded. Deliberately absent on Retained Earnings / Opening Balance Equity (computed on the tax side) and Miscellaneous Expense (no honest generic fit). */
  gifiCode?: string;
  active?: boolean;
};

export const DEFAULT_CHART_OF_ACCOUNTS: readonly DefaultChartAccount[] = [
  { code: '1000', name: 'Bank Accounts', type: 'asset', subType: 'current_asset', detailType: 'Bank', description: 'Cash and bank accounts', gifiCode: '1002' },
  { code: '1010', name: 'Business Checking', type: 'asset', subType: 'current_asset', detailType: 'Bank', parentCode: '1000', description: 'Primary operating account', gifiCode: '1002' },
  { code: '1020', name: 'Business Savings', type: 'asset', subType: 'current_asset', detailType: 'Savings', parentCode: '1000', description: 'Reserve or savings account', gifiCode: '1002' },
  { code: '1030', name: 'Undeposited Funds', type: 'asset', subType: 'current_asset', detailType: 'Undeposited funds', parentCode: '1000', gifiCode: '1007' },
  { code: '1040', name: 'Petty Cash', type: 'asset', subType: 'current_asset', detailType: 'Cash', parentCode: '1000', description: 'Cash on hand', gifiCode: '1001' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset', subType: 'current_asset', detailType: 'Accounts receivable', gifiCode: '1062' },
  { code: '1200', name: 'Prepaid Expenses', type: 'asset', subType: 'current_asset', detailType: 'Prepaid expenses', gifiCode: '1484' },
  { code: '1500', name: 'Furniture & Equipment', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets', gifiCode: '1787' },
  { code: '2000', name: 'Credit Cards', type: 'liability', subType: 'current_liability', detailType: 'Credit card', gifiCode: '2707' },
  { code: '2110', name: 'Business Credit Card', type: 'liability', subType: 'current_liability', detailType: 'Credit card', parentCode: '2000', gifiCode: '2707' },
  { code: '2200', name: 'Accounts Payable', type: 'liability', subType: 'current_liability', detailType: 'Accounts payable', gifiCode: '2620' },
  { code: '2300', name: 'Sales Tax Payable', type: 'liability', subType: 'current_liability', detailType: 'Sales tax payable', gifiCode: '2680' },
  // Phase 1: recoverable GST/HST is an ASSET (input tax credits), never a
  // reduction of the 2300 payable at posting time — netting happens in the
  // GST/HST return computation. PST/RST collected is a separate provincial
  // liability, never part of GST/HST line 103.
  { code: '2310', name: 'GST/HST Recoverable — Input Tax Credits', type: 'asset', subType: 'current_asset', detailType: 'Tax recoverable', gifiCode: '1480' },
  { code: '2330', name: 'Provincial Sales Tax Payable', type: 'liability', subType: 'current_liability', detailType: 'Sales tax payable', gifiCode: '2680' },
  // Phase 1 cleanup (QST return): QST gets its OWN accounts, following the
  // 2300/2310/2330 precedent — QST collected is a Revenu Québec liability,
  // never part of GST/HST line 103, and QST ITRs are an asset, netted only
  // in the QST return computation (lines 206–209), never in GL postings.
  { code: '2340', name: 'QST Payable', type: 'liability', subType: 'current_liability', detailType: 'Sales tax payable', gifiCode: '2680' },
  { code: '2350', name: 'QST Recoverable — Input Tax Refunds', type: 'asset', subType: 'current_asset', detailType: 'Tax recoverable', gifiCode: '1480' },
  { code: '2400', name: 'Payroll Liabilities', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities', gifiCode: '2627' },
  // Payroll sync L1 (Nexvar Pay → LedgerPro v1): granular source-deduction
  // payables under the 2400 Payroll Liabilities umbrella, so a payroll
  // journal can split CPP / EI / income tax / net pay instead of lumping
  // everything into 2400. Codes follow the 2300-series precedent: each new
  // code is free in the template and unique per company
  // (@@unique([companyId, code])), so ensureDefaultChartOfAccounts()
  // backfills existing companies idempotently by code.
  { code: '2410', name: 'CPP Payable', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities', gifiCode: '2627' },
  { code: '2420', name: 'EI Payable', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities', gifiCode: '2627' },
  { code: '2430', name: 'Income Tax Payable', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities', gifiCode: '2627' },
  { code: '2440', name: 'Wages Payable', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities', gifiCode: '2624' },
  { code: '2500', name: 'Loans Payable', type: 'liability', subType: 'long_term_liability', detailType: 'Loans payable', gifiCode: '3140' },
  { code: '3000', name: "Owner's Capital", type: 'equity', subType: 'owners_equity', detailType: "Owner's equity" },
  { code: '3100', name: 'Retained Earnings', type: 'equity', subType: 'retained_earnings', detailType: 'Retained earnings' },
  { code: '3900', name: "Owner's Draw", type: 'equity', subType: 'owners_equity', detailType: "Owner's equity" },
  // Phase 0 (P0-8): Opening Balance Equity gets its OWN code. The
  // opening-balance route used to get-or-create code 3900 AS
  // "Opening Balance Equity", hijacking Owner's Draw in the template.
  { code: '3950', name: 'Opening Balance Equity', type: 'equity', subType: 'owners_equity', detailType: 'Opening balance offset' },
  { code: '4000', name: 'Product Sales', type: 'income', detailType: 'Product sales', gifiCode: '8000' },
  { code: '4100', name: 'Service Revenue', type: 'income', detailType: 'Service revenue', gifiCode: '8000' },
  { code: '4908', name: 'Other Income', type: 'income', detailType: 'Other income', gifiCode: '8230' },
  { code: '4310', name: 'FX Gain (Realized)', type: 'income', detailType: 'Other income', gifiCode: '8230' },
  { code: '4320', name: 'FX Gain/Loss (Unrealized)', type: 'income', detailType: 'Other income', gifiCode: '8230' },
  { code: '4390', name: 'FX Rounding', type: 'income', detailType: 'Other income', gifiCode: '8230' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense', detailType: 'COGS', gifiCode: '8320' },
  { code: '6100', name: 'Software & Subscriptions', type: 'expense', detailType: 'Dues & subscriptions', gifiCode: '8810' },
  { code: '6200', name: 'Professional Fees', type: 'expense', detailType: 'Professional fees', gifiCode: '8860' },
  { code: '6300', name: 'Rent & Lease', type: 'expense', detailType: 'Rent & lease', gifiCode: '8910' },
  { code: '6400', name: 'Marketing', type: 'expense', detailType: 'Marketing', gifiCode: '8520' },
  { code: '6500', name: 'Travel', type: 'expense', detailType: 'Travel', gifiCode: '9200' },
  { code: '6600', name: 'Utilities', type: 'expense', detailType: 'Utilities', gifiCode: '9220' },
  { code: '6700', name: 'Meals & Entertainment', type: 'expense', detailType: 'Meals & entertainment', gifiCode: '8523' },
  { code: '6800', name: 'Office Supplies', type: 'expense', detailType: 'Office supplies', gifiCode: '8810' },
  { code: '6900', name: 'Bank Fees', type: 'expense', detailType: 'Bank charges', gifiCode: '8715' },
  { code: '6910', name: 'Insurance', type: 'expense', detailType: 'Insurance', gifiCode: '8690' },
  { code: '6920', name: 'Payroll Expense', type: 'expense', detailType: 'Payroll expenses', gifiCode: '9060' },
  { code: '6930', name: 'Repairs & Maintenance', type: 'expense', detailType: 'Repairs & maintenance', gifiCode: '8960' },
  // Payroll sync L1: employer payroll taxes (employer CPP/CPP2/EI) get
  // their OWN expense account, distinct from 6920 Payroll Expense (gross
  // wages). NOTE ON THE CODE: the payroll-sync scoping doc proposed 6930,
  // but 6930 is already Repairs & Maintenance above and codes are unique
  // per company — a second 6930 could never be created (backfill skips
  // existing codes, and new companies would get only one of the two).
  // 6940 is the next free expense code, so it is used instead; the
  // Nexvar Pay mapping default must point at 6940, not 6930.
  { code: '6940', name: 'Employer Payroll Taxes Expense', type: 'expense', detailType: 'Payroll expenses', gifiCode: '8622' },
  { code: '6990', name: 'Miscellaneous Expense', type: 'expense', detailType: 'Other expense' },
];

export const FINANCIAL_ACCOUNT_KINDS = ['checking', 'savings', 'creditcard', 'payoutclearing', 'cash'] as const;
export type FinancialAccountKind = (typeof FINANCIAL_ACCOUNT_KINDS)[number];

type ChartAccountClient = Pick<typeof db, 'chartOfAccount'>;

// ── Corporation template variant (GIFI plan D1) ──────────────────────
// Same operating accounts as the default template — derived from it so
// the two can never drift — but the equity section is a corporation's:
// Share Capital instead of Owner's Capital / Owner's Draw, plus the
// shareholder-loan pair a corporation's books actually use. Chosen when
// Company.businessType is 'corporation'. Retained Earnings and Opening
// Balance Equity stay deliberately uncoded in both templates (D2).
export const CORPORATION_CHART_OF_ACCOUNTS: readonly DefaultChartAccount[] = [
  // Shareholder-loan receivable sits in the asset code range (GIFI 1301
  // is a current-asset line); the payable in the liability range.
  { code: '1300', name: 'Due from Shareholder', type: 'asset', subType: 'current_asset', detailType: 'Shareholder loan', description: 'Amounts owed by the shareholder to the corporation', gifiCode: '1301' },
  { code: '2600', name: 'Due to Shareholder', type: 'liability', subType: 'current_liability', detailType: 'Shareholder loan', description: 'Amounts the corporation owes the shareholder', gifiCode: '2781' },
  ...DEFAULT_CHART_OF_ACCOUNTS.filter(
    (account) => account.code !== '3000' && account.code !== '3900',
  ),
  { code: '3000', name: 'Share Capital', type: 'equity', subType: 'common_shares', detailType: 'Share capital', description: 'Issued common shares', gifiCode: '3500' },
];

/** The chart template for a company, by its BusinessType. */
export function chartTemplateForBusinessType(
  businessType?: string | null,
): readonly DefaultChartAccount[] {
  return businessType === 'corporation' ? CORPORATION_CHART_OF_ACCOUNTS : DEFAULT_CHART_OF_ACCOUNTS;
}

export function isFinancialAccountKind(value: unknown): value is FinancialAccountKind {
  return typeof value === 'string' && FINANCIAL_ACCOUNT_KINDS.includes(value as FinancialAccountKind);
}

export async function ensureDefaultChartOfAccounts(
  companyId: string,
  client: ChartAccountClient = db,
  businessType?: string | null,
) {
  // Template selection (GIFI plan D1): a corporation gets the
  // corporation variant. Callers that know the type pass it; otherwise
  // resolve it from the company row when the client can (the lazy
  // ensure calls in the API routes pass a chart-only client, in which
  // case the default template applies, exactly as before).
  let template = chartTemplateForBusinessType(businessType);
  if (businessType === undefined) {
    try {
      const companyClient = (client as any).company;
      if (companyClient?.findUnique) {
        const company = await companyClient.findUnique({
          where: { id: companyId },
          select: { businessType: true },
        });
        template = chartTemplateForBusinessType(company?.businessType);
      }
    } catch {
      // Resolution is best-effort — fall back to the default template.
    }
  }

  const defaultCodes = template.map((account) => account.code);
  const existing = await client.chartOfAccount.findMany({
    where: { companyId, code: { in: defaultCodes } },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((account) => account.code));

  // Phase 0 (P0-8): name-collision guard. The template itself contains
  // exactly one "Insurance" (6910) and one "Bank Fees" (6900), but if a
  // company already has an account with the same NAME under a different
  // code (created manually or by a trial-balance import — Muja's live
  // chart has 5300 Insurance and 5600 Bank Charges & Interest alongside
  // the template pair), re-running this filler must not mint a second
  // account with the same name. Skip by name in that case.
  const existingNamed = await client.chartOfAccount.findMany({
    where: { companyId, active: true },
    select: { name: true },
  });
  const existingNames = new Set(existingNamed.map((a: any) => a.name.trim().toLowerCase()));
  const missingAccounts = template.filter(
    (account) => !existingCodes.has(account.code) && !existingNames.has(account.name.trim().toLowerCase()),
  );

  if (missingAccounts.length === 0) {
    return { created: 0 };
  }

  const result = await client.chartOfAccount.createMany({
    data: missingAccounts.map((account) => ({
      companyId,
      code: account.code,
      name: account.name,
      type: account.type,
      subType: account.subType ?? null,
      detailType: account.detailType ?? null,
      parentCode: account.parentCode ?? null,
      description: account.description ?? null,
      gifiCode: account.gifiCode ?? null,
      balance: 0,
      active: account.active ?? true,
    })),
    skipDuplicates: true,
  });

  return { created: result.count };
}

export async function getDefaultFinancialAccountGlCode(
  companyId: string,
  kind: FinancialAccountKind,
  client: ChartAccountClient = db,
) {
  await ensureDefaultChartOfAccounts(companyId, client);

  const preferredCodesByKind: Record<FinancialAccountKind, string[]> = {
    checking: ['1010', '1000'],
    savings: ['1020', '1010', '1000'],
    creditcard: ['2110', '2000'],
    payoutclearing: ['1030', '1010', '1000'],
    cash: ['1040', '1000'],
  };
  const preferredCodes = preferredCodesByKind[kind];
  const preferredAccounts = await client.chartOfAccount.findMany({
    where: { companyId, code: { in: preferredCodes }, active: true },
    select: { code: true },
  });
  const activeCodes = new Set(preferredAccounts.map((account) => account.code));
  const preferredCode = preferredCodes.find((code) => activeCodes.has(code));

  if (preferredCode) {
    return preferredCode;
  }

  const fallback = await client.chartOfAccount.findFirst({
    where: {
      companyId,
      active: true,
      type: kind === 'creditcard' ? 'liability' : 'asset',
    },
    orderBy: { code: 'asc' },
    select: { code: true },
  });

  return fallback?.code ?? null;
}
