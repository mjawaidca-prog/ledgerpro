/**
 * Statement composers — pure functions turning the merged, eliminated line
 * set into the sections/grandTotal/isBalanced shape of ConsolidatedReport.
 *
 * All inputs are already translated to the presentation currency and
 * presentation-rounded. Composers never query the database.
 */

import { round2 } from './rounding';
import type {
  ConsolidatedLine,
  ConsolidatedStatement,
  EliminationEntry,
  ReportSection,
} from './types';

export interface StatementResult {
  sections: ReportSection[];
  grandTotal: { byEntity: Record<string, number>; elimination: number; consolidated: number };
  isBalanced: boolean;
  outOfBalanceBy: number;
}

type GrandTotal = StatementResult['grandTotal'];

function emptyByEntity(entityIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of entityIds) out[id] = 0;
  return out;
}

function totalsOf(
  lines: ConsolidatedLine[],
  entityIds: string[]
): { byEntity: Record<string, number>; elimination: number; consolidated: number } {
  const byEntity = emptyByEntity(entityIds);
  let elimination = 0;
  let consolidated = 0;
  for (const line of lines) {
    for (const id of entityIds) byEntity[id] = round2(byEntity[id] + (line.byEntity[id] ?? 0));
    elimination = round2(elimination + line.elimination);
    consolidated = round2(consolidated + line.consolidated);
  }
  return { byEntity, elimination, consolidated };
}

function grandTotalFrom(
  totals: { byEntity: Record<string, number>; elimination: number; consolidated: number }
): GrandTotal {
  return { byEntity: { ...totals.byEntity }, elimination: totals.elimination, consolidated: totals.consolidated };
}

function addTotals(l: GrandTotal, r: GrandTotal): GrandTotal {
  const byEntity: Record<string, number> = {};
  for (const id of new Set([...Object.keys(l.byEntity), ...Object.keys(r.byEntity)])) {
    byEntity[id] = round2((l.byEntity[id] ?? 0) + (r.byEntity[id] ?? 0));
  }
  return {
    byEntity,
    elimination: round2(l.elimination + r.elimination),
    consolidated: round2(l.consolidated + r.consolidated),
  };
}

function section(key: string, label: string, lines: ConsolidatedLine[], entityIds: string[]): ReportSection {
  return { key, label, lines, totals: totalsOf(lines, entityIds) };
}

function isNearZero(x: number): boolean {
  return Math.abs(x) < 0.005;
}

// ─────────────────────────────────────────────────────────────
// Balance Sheet
// ─────────────────────────────────────────────────────────────

export function composeBalanceSheet(lines: ConsolidatedLine[], entityIds: string[]): StatementResult {
  const assets = lines.filter((l) => l.type === 'asset');
  const liabilities = lines.filter((l) => l.type === 'liability');
  const equity = lines.filter((l) => l.type === 'equity');

  const sections = [
    section('asset', 'Assets', assets, entityIds),
    section('liability', 'Liabilities', liabilities, entityIds),
    section('equity', 'Equity', equity, entityIds),
  ];

  const assetsTotal = sections[0].totals;
  const liabEquity = addTotals(sections[1].totals, sections[2].totals);

  const diff = assetsTotal.consolidated - liabEquity.consolidated;
  const isBalanced = Math.abs(diff) <= 0.02;

  return {
    sections,
    grandTotal: grandTotalFrom(liabEquity), // "Total liabilities and equity"
    isBalanced,
    outOfBalanceBy: round2(diff),
  };
}

// ─────────────────────────────────────────────────────────────
// Profit & Loss
// ─────────────────────────────────────────────────────────────

function isCogs(line: ConsolidatedLine): boolean {
  // Mirrors the single-company P&L route: detailType first, code heuristic second.
  if (line.detailType) return line.detailType.trim().toLowerCase() === 'cogs';
  return line.code === '5000';
}

