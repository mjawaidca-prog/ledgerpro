import { db } from '@/lib/db';

export type DefaultChartAccount = {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  detailType?: string;
  parentCode?: string;
  description?: string;
  active?: boolean;
};

export const DEFAULT_CHART_OF_ACCOUNTS: readonly DefaultChartAccount[] = [
  { code: '1000', name: 'Bank Accounts', type: 'asset', detailType: 'Bank', description: 'Cash and bank accounts' },
  { code: '1010', name: 'Business Checking', type: 'asset', detailType: 'Bank', parentCode: '1000', description: 'Primary operating account' },
  { code: '1020', name: 'Business Savings', type: 'asset', detailType: 'Savings', parentCode: '1000', description: 'Reserve or savings account' },
  { code: '1030', name: 'Undeposited Funds', type: 'asset', detailType: 'Undeposited funds', parentCode: '1000' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset', detailType: 'Accounts receivable' },
  { code: '1200', name: 'Prepaid Expenses', type: 'asset', detailType: 'Prepaid expenses' },
  { code: '1500', name: 'Furniture & Equipment', type: 'asset', detailType: 'Fixed assets' },
  { code: '2000', name: 'Credit Cards', type: 'liability', detailType: 'Credit card' },
  { code: '2110', name: 'Business Credit Card', type: 'liability', detailType: 'Credit card', parentCode: '2000' },
  { code: '2200', name: 'Accounts Payable', type: 'liability', detailType: 'Accounts payable' },
  { code: '2300', name: 'Sales Tax Payable', type: 'liability', detailType: 'Sales tax payable' },
  { code: '2400', name: 'Payroll Liabilities', type: 'liability', detailType: 'Payroll liabilities' },
  { code: '2500', name: 'Loans Payable', type: 'liability', detailType: 'Loans payable' },
  { code: '3000', name: "Owner's Capital", type: 'equity', detailType: "Owner's equity" },
  { code: '3100', name: 'Retained Earnings', type: 'equity', detailType: 'Retained earnings' },
  { code: '3900', name: "Owner's Draw", type: 'equity', detailType: "Owner's equity" },
  { code: '4000', name: 'Product Sales', type: 'income', detailType: 'Product sales' },
  { code: '4100', name: 'Service Revenue', type: 'income', detailType: 'Service revenue' },
  { code: '4908', name: 'Other Income', type: 'income', detailType: 'Other income' },
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
  const missingAccounts = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => !existingCodes.has(account.code));

  if (missingAccounts.length === 0) {
    return { created: 0 };
  }

  const result = await client.chartOfAccount.createMany({
    data: missingAccounts.map((account) => ({
      companyId,
      code: account.code,
      name: account.name,
      type: account.type,
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
