import { db } from '@/lib/db';

export type DefaultChartAccount = {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  subType?: 'current_asset' | 'fixed_asset' | 'other_asset' | 'current_liability' | 'long_term_liability' | 'common_shares' | 'retained_earnings' | 'owners_equity' | 'other_equity';
  detailType?: string;
  parentCode?: string;
  description?: string;
  active?: boolean;
};

export const DEFAULT_CHART_OF_ACCOUNTS: readonly DefaultChartAccount[] = [
  { code: '1000', name: 'Bank Accounts', type: 'asset', subType: 'current_asset', detailType: 'Bank', description: 'Cash and bank accounts' },
  { code: '1010', name: 'Business Checking', type: 'asset', subType: 'current_asset', detailType: 'Bank', parentCode: '1000', description: 'Primary operating account' },
  { code: '1020', name: 'Business Savings', type: 'asset', subType: 'current_asset', detailType: 'Savings', parentCode: '1000', description: 'Reserve or savings account' },
  { code: '1030', name: 'Undeposited Funds', type: 'asset', subType: 'current_asset', detailType: 'Undeposited funds', parentCode: '1000' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset', subType: 'current_asset', detailType: 'Accounts receivable' },
  { code: '1200', name: 'Prepaid Expenses', type: 'asset', subType: 'current_asset', detailType: 'Prepaid expenses' },
  { code: '1500', name: 'Furniture & Equipment', type: 'asset', subType: 'fixed_asset', detailType: 'Fixed assets' },
  { code: '2000', name: 'Credit Cards', type: 'liability', subType: 'current_liability', detailType: 'Credit card' },
  { code: '2110', name: 'Business Credit Card', type: 'liability', subType: 'current_liability', detailType: 'Credit card', parentCode: '2000' },
  { code: '2200', name: 'Accounts Payable', type: 'liability', subType: 'current_liability', detailType: 'Accounts payable' },
  { code: '2300', name: 'Sales Tax Payable', type: 'liability', subType: 'current_liability', detailType: 'Sales tax payable' },
  // Phase 1: recoverable GST/HST is an ASSET (input tax credits), never a
  // reduction of the 2300 payable at posting time — netting happens in the
  // GST/HST return computation. PST/RST collected is a separate provincial
  // liability, never part of GST/HST line 103.
  { code: '2310', name: 'GST/HST Recoverable — Input Tax Credits', type: 'asset', subType: 'current_asset', detailType: 'Tax recoverable' },
  { code: '2330', name: 'Provincial Sales Tax Payable', type: 'liability', subType: 'current_liability', detailType: 'Sales tax payable' },
  // Phase 1 cleanup (QST return): QST gets its OWN accounts, following the
  // 2300/2310/2330 precedent — QST collected is a Revenu Québec liability,
  // never part of GST/HST line 103, and QST ITRs are an asset, netted only
  // in the QST return computation (lines 206–209), never in GL postings.
  { code: '2340', name: 'QST Payable', type: 'liability', subType: 'current_liability', detailType: 'Sales tax payable' },
  { code: '2350', name: 'QST Recoverable — Input Tax Refunds', type: 'asset', subType: 'current_asset', detailType: 'Tax recoverable' },
  { code: '2400', name: 'Payroll Liabilities', type: 'liability', subType: 'current_liability', detailType: 'Payroll liabilities' },
  { code: '2500', name: 'Loans Payable', type: 'liability', subType: 'long_term_liability', detailType: 'Loans payable' },
  { code: '3000', name: "Owner's Capital", type: 'equity', subType: 'owners_equity', detailType: "Owner's equity" },
  { code: '3100', name: 'Retained Earnings', type: 'equity', subType: 'retained_earnings', detailType: 'Retained earnings' },
  { code: '3900', name: "Owner's Draw", type: 'equity', subType: 'owners_equity', detailType: "Owner's equity" },
  // Phase 0 (P0-8): Opening Balance Equity gets its OWN code. The
  // opening-balance route used to get-or-create code 3900 AS
  // "Opening Balance Equity", hijacking Owner's Draw in the template.
  { code: '3950', name: 'Opening Balance Equity', type: 'equity', subType: 'owners_equity', detailType: 'Opening balance offset' },
  { code: '4000', name: 'Product Sales', type: 'income', detailType: 'Product sales' },
  { code: '4100', name: 'Service Revenue', type: 'income', detailType: 'Service revenue' },
  { code: '4908', name: 'Other Income', type: 'income', detailType: 'Other income' },
  { code: '4310', name: 'FX Gain (Realized)', type: 'income', detailType: 'Other income' },
  { code: '4320', name: 'FX Gain/Loss (Unrealized)', type: 'income', detailType: 'Other income' },
  { code: '4390', name: 'FX Rounding', type: 'income', detailType: 'Other income' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense', detailType: 'COGS' },
  { code: '6100', name: 'Software & Subscriptions', type: 'expense', detailType: 'Dues & subscriptions' },
  { code: '6200', name: 'Professional Fees', type: 'expense', detailType: 'Professional fees' },
  { code: '6300', name: 'Rent & Lease', type: 'expense', detailType: 'Rent & lease' },
  { code: '6400', name: 'Marketing', type: 'expense', detailType: 'Marketing' },
  { code: '6500', name: 'Travel', type: 'expense', detailType: 'Travel' },
  { code: '6600', name: 'Utilities', type: 'expense', detailType: 'Utilities' },
  { code: '6700', name: 'Meals & Entertainment', type: 'expense', detailType: 'Meals & entertainment' },
  { code: '6800', name: 'Office Supplies', type: 'expense', detailType: 'Office supplies' },
  { code: '6900', name: 'Bank Fees', type: 'expense', detailType: 'Bank charges' },
  { code: '6910', name: 'Insurance', type: 'expense', detailType: 'Insurance' },
  { code: '6920', name: 'Payroll Expense', type: 'expense', detailType: 'Payroll expenses' },
  { code: '6930', name: 'Repairs & Maintenance', type: 'expense', detailType: 'Repairs & maintenance' },
  { code: '6990', name: 'Miscellaneous Expense', type: 'expense', detailType: 'Other expense' },
];

export const FINANCIAL_ACCOUNT_KINDS = ['checking', 'savings', 'creditcard', 'payoutclearing'] as const;
export type FinancialAccountKind = (typeof FINANCIAL_ACCOUNT_KINDS)[number];

type ChartAccountClient = Pick<typeof db, 'chartOfAccount'>;

export function isFinancialAccountKind(value: unknown): value is FinancialAccountKind {
  return typeof value === 'string' && FINANCIAL_ACCOUNT_KINDS.includes(value as FinancialAccountKind);
}

export async function ensureDefaultChartOfAccounts(
  companyId: string,
  client: ChartAccountClient = db,
) {
  const defaultCodes = DEFAULT_CHART_OF_ACCOUNTS.map((account) => account.code);
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
  const missingAccounts = DEFAULT_CHART_OF_ACCOUNTS.filter(
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
