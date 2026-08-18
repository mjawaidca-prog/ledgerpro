/**
 * Consolidation engine — orchestrates one consolidated report run.
 *
 * Pipeline: load companies (parent first) → per-entity GL activity + FX
 * translation (assets/liabilities at closing, equity at historical,
 * income/expense at average) → merge on code → derive + apply eliminations
 * (same translated feed, so columns tie to the cent) → inject CYE/FCTR
 * equity lines → presentation rounding → statement composer → notes.
 *
 * Never reads ChartOfAccount.balance — everything derives from journal
 * activity (getGLActivity), like the single-company report routes.
 */

import { db } from '@/lib/db';
import {
  getGLActivity,
  normalBalance,
  endOfDay,
  fiscalYearStartFor,
  parseLocalDate,
  formatReportPeriod,
} from '@/lib/reporting';
import { getDatedRate, getHistoricalRate, type RateResult } from './fx';
import { mergeEntityLines } from './merge';
import {
  deriveEliminations,
  applyManualEliminations,
  computeCyeByEntity,
  type EliminationEffects,
  type EliminationLink,
} from './eliminations';
import { composeStatement, type EntityAging, type EntityCashFlow } from './statements';
import { round2 } from './rounding';
import type {
  ConsolidatedLine,
  ConsolidatedReport,
  ConsolidatedStatement,
  EntityInfo,
  EntityLine,
  ManualElimination,
} from './types';

export class PartialOwnershipError extends Error {
  constructor() {
    super('Partial ownership is not supported yet — consolidate wholly owned companies only.');
    this.name = 'PartialOwnershipError';
  }
}

export class UnbalancedEliminationError extends Error {
  constructor() {
    super('Manual eliminations must balance — debits must equal credits.');
    this.name = 'UnbalancedEliminationError';
  }
}

export interface BuildOptions {
  statement: ConsolidatedStatement;
  companyIds: string[]; // parent FIRST — order is user-controlled, never re-sorted
  asOf: string; // YYYY-MM-DD
  from?: string; // YYYY-MM-DD, period statements only
  currency: string; // presentation currency
  eliminate: boolean;
  hideZero: boolean;
  excludeElim: string[];
  manualElims: ManualElimination[];
}

const POINT_IN_TIME: ConsolidatedStatement[] = [
  'balance-sheet',
  'trial-balance',
  'gst-summary',
  'gifi',
  'ar-aging',
  'ap-aging',
];

function shortCode(name: string, used: Set<string>): string {
  const words = name.split(/\s+/).filter((w) => /^[a-z0-9]/i.test(w));
  let code = words.slice(0, 3).map((w) => w[0]).join('').toUpperCase() || 'CO';
  let n = 2;
  while (used.has(code) && n < 10) {
    code = (words.slice(0, n).map((w) => w[0]).join('') || code).toUpperCase();
    n++;
  }
  used.add(code);
  return code;
}