export function composeProfitLoss(lines: ConsolidatedLine[], entityIds: string[]): StatementResult {
  const income = lines.filter((l) => l.type === 'income');
  const cogs = lines.filter((l) => l.type === 'expense' && isCogs(l));
  const opex = lines.filter((l) => l.type === 'expense' && !isCogs(l));

  const sections = [
    section('income', 'Income', income, entityIds),
    section('cogs', 'Cost of Goods Sold', cogs, entityIds),
    section('operating_expenses', 'Operating Expenses', opex, entityIds),
  ];

  // Net income = income − cogs − opex (expense lines carry normal-balance
  // positive sign, so subtract them).
  const netByEntity: Record<string, number> = {};
  for (const id of entityIds) {
    netByEntity[id] = round2(
      (sections[0].totals.byEntity[id] ?? 0) -
        (sections[1].totals.byEntity[id] ?? 0) -
        (sections[2].totals.byEntity[id] ?? 0)
    );
  }
  const netConsolidated = round2(
    sections[0].totals.consolidated - sections[1].totals.consolidated - sections[2].totals.consolidated
  );
  const netElim = round2(
    sections[0].totals.elimination - sections[1].totals.elimination - sections[2].totals.elimination
  );

  return {
    sections,
    grandTotal: { byEntity: netByEntity, elimination: netElim, consolidated: netConsolidated },
    isBalanced: true,
    outOfBalanceBy: 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Trial Balance
// ─────────────────────────────────────────────────────────────

export function composeTrialBalance(lines: ConsolidatedLine[], entityIds: string[]): StatementResult {
  const labels: Record<string, string> = {
    asset: 'Assets',
    liability: 'Liabilities',
    equity: 'Equity',
    income: 'Income',
    expense: 'Expenses',
  };
  const sections: ReportSection[] = [];
  let debitTotal: GrandTotal | null = null;
  let creditTotal: GrandTotal | null = null;

  for (const type of ['asset', 'liability', 'equity', 'income', 'expense'] as const) {
    const typeLines = lines.filter((l) => l.type === type);
    const sec = section(type, labels[type], typeLines, entityIds);
    sections.push(sec);
    // Debit side = assets + expenses (normal balance), credit side = the rest.
    if (type === 'asset' || type === 'expense') {
      debitTotal = debitTotal ? addTotals(debitTotal, sec.totals) : { ...sec.totals, byEntity: { ...sec.totals.byEntity } };
    } else {
      creditTotal = creditTotal ? addTotals(creditTotal, sec.totals) : { ...sec.totals, byEntity: { ...sec.totals.byEntity } };
    }
  }

  const diff = (debitTotal?.consolidated ?? 0) - (creditTotal?.consolidated ?? 0);
  const isBalanced = Math.abs(diff) <= 0.02;

  return {
    sections,
    grandTotal: debitTotal ? grandTotalFrom(debitTotal) : { byEntity: emptyByEntity(entityIds), elimination: 0, consolidated: 0 },
    isBalanced,
    outOfBalanceBy: round2(diff),
  };
}

// ─────────────────────────────────────────────────────────────
// Cash Flow (per-entity figures computed by the engine)
// ─────────────────────────────────────────────────────────────

export interface EntityCashFlow {
  companyId: string;
  cashFromCustomers: number;
  cashPaidToVendors: number;
  operatingInflows: number;
  operatingOutflows: number;
  netOperatingCash: number;
  netCashFlow: number;
}

export function composeCashFlow(
  perEntity: EntityCashFlow[],
  entityIds: string[],
  presentationCurrency: string
): StatementResult {
  const lines: ConsolidatedLine[] = [
    {
      code: 'CF-IN',
      name: 'Cash from customers',
      gifiCode: null,
      type: 'income',
      subType: null,
      detailType: null,
      byEntity: perEntity.reduce<Record<string, number>>((acc, e) => {
        acc[e.companyId] = round2(e.cashFromCustomers);
        return acc;
      }, {}),
      elimination: 0,
      consolidated: 0,
    },
    {
      code: 'CF-OUT',
      name: 'Cash paid to vendors',
      gifiCode: null,
      type: 'expense',
      subType: null,
      detailType: null,
      byEntity: perEntity.reduce<Record<string, number>>((acc, e) => {
        acc[e.companyId] = round2(e.cashPaidToVendors);
        return acc;
      }, {}),
      elimination: 0,
      consolidated: 0,
    },
    {
      code: 'CF-OPIN',
      name: 'Other operating inflows',
      gifiCode: null,
      type: 'income',
      subType: null,
      detailType: null,
      byEntity: perEntity.reduce<Record<string, number>>((acc, e) => {
        acc[e.companyId] = round2(e.operatingInflows);
        return acc;
      }, {}),
      elimination: 0,
      consolidated: 0,
    },
    {
      code: 'CF-OPOUT',
      name: 'Other operating outflows',
      gifiCode: null,
      type: 'expense',
      subType: null,
      detailType: null,
      byEntity: perEntity.reduce<Record<string, number>>((acc, e) => {
        acc[e.companyId] = round2(e.operatingOutflows);
        return acc;
      }, {}),
      elimination: 0,
      consolidated: 0,
    },
  ];
  for (const line of lines) {
    line.consolidated = round2(entityIds.reduce((s, id) => s + (line.byEntity[id] ?? 0), 0));
  }

  const netByEntity: Record<string, number> = {};
  for (const id of entityIds) {
    const e = perEntity.find((p) => p.companyId === id);
    netByEntity[id] = e ? round2(e.netCashFlow) : 0;
  }
  const netConsolidated = round2(entityIds.reduce((s, id) => s + (netByEntity[id] ?? 0), 0));

  return {
    sections: [section('operating', 'Operating activities', lines, entityIds)],
    grandTotal: { byEntity: netByEntity, elimination: 0, consolidated: netConsolidated },
    isBalanced: true,
    outOfBalanceBy: 0,
  };
}

// ─────────────────────────────────────────────────────────────
// GST/HST/PST summary
// ─────────────────────────────────────────────────────────────

export function composeGstSummary(lines: ConsolidatedLine[], entityIds: string[]): StatementResult {
  const taxLines = lines.filter(
    (l) => l.type === 'liability' && /gst|hst|pst|qst|sales tax/i.test(l.name)
  );
  const sec = section('tax_payable', 'Sales tax payable', taxLines, entityIds);
  return {
    sections: taxLines.length ? [sec] : [section('tax_payable', 'Sales tax payable', [], entityIds)],
    grandTotal: grandTotalFrom(sec.totals),
    isBalanced: true,
    outOfBalanceBy: 0,
  };
}

// ─────────────────────────────────────────────────────────────
// GIFI export (coded trial balance grouped by GIFI code)
// ─────────────────────────────────────────────────────────────

export function composeGifi(lines: ConsolidatedLine[], entityIds: string[]): StatementResult {
  // Exclude server-injected lines that have no GIFI mapping.
  const source = lines.filter((l) => l.code !== 'FX-TR' && l.code !== 'CYE');

  const grouped = new Map<string, ConsolidatedLine>();
  for (const line of source) {
    const key = line.gifiCode || 'UNMAPPED';
    let target = grouped.get(key);
    if (!target) {
      target = {
        code: key,
        name: key === 'UNMAPPED' ? 'Unmapped accounts' : line.name,
        gifiCode: line.gifiCode,
        type: line.type,
        subType: line.subType,
        detailType: null,
        byEntity: {},
        elimination: 0,
        consolidated: 0,
      };
      grouped.set(key, target);
    }
    for (const id of entityIds) {
      target.byEntity[id] = round2((target.byEntity[id] ?? 0) + (line.byEntity[id] ?? 0));
    }
    target.elimination = round2(target.elimination + line.elimination);
    target.consolidated = round2(target.consolidated + line.consolidated);
  }

  const labels: Record<string, string> = {
    asset: 'Assets',
    liability: 'Liabilities',
    equity: 'Equity',
    income: 'Income',
    expense: 'Expenses',
  };
  const sections: ReportSection[] = [];
  let grand: GrandTotal | null = null;
  for (const type of ['asset', 'liability', 'equity', 'income', 'expense'] as const) {
    const typeLines = [...grouped.values()].filter((l) => l.type === type).sort((a, b) => a.code.localeCompare(b.code));
    const sec = section(type, labels[type], typeLines, entityIds);
    sections.push(sec);
    grand = grand ? addTotals(grand, sec.totals) : { ...sec.totals, byEntity: { ...sec.totals.byEntity } };
  }

  return {
    sections,
    grandTotal: grand ? grandTotalFrom(grand) : { byEntity: emptyByEntity(entityIds), elimination: 0, consolidated: 0 },
    isBalanced: true,
    outOfBalanceBy: 0,
  };
}

// ─────────────────────────────────────────────────────────────
// AR / AP aging (per-entity buckets computed by the engine)
// ─────────────────────────────────────────────────────────────

export interface EntityAging {
  companyId: string;
  buckets: Record<string, number>; // current | 1-30 | 31-60 | 61-90 | 90+
  total: number;
}

export function composeAging(
  perEntity: EntityAging[],
  entityIds: string[],
  kind: 'ar' | 'ap'
): StatementResult {
  const bucketDefs = [
    { key: 'current', name: 'Current' },
    { key: '1-30', name: '1–30 days overdue' },
    { key: '31-60', name: '31–60 days overdue' },
    { key: '61-90', name: '61–90 days overdue' },
    { key: '90+', name: '90+ days overdue' },
  ];

  const lines: ConsolidatedLine[] = bucketDefs.map((b) => ({
    code: b.key,
    name: b.name,
    gifiCode: null,
    type: kind === 'ar' ? 'asset' : 'liability',
    subType: null,
    detailType: null,
    byEntity: perEntity.reduce<Record<string, number>>((acc, e) => {
      acc[e.companyId] = round2(e.buckets[b.key] ?? 0);
      return acc;
    }, {}),
    elimination: 0,
    consolidated: 0,
  }));
  for (const line of lines) {
    line.consolidated = round2(entityIds.reduce((s, id) => s + (line.byEntity[id] ?? 0), 0));
  }

  const totalByEntity: Record<string, number> = {};
  for (const id of entityIds) {
    const e = perEntity.find((p) => p.companyId === id);
    totalByEntity[id] = e ? round2(e.total) : 0;
  }
  const totalConsolidated = round2(entityIds.reduce((s, id) => s + (totalByEntity[id] ?? 0), 0));

  return {
    sections: [section('aging', kind === 'ar' ? 'Aged receivables' : 'Aged payables', lines, entityIds)],
    grandTotal: { byEntity: totalByEntity, elimination: 0, consolidated: totalConsolidated },
    isBalanced: true,
    outOfBalanceBy: 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────

export interface ComposerInput {
  lines: ConsolidatedLine[];
  entityIds: string[];
  perEntityCashFlow: EntityCashFlow[];
  perEntityAging: EntityAging[];
  statement: ConsolidatedStatement;
  presentationCurrency: string;
}

export function composeStatement(input: ComposerInput): StatementResult {
  const { statement } = input;
  if (statement === 'balance-sheet') return composeBalanceSheet(input.lines, input.entityIds);
  if (statement === 'profit-loss') return composeProfitLoss(input.lines, input.entityIds);
  if (statement === 'trial-balance') return composeTrialBalance(input.lines, input.entityIds);
  if (statement === 'cash-flow') return composeCashFlow(input.perEntityCashFlow, input.entityIds, input.presentationCurrency);
  if (statement === 'gst-summary') return composeGstSummary(input.lines, input.entityIds);
  if (statement === 'gifi') return composeGifi(input.lines, input.entityIds);
  if (statement === 'ar-aging') return composeAging(input.perEntityAging, input.entityIds, 'ar');
  return composeAging(input.perEntityAging, input.entityIds, 'ap');
}
