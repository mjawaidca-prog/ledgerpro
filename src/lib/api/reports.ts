// Public API (v1) report builders. These reuse the exact same GL primitives
// as the dashboard report routes (@/lib/reporting), so v1 numbers reconcile
// with the dashboard by construction — the reconciliation test suite asserts
// it with seeded data anyway.
//
// The v1 shapes are deliberately the accounting core: rows + totals. The
// dashboard adds prior-period comparisons and favorability arrows, which
// integrations don't need.

import { db } from '@/lib/db';
import {
  getGLActivity,
  normalBalance,
  toDebitCredit,
  endOfDay,
  fiscalYearStartFor,
  formatReportPeriod,
} from '@/lib/reporting';
import { moneyNumber } from '@/lib/api/serialize';
import type { GLType } from '@prisma/client';

export interface TbRow {
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
}

export interface TbReport {
  rows: TbRow[];
  totalDebit: string;
  totalCredit: string;
}

export async function buildTrialBalance(companyId: string, asOf: Date): Promise<TbReport> {
  const [accounts, activity] = await Promise.all([
    db.chartOfAccount.findMany({ where: { active: true, companyId }, orderBy: { code: 'asc' } }),
    getGLActivity(companyId, { to: endOfDay(asOf) }),
  ]);

  let totalDebit = 0;
  let totalCredit = 0;
  const rows: TbRow[] = accounts.map((acct) => {
    const { debit, credit } = toDebitCredit(acct.type as GLType, activity[acct.code]);
    totalDebit += debit;
    totalCredit += credit;
    return {
      code: acct.code,
      name: acct.name,
      type: acct.type,
      debit: moneyNumber(debit).toFixed(2),
      credit: moneyNumber(credit).toFixed(2),
    };
  });

  return {
    rows,
    totalDebit: moneyNumber(totalDebit).toFixed(2),
    totalCredit: moneyNumber(totalCredit).toFixed(2),
  };
}

export interface AccountLine {
  code: string;
  name: string;
  balance: string;
}

export interface BalanceSheetReport {
  assets: AccountLine[];
  liabilities: AccountLine[];
  equity: AccountLine[];
  currentYearEarnings: string;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  isBalanced: boolean;
}

export async function buildBalanceSheet(companyId: string, asOf: Date): Promise<BalanceSheetReport> {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { fiscalYearStart: true },
  });

  const activity = await getGLActivity(companyId, { to: endOfDay(asOf) });
  const fyStart = fiscalYearStartFor(company.fiscalYearStart, asOf);
  const yearActivity = await getGLActivity(companyId, { from: fyStart, to: endOfDay(asOf) });

  const accounts = await db.chartOfAccount.findMany({ where: { active: true, companyId }, orderBy: { code: 'asc' } });

  const line = (acct: { code: string; name: string; type: GLType }, act: typeof activity) => ({
    code: acct.code,
    name: acct.name,
    balance: moneyNumber(normalBalance(acct.type, act[acct.code])).toFixed(2),
  });

  const assets = accounts.filter((a) => a.type === 'asset').map((a) => line(a as any, activity));
  const liabilities = accounts.filter((a) => a.type === 'liability').map((a) => line(a as any, activity));
  const equityAccounts = accounts.filter((a) => a.type === 'equity').map((a) => line(a as any, activity));

  const sum = (rows: AccountLine[]) => rows.reduce((s, r) => s + Number(r.balance), 0);

  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const baseEquity = sum(equityAccounts);

  // Current-year earnings: income − expenses for the fiscal year to date —
  // the same derivation the dashboard balance sheet uses.
  const income = accounts.filter((a) => a.type === 'income');
  const expenses = accounts.filter((a) => a.type === 'expense');
  const currentYearEarnings = moneyNumber(
    income.reduce((s, a) => s + normalBalance(a.type, yearActivity[a.code]), 0) -
      expenses.reduce((s, a) => s + normalBalance(a.type, yearActivity[a.code]), 0)
  );

  const totalEquity = moneyNumber(baseEquity + currentYearEarnings);

  return {
    assets,
    liabilities,
    equity: equityAccounts,
    currentYearEarnings: currentYearEarnings.toFixed(2),
    totalAssets: moneyNumber(totalAssets).toFixed(2),
    totalLiabilities: moneyNumber(totalLiabilities).toFixed(2),
    totalEquity: totalEquity.toFixed(2),
    isBalanced: Math.abs(moneyNumber(totalAssets) - (moneyNumber(totalLiabilities) + totalEquity)) < 0.01,
  };
}

export interface PlRow {
  code: string;
  name: string;
  amount: string;
}

export interface PlSection {
  rows: PlRow[];
  total: string;
}