function fyMonthDay(fiscalYearStart: Date, fiscalYearEnd: Date | null): string {
  if (fiscalYearEnd) return `${fiscalYearEnd.getUTCMonth()}-${fiscalYearEnd.getUTCDate()}`;
  // derive: start + 1 year − 1 day
  const d = new Date(fiscalYearStart);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCMonth()}-${d.getUTCDate()}`;
}

async function collectEntityCashFlow(
  companyId: string,
  fromDate: Date,
  toDate: Date,
  fxAverage: number
): Promise<EntityCashFlow> {
  const [paidInvoices, paidBills, transactions] = await Promise.all([
    db.invoice.findMany({
      where: { companyId, paidAt: { gte: fromDate, lte: toDate }, status: 'paid' },
      select: { paidAmount: true },
    }),
    db.bill.findMany({
      where: { companyId, paidAt: { gte: fromDate, lte: toDate }, status: 'paid' },
      select: { paidAmount: true },
    }),
    db.transaction.findMany({
      where: { companyId, date: { gte: fromDate, lte: toDate } },
      select: { amount: true, status: true },
    }),
  ]);

  const cashFromCustomers = paidInvoices.reduce((s, i) => s + Number(i.paidAmount ?? 0), 0);
  const cashPaidToVendors = paidBills.reduce((s, b) => s + Number(b.paidAmount ?? 0), 0);
  const operatingInflows = transactions
    .filter((t) => Number(t.amount) > 0 && t.status !== 'excluded')
    .reduce((s, t) => s + Number(t.amount), 0);
  const operatingOutflows = transactions
    .filter((t) => Number(t.amount) < 0 && t.status !== 'excluded')
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  const f = (x: number) => x * fxAverage;

  return {
    companyId,
    cashFromCustomers: f(cashFromCustomers),
    cashPaidToVendors: f(cashPaidToVendors),
    operatingInflows: f(operatingInflows),
    operatingOutflows: f(operatingOutflows),
    netOperatingCash: f(operatingInflows - operatingOutflows),
    netCashFlow: f(cashFromCustomers - cashPaidToVendors + operatingInflows - operatingOutflows),
  };
}

async function collectEntityAging(
  companyId: string,
  asOfDate: Date,
  fxClosing: number,
  kind: 'ar' | 'ap'
): Promise<EntityAging> {
  const rows =
    kind === 'ar'
      ? await db.invoice.findMany({
          where: { companyId, status: { in: ['sent', 'overdue'] } },
          select: { total: true, paidAmount: true, dueDate: true },
        })
      : await db.bill.findMany({
          where: { companyId, status: { in: ['open', 'overdue'] } },
          select: { total: true, paidAmount: true, dueDate: true },
        });

  const buckets: Record<string, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  let total = 0;

  for (const row of rows) {
    if (!row.dueDate) continue;
    const daysOverdue = Math.floor((asOfDate.getTime() - new Date(row.dueDate).getTime()) / 86400000);
    const remaining = (Number(row.total) - Number(row.paidAmount)) * fxClosing;
    let bucket: string;
    if (daysOverdue <= 0) bucket = 'current';
    else if (daysOverdue <= 30) bucket = '1-30';
    else if (daysOverdue <= 60) bucket = '31-60';
    else if (daysOverdue <= 90) bucket = '61-90';
    else bucket = '90+';
    buckets[bucket] += remaining;
    total += remaining;
  }

  return { companyId, buckets, total };
}

function applyEffects(lines: Map<string, ConsolidatedLine>, effects: EliminationEffects) {
  // Entity columns stay RAW; every effect accumulates into the line's
  // Eliminations column (signed, usually negative). consolidated is then
  // Σ raw entity cells + elimination — matching the statement layout.
  for (const byCode of Object.values(effects)) {
    for (const [code, amount] of Object.entries(byCode)) {
      const line = lines.get(code);
      if (!line) continue;
      line.elimination += amount;
    }
  }
}

export async function buildConsolidatedReport(opts: BuildOptions): Promise<ConsolidatedReport> {
  const { statement, companyIds, currency, eliminate, hideZero, excludeElim, manualElims } = opts;

  const asOfDate = endOfDay(parseLocalDate(opts.asOf));
  const fromDate = opts.from ? parseLocalDate(opts.from) : null;
  const isPointInTime = POINT_IN_TIME.includes(statement);

  // ── Companies (parent first) ──────────────────────────────
  const companyRows = await db.company.findMany({
    where: { id: { in: companyIds } },
    select: {
      id: true, name: true, legalName: true,
      fiscalYearStart: true, fiscalYearEnd: true, currency: true,
    },
  });
  const companyById = new Map(companyRows.map((c) => [c.id, c]));
  const companies = companyIds
    .map((id) => companyById.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  if (!companies.length) throw new Error('No companies found for the selected ids.');
  const parent = companies[0];
  const parentFy = fiscalYearStartFor(parent.fiscalYearStart, asOfDate);
  const parentFyEndMd = fyMonthDay(parent.fiscalYearStart, parent.fiscalYearEnd);
  const groupName = `${parent.legalName || parent.name} Group`;

  // ── Related-party links (both ends selected) ──────────────
  const linkRows = await db.relatedPartyLink.findMany({
    where: { isActive: true, companyAId: { in: companyIds }, companyBId: { in: companyIds } },
  });
  const linkById = new Map(linkRows.map((l) => [l.id, l]));

  // Partly-owned entities block v1 consolidation.
  if (eliminate) {
    for (const link of linkRows) {
      const aOwn = Number(link.aOwnershipOfB ?? 100);
      const bOwn = Number(link.bOwnershipOfA ?? 100);
      if ((aOwn > 0 && aOwn < 100) || (bOwn > 0 && bOwn < 100)) {
        throw new PartialOwnershipError();
      }
    }
  }

  // Control-account codes for the links in scope.
  const controlAccountIds = linkRows.flatMap((l) => [l.aDueFromAccountId, l.aDueToAccountId, l.bDueFromAccountId, l.bDueToAccountId]);
  const controlAccounts = await db.chartOfAccount.findMany({
    where: { id: { in: controlAccountIds } },
    select: { id: true, code: true },
  });
  const codeByAccountId = new Map(controlAccounts.map((a) => [a.id, a.code]));

  const links: EliminationLink[] = linkRows.map((l) => ({
    id: l.id,
    companyAId: l.companyAId,
    companyBId: l.companyBId,
    aName: companyById.get(l.companyAId)?.name || '',
    bName: companyById.get(l.companyBId)?.name || '',
    aOwnershipOfB: Number(l.aOwnershipOfB ?? 100),
    bOwnershipOfA: Number(l.bOwnershipOfA ?? 100),
    aDueFromCode: codeByAccountId.get(l.aDueFromAccountId) ?? null,
    aDueToCode: codeByAccountId.get(l.aDueToAccountId) ?? null,
    bDueFromCode: codeByAccountId.get(l.bDueFromAccountId) ?? null,
    bDueToCode: codeByAccountId.get(l.bDueToAccountId) ?? null,
  }));

  // ── Per-entity activity + translation ─────────────────────
  const range = isPointInTime
    ? { to: asOfDate }
    : { from: fromDate ?? parentFy, to: asOfDate };
  const cyeRange = { from: parentFy, to: asOfDate };

  const linesByCompany: Record<string, EntityLine[]> = {};
  const yearLinesByCompany: Record<string, EntityLine[]> = {};
  const entityInfos: EntityInfo[] = [];
  const perEntityCashFlow: EntityCashFlow[] = [];
  const perEntityAging: EntityAging[] = [];
  const warnings: ConsolidatedReport['warnings'] = [];
  const usedCodes = new Set<string>();

  for (const company of companies) {
    const isFx = company.currency !== currency;

    let closing: RateResult = { rate: 1, source: 'none' };
    let average: RateResult = { rate: 1, source: 'none' };
    let historical: RateResult = { rate: 1, source: 'none' };

    if (isFx) {
      closing = await getDatedRate(company.currency, currency, asOfDate, 'closing');
      average = await getDatedRate(company.currency, currency, asOfDate, 'average');
      const parentLink = linkRows.find(
        (l) =>
          (l.companyAId === parent.id && l.companyBId === company.id) ||
          (l.companyBId === parent.id && l.companyAId === company.id)
      );
      const refDate = parentLink ? parentLink.createdAt : parentFy;
      historical = await getHistoricalRate(company.currency, currency, refDate, closing);
      if (closing.source === 'fallback' || average.source === 'fallback' || historical.source === 'fallback') {
        warnings.push({
          code: 'fx_fallback',
          message: `${company.name} used indicative rates (no dated rate found) — closing ${closing.rate}, average ${average.rate}.`,
        });
      }
    }

    const rateFor = (type: EntityLine['type']): number =>
      type === 'asset' || type === 'liability' ? closing.rate : type === 'equity' ? historical.rate : average.rate;

    const [coa, activity, yearActivity] = await Promise.all([
      db.chartOfAccount.findMany({ where: { companyId: company.id, active: true }, orderBy: { code: 'asc' } }),
      getGLActivity(company.id, range),
      isPointInTime ? getGLActivity(company.id, cyeRange) : Promise.resolve({} as Record<string, { debits: number; credits: number }>),
    ]);

    const buildLines = (sourceActivity: Record<string, { debits: number; credits: number }>): EntityLine[] =>
      coa.map((a) => ({
        code: a.code,
        name: a.name,
        gifiCode: a.gifiCode,
        type: a.type as EntityLine['type'],
        subType: a.subType,
        detailType: a.detailType,
        isControlAccount: a.isControlAccount,
        relatedPartyCompanyId: a.relatedPartyCompanyId,
        amount: normalBalance(a.type as EntityLine['type'], sourceActivity[a.code]) * rateFor(a.type as EntityLine['type']),
      }));

    linesByCompany[company.id] = buildLines(activity);
    if (isPointInTime) yearLinesByCompany[company.id] = buildLines(yearActivity);

    const entityMd = fyMonthDay(company.fiscalYearStart, company.fiscalYearEnd);

    // Held % — from the link between this entity and the parent.
    let held = '—';
    if (company.id === parent.id) {
      held = 'Parent';
    } else {
      const link = linkRows.find(
        (l) =>
          (l.companyAId === parent.id && l.companyBId === company.id) ||
          (l.companyBId === parent.id && l.companyAId === company.id)
      );
      if (link) {
        const pct = link.companyAId === parent.id ? Number(link.aOwnershipOfB ?? 100) : Number(link.bOwnershipOfA ?? 100);
        held = `${pct}%`;
      }
    }

    entityInfos.push({
      companyId: company.id,
      code: shortCode(company.name, usedCodes),
      name: company.name,
      currency: company.currency,
      fxRate: isFx ? closing.rate : null,
      fxRateType: 'closing',
      fxSource: closing.source,
      fiscalYearEnd: company.fiscalYearEnd ? company.fiscalYearEnd.toISOString().slice(0, 10) : null,
      recut: entityMd !== parentFyEndMd,
      held,
    });

    if (statement === 'cash-flow') {
      perEntityCashFlow.push(await collectEntityCashFlow(company.id, fromDate ?? parentFy, asOfDate, average.rate));
    }
    if (statement === 'ar-aging' || statement === 'ap-aging') {
      perEntityAging.push(
        await collectEntityAging(company.id, asOfDate, closing.rate, statement === 'ar-aging' ? 'ar' : 'ap')
      );
    }
  }

  // ── Merge ─────────────────────────────────────────────────
  const merged = mergeEntityLines(companies.map((c) => ({ companyId: c.id, lines: linesByCompany[c.id] })));
  for (const w of merged.warnings) warnings.push(w);
  const lineMap = new Map<string, ConsolidatedLine>();
  for (const line of merged.lines) lineMap.set(line.code, line);

  // ── Eliminations ──────────────────────────────────────────
  const eliminations: ConsolidatedReport['eliminations'] = [];
  const currencyOf: Record<string, string> = {};
  for (const c of companies) currencyOf[c.id] = c.currency;

  if (eliminate) {
    const derived = deriveEliminations(links, companyIds, linesByCompany, currencyOf, currency);
    for (const entry of derived.entries) {
      if (excludeElim.includes(entry.id)) continue;
      eliminations.push(entry);
    }
    for (const w of derived.warnings) warnings.push(w);
    applyEffects(lineMap, derived.effects);
  }

  // Manual eliminations — only those applying to this statement.
  const statementManual = manualElims.filter((m) => m.appliesTo.includes(statement));
  if (statementManual.length) {
    for (const m of statementManual) {
      const debit = m.accounts.reduce((s, a) => s + (Number(a.debit) || 0), 0);
      const credit = m.accounts.reduce((s, a) => s + (Number(a.credit) || 0), 0);
      if (Math.abs(debit - credit) > 0.005) throw new UnbalancedEliminationError();
    }
    const manual = applyManualEliminations(lineMap, statementManual);
    eliminations.push(...manual.entries);
    applyEffects(lineMap, manual.effects);
  }

  // ── CYE + FCTR equity lines (balance sheet & trial balance) ──
  if (statement === 'balance-sheet' || statement === 'trial-balance') {
    const cyeByEntity = computeCyeByEntity(yearLinesByCompany, companyIds);
    const cyeLine: ConsolidatedLine = {
      code: 'CYE',
      name: 'Current Year Earnings',
      gifiCode: null,
      type: 'equity',
      subType: 'retained_earnings',
      detailType: null,
      byEntity: {},
      elimination: 0,
      consolidated: 0,
    };
    for (const id of companyIds) cyeLine.byEntity[id] = cyeByEntity[id] ?? 0;

    const fctrLine: ConsolidatedLine = {
      code: 'FX-TR',
      name: 'Foreign currency translation reserve',
      gifiCode: null,
      type: 'equity',
      subType: 'other_equity',
      detailType: null,
      byEntity: {},
      elimination: 0,
      consolidated: 0,
    };
    for (const company of companies) {
      const lines = linesByCompany[company.id] ?? [];
      const assets = lines.filter((l) => l.type === 'asset').reduce((s, l) => s + l.amount, 0);
      const liabilities = lines.filter((l) => l.type === 'liability').reduce((s, l) => s + l.amount, 0);
      const equity = lines.filter((l) => l.type === 'equity').reduce((s, l) => s + l.amount, 0);
      fctrLine.byEntity[company.id] = assets - liabilities - equity - (cyeByEntity[company.id] ?? 0);
    }

    if (!hideZero || Object.values(cyeLine.byEntity).some((v) => Math.abs(v) >= 0.005)) {
      lineMap.set('CYE', cyeLine);
    }
    if (Object.values(fctrLine.byEntity).some((v) => Math.abs(v) >= 0.005)) {
      lineMap.set('FX-TR', fctrLine);
    }
  }

  // ── Presentation rounding ─────────────────────────────────
  const allLines = [...lineMap.values()].sort((a, b) => {
    // injected equity lines sort after the 3xxx equity block
    const aKey = a.code === 'CYE' || a.code === 'FX-TR' ? '9' + a.code : a.code;
    const bKey = b.code === 'CYE' || b.code === 'FX-TR' ? '9' + b.code : b.code;
    return aKey.localeCompare(bKey);
  });

  for (const line of allLines) {
    for (const id of Object.keys(line.byEntity)) line.byEntity[id] = round2(line.byEntity[id]);
    line.elimination = round2(line.elimination);
    line.consolidated = round2(
      companyIds.reduce((s, id) => s + (line.byEntity[id] ?? 0), 0) + line.elimination
    );
  }

  const visible = hideZero
    ? allLines.filter((l) => {
        const anyEntity = Object.values(l.byEntity).some((v) => Math.abs(v) >= 0.005);
        return anyEntity || Math.abs(l.elimination) >= 0.005;
      })
    : allLines;

  // ── Compose ───────────────────────────────────────────────
  const composed = composeStatement({
    lines: visible,
    entityIds: companyIds,
    perEntityCashFlow,
    perEntityAging,
    statement,
    presentationCurrency: currency,
  });

  // ── Notes ─────────────────────────────────────────────────
  const notes: string[] = [];
  if (statement === 'balance-sheet') {
    notes.push('Consolidation covers wholly owned subsidiaries only. Non-controlling interests are not presented.');
  }
  const icTotal = eliminations
    .filter((e) => e.description.startsWith('Due from / due to'))
    .reduce((s, e) => s + e.amount, 0);
  const invTotal = eliminations
    .filter((e) => e.description.startsWith('Investment in subsidiaries'))
    .reduce((s, e) => s + e.amount, 0);
  if (icTotal > 0) {
    notes.push(`Intercompany receivables and payables of ${icTotal.toFixed(2)} ${currency} are eliminated in full against each other.`);
  }
  if (invTotal > 0) {
    notes.push(`Investment in subsidiaries of ${invTotal.toFixed(2)} ${currency} is eliminated against the subsidiaries' share capital.`);
  }
  for (const entity of entityInfos) {
    if (entity.fxRate !== null && entity.fxRate !== 1) {
      notes.push(
        `${entity.name} is translated to ${currency} at the closing rate of ${entity.fxRate.toFixed(4)}.`
      );
    }
  }
  const breaks = eliminations.filter((e) => e.status === 'break');
  for (const b of breaks) {
    notes.push(`Intercompany break of ${b.difference.toFixed(2)} ${currency} remains — ${b.description} does not net to zero.`);
  }
  if (statement === 'cash-flow') {
    notes.push('Intercompany cash transfers are not eliminated in the consolidated cash flow.');
  }
  if (statement === 'ar-aging' || statement === 'ap-aging') {
    notes.push('Intercompany balances are not eliminated in aging — contacts are not linked to companies in v1.');
  }
  if (eliminations.some((e) => e.source === 'manual')) {
    notes.push('Manual eliminations were applied to this statement.');
  }

  // Recut / future-date / earliest-entry warnings
  for (const entity of entityInfos) {
    if (entity.recut) {
      warnings.push({
        code: 'recut',
        message: `${entity.name} has a different year end — its figures are re-cut to the group period.`,
      });
    }
  }
  if (asOfDate > endOfDay(new Date())) {
    warnings.push({ code: 'future_asof', message: 'Includes entries dated after today.' });
  }
  const earliest = await db.journalEntry.findFirst({ orderBy: { entryDate: 'asc' }, select: { entryDate: true } });
  if (earliest && earliest.entryDate > asOfDate) {
    warnings.push({ code: 'early_asof', message: 'The report date is before the earliest journal entry — balances may all be zero.' });
  }

  // ── Assemble ──────────────────────────────────────────────
  const periodType: 'point-in-time' | 'period-range' = isPointInTime ? 'point-in-time' : 'period-range';
  const periodLabel = formatReportPeriod(
    periodType,
    asOfDate,
    fromDate && !isPointInTime ? fromDate : undefined
  );

  return {
    groupName,
    presentationCurrency: currency,
    statement,
    period: {
      asOf: opts.asOf,
      from: fromDate ? opts.from : undefined,
      label: periodLabel,
    },
    generatedAt: new Date().toISOString(),
    entities: entityInfos,
    sections: composed.sections,
    grandTotal: composed.grandTotal,
    eliminations,
    isBalanced: composed.isBalanced,
    outOfBalanceBy: composed.outOfBalanceBy,
    notes,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────
// Drill-down — per-entity contribution for one consolidated line
// ─────────────────────────────────────────────────────────────

export interface DrilldownRow {
  companyId: string;
  companyName: string;
  amount: number;
  elimination: number;
  consolidated: number;
}

export interface DrilldownResult {
  code: string;
  name: string;
  lines: DrilldownRow[];
}

/**
 * Rebuilds the per-entity amounts (and elimination share) for a single
 * account code so the client can show a group drill-down. Reuses the same
 * translated-activity pipeline as the report itself, so the numbers always
 * match the statement.
 */
export async function buildConsolidatedDrilldown(opts: {
  companyIds: string[];
  asOf: string;
  currency: string;
  code: string;
}): Promise<DrilldownResult> {
  const { companyIds, currency, code } = opts;
  const asOfDate = endOfDay(parseLocalDate(opts.asOf));

  const companyRows = await db.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, name: true, fiscalYearStart: true, fiscalYearEnd: true, currency: true },
  });
  const companyById = new Map(companyRows.map((c) => [c.id, c]));
  const companies = companyIds.map((id) => companyById.get(id)).filter(Boolean) as NonNullable<(typeof companyRows)[number]>[];
  const parent = companies[0];
  const parentFy = fiscalYearStartFor(parent.fiscalYearStart, asOfDate);

  const linkRows = await db.relatedPartyLink.findMany({
    where: { isActive: true, companyAId: { in: companyIds }, companyBId: { in: companyIds } },
  });
  const controlAccountIds = linkRows.flatMap((l) => [l.aDueFromAccountId, l.aDueToAccountId, l.bDueFromAccountId, l.bDueToAccountId]);
  const controlAccounts = await db.chartOfAccount.findMany({
    where: { id: { in: controlAccountIds } },
    select: { id: true, code: true },
  });
  const codeByAccountId = new Map(controlAccounts.map((a) => [a.id, a.code]));

  const links: EliminationLink[] = linkRows.map((l) => ({
    id: l.id,
    companyAId: l.companyAId,
    companyBId: l.companyBId,
    aName: companyById.get(l.companyAId)?.name || '',
    bName: companyById.get(l.companyBId)?.name || '',
    aOwnershipOfB: Number(l.aOwnershipOfB ?? 100),
    bOwnershipOfA: Number(l.bOwnershipOfA ?? 100),
    aDueFromCode: codeByAccountId.get(l.aDueFromAccountId) ?? null,
    aDueToCode: codeByAccountId.get(l.aDueToAccountId) ?? null,
    bDueFromCode: codeByAccountId.get(l.bDueFromAccountId) ?? null,
    bDueToCode: codeByAccountId.get(l.bDueToAccountId) ?? null,
  }));

  const linesByCompany: Record<string, EntityLine[]> = {};
  let lineName = code;

  for (const company of companies) {
    const isFx = company.currency !== currency;
    let closing: RateResult = { rate: 1, source: 'none' };
    let average: RateResult = { rate: 1, source: 'none' };
    let historical: RateResult = { rate: 1, source: 'none' };
    if (isFx) {
      closing = await getDatedRate(company.currency, currency, asOfDate, 'closing');
      average = await getDatedRate(company.currency, currency, asOfDate, 'average');
      const parentLink = linkRows.find(
        (l) =>
          (l.companyAId === parent.id && l.companyBId === company.id) ||
          (l.companyBId === parent.id && l.companyAId === company.id)
      );
      historical = await getHistoricalRate(company.currency, currency, parentLink ? parentLink.createdAt : parentFy, closing);
    }
    const rateFor = (type: EntityLine['type']): number =>
      type === 'asset' || type === 'liability' ? closing.rate : type === 'equity' ? historical.rate : average.rate;

    const [coa, activity] = await Promise.all([
      db.chartOfAccount.findMany({ where: { companyId: company.id, active: true }, orderBy: { code: 'asc' } }),
      getGLActivity(company.id, { to: asOfDate }),
    ]);

    linesByCompany[company.id] = coa.map((a) => {
      if (a.code === code) lineName = a.name;
      return {
        code: a.code,
        name: a.name,
        gifiCode: a.gifiCode,
        type: a.type as EntityLine['type'],
        subType: a.subType,
        detailType: a.detailType,
        isControlAccount: a.isControlAccount,
        relatedPartyCompanyId: a.relatedPartyCompanyId,
        amount: normalBalance(a.type as EntityLine['type'], activity[a.code]) * rateFor(a.type as EntityLine['type']),
      };
    });
  }

  const currencyOf: Record<string, string> = {};
  for (const c of companies) currencyOf[c.id] = c.currency;

  // Eliminations only for the requested code.
  const derived = deriveEliminations(links, companyIds, linesByCompany, currencyOf, currency);
  const effects = derived.effects;

  const rows: DrilldownRow[] = companies.map((company) => {
    const line = linesByCompany[company.id]?.find((l) => l.code === code);
    const amount = round2(line ? line.amount : 0);
    const elimination = round2(effects[company.id]?.[code] ?? 0);
    return {
      companyId: company.id,
      companyName: company.name,
      amount,
      elimination,
      consolidated: round2(amount + elimination),
    };
  });

  return { code, name: lineName, lines: rows };
}