export interface PlReport {
  income: PlSection;
  costOfGoodsSold: PlSection;
  grossProfit: string;
  operatingExpenses: PlSection;
  netIncome: string;
}

export async function buildProfitLoss(companyId: string, from: Date, to: Date): Promise<PlReport> {
  const accounts = await db.chartOfAccount.findMany({ where: { active: true, companyId }, orderBy: { code: 'asc' } });
  const activity = await getGLActivity(companyId, { from, to: endOfDay(to) });

  const rowsFor = (predicate: (a: (typeof accounts)[number]) => boolean): PlRow[] =>
    accounts
      .filter(predicate)
      .map((a) => ({
        code: a.code,
        name: a.name,
        amount: moneyNumber(normalBalance(a.type, activity[a.code])).toFixed(2),
      }));

  // Matches the dashboard's COGS classification: detailType 'cogs' or code 5000.
  const isCogs = (a: { code: string; detailType: string | null }) =>
    (a.detailType ? a.detailType.trim().toLowerCase() === 'cogs' : false) || a.code === '5000';

  const income = rowsFor((a) => a.type === 'income');
  const cogs = rowsFor((a) => a.type === 'expense' && isCogs(a));
  const operatingExpenses = rowsFor((a) => a.type === 'expense' && !isCogs(a));

  const total = (rows: PlRow[]) => moneyNumber(rows.reduce((s, r) => s + Number(r.amount), 0));
  const incomeTotal = total(income);
  const cogsTotal = total(cogs);
  const opexTotal = total(operatingExpenses);
  const netIncome = moneyNumber(incomeTotal - cogsTotal - opexTotal);

  return {
    income: { rows: income, total: incomeTotal.toFixed(2) },
    costOfGoodsSold: { rows: cogs, total: cogsTotal.toFixed(2) },
    grossProfit: moneyNumber(incomeTotal - cogsTotal).toFixed(2),
    operatingExpenses: { rows: operatingExpenses, total: opexTotal.toFixed(2) },
    netIncome: netIncome.toFixed(2),
  };
}

export interface AgingBucket {
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
  total: string;
  count: number;
  documents: { id: string; contactName: string; dueDate: string | null; remaining: string }[];
}

export interface AgingReport {
  buckets: AgingBucket[];
  totalOutstanding: string;
}

/**
 * Shared aging math for AR (invoices) and AP (bills). Mirrors the dashboard
 * routes' bucket boundaries exactly: daysOverdue <= 0 → current, then 30/60/90.
 */
export function ageDocuments<T extends { id: string; dueDate: Date | null; total: unknown; paidAmount: unknown }>(
  documents: T[],
  asOf: Date,
  contactName: (doc: T) => string
): AgingReport {
  const buckets: AgingBucket[] = [
    { bucket: 'current', total: '0.00', count: 0, documents: [] },
    { bucket: '1-30', total: '0.00', count: 0, documents: [] },
    { bucket: '31-60', total: '0.00', count: 0, documents: [] },
    { bucket: '61-90', total: '0.00', count: 0, documents: [] },
    { bucket: '90+', total: '0.00', count: 0, documents: [] },
  ];

  let totalOutstanding = 0;
  for (const doc of documents) {
    // A missing due date means "not overdue" — it ages into the current bucket.
    const dueDate = doc.dueDate ?? asOf;
    const daysOverdue = Math.floor((asOf.getTime() - dueDate.getTime()) / 86400000);
    const remaining = moneyNumber(Number(doc.total) - Number(doc.paidAmount));
    const bucket = daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? '1-30' : daysOverdue <= 60 ? '31-60' : daysOverdue <= 90 ? '61-90' : '90+';
    const b = buckets.find((x) => x.bucket === bucket)!;
    b.total = moneyNumber(Number(b.total) + remaining).toFixed(2);
    b.count += 1;
    b.documents.push({
      id: doc.id,
      contactName: contactName(doc),
      dueDate: doc.dueDate ? doc.dueDate.toISOString() : null,
      remaining: remaining.toFixed(2),
    });
    totalOutstanding += remaining;
  }

  return { buckets, totalOutstanding: moneyNumber(totalOutstanding).toFixed(2) };
}

export async function buildArAging(companyId: string, asOf: Date): Promise<AgingReport> {
  const invoices = await db.invoice.findMany({
    where: { companyId, status: { in: ['sent', 'overdue'] } },
    include: { customer: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
  });
  return ageDocuments(invoices, asOf, (inv) => inv.customer.name);
}

export async function buildApAging(companyId: string, asOf: Date): Promise<AgingReport> {
  const bills = await db.bill.findMany({
    where: { companyId, status: { in: ['open', 'overdue'] } },
    include: { vendor: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
  });
  return ageDocuments(bills, asOf, (b) => b.vendor.name);
}

export { formatReportPeriod };
