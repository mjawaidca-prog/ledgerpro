/**
 * Elimination derivation for consolidated reports.
 *
 * IMPORTANT: amounts come from the same *translated activity feed* that
 * builds the statement — never from reconcile()'s raw native-currency
 * Prisma.Decimal balances — so the due-from/due-to pair nets to exactly zero
 * in the consolidated column and columns tie to the cent.
 *
 * reconcile() (src/lib/intercompany/reconcile.ts) remains the source of
 * truth for the single-company intercompany reconciliation screen; this
 * module re-derives matched/break status from translated balances, which is
 * also the only place cross-currency pairs can be judged.
 */

import { round2 } from './rounding';
import type { EliminationEntry, EntityLine, ManualElimination } from './types';

/** Link metadata the engine hands in (control-account ids already resolved to codes). */
export interface EliminationLink {
  id: string;
  companyAId: string;
  companyBId: string;
  aName: string;
  bName: string;
  aOwnershipOfB: number; // % A holds of B
  bOwnershipOfA: number; // % B holds of A
  aDueFromCode: string | null;
  aDueToCode: string | null;
  bDueFromCode: string | null;
  bDueToCode: string | null;
}

/** Signed per-line effects: companyId → code → amount (usually negative). */
export type EliminationEffects = Record<string, Record<string, number>>;

export interface DerivationResult {
  entries: EliminationEntry[];
  effects: EliminationEffects;
  warnings: { code: string; message: string }[];
}

function amountOf(linesByCompany: Record<string, EntityLine[]>, companyId: string, code: string): number {
  const line = linesByCompany[companyId]?.find((l) => l.code === code);
  return line ? line.amount : 0;
}

function addEffect(effects: EliminationEffects, companyId: string, code: string, amount: number) {
  if (!effects[companyId]) effects[companyId] = {};
  effects[companyId][code] = (effects[companyId][code] ?? 0) + amount;
}

/**
 * Derive automatic eliminations for every active related-party link whose
 * BOTH endpoints are in the selected set. Also eliminates investments in
 * subsidiaries against the subsidiary's share capital when one side holds
 * 100% of the other.
 */
export function deriveEliminations(
  links: EliminationLink[],
  selectedIds: string[],
  linesByCompany: Record<string, EntityLine[]>,
  currencyOf: Record<string, string>,
  presentationCurrency: string
): DerivationResult {
  const entries: EliminationEntry[] = [];
  const effects: EliminationEffects = {};
  const warnings: DerivationResult['warnings'] = [];

  const selected = new Set(selectedIds);
  let refCounter = 0;
  const nextRef = () => `ELIM-${String(++refCounter).padStart(2, '0')}`;

  const linksInScope = links.filter((l) => selected.has(l.companyAId) && selected.has(l.companyBId));

  // 1. Intercompany receivables/payables.
  for (const link of linksInScope) {
    const aFrom = link.aDueFromCode ? amountOf(linesByCompany, link.companyAId, link.aDueFromCode) : 0;
    const aTo = link.aDueToCode ? amountOf(linesByCompany, link.companyAId, link.aDueToCode) : 0;
    const bFrom = link.bDueFromCode ? amountOf(linesByCompany, link.companyBId, link.bDueFromCode) : 0;
    const bTo = link.bDueToCode ? amountOf(linesByCompany, link.companyBId, link.bDueToCode) : 0;

    const m1 = Math.min(aFrom, bTo);
    const m2 = Math.min(bFrom, aTo);
    const total = m1 + m2;
    const difference = Math.abs(aFrom - bTo) + Math.abs(bFrom - aTo);

    if (total < 0.005 && difference < 0.005) continue; // nothing to eliminate

    const sameCurrency =
      (currencyOf[link.companyAId] ?? presentationCurrency) === presentationCurrency &&
      (currencyOf[link.companyBId] ?? presentationCurrency) === presentationCurrency;
    const tolerance = sameCurrency ? 0.005 : 0.01;
    const status = difference <= tolerance ? 'matched' : 'break';

    if (total >= 0.005) {
      const accounts = [];
      if (link.aDueFromCode && m1 >= 0.005)
        accounts.push({ companyId: link.companyAId, glAccountCode: link.aDueFromCode, debit: 0, credit: round2(m1) });
      if (link.bDueToCode && m1 >= 0.005)
        accounts.push({ companyId: link.companyBId, glAccountCode: link.bDueToCode, debit: round2(m1), credit: 0 });
      if (link.bDueFromCode && m2 >= 0.005)
        accounts.push({ companyId: link.companyBId, glAccountCode: link.bDueFromCode, debit: 0, credit: round2(m2) });
      if (link.aDueToCode && m2 >= 0.005)
        accounts.push({ companyId: link.companyAId, glAccountCode: link.aDueToCode, debit: round2(m2), credit: 0 });

      entries.push({
        id: `link-${link.id}`,
        ref: nextRef(),
        description: `Due from / due to — ${link.aName} ↔ ${link.bName}`,
        source: 'auto',
        amount: round2(total),
        accounts,
        status,
        difference: status === 'break' ? round2(difference) : 0,
        appliesTo: ['balance-sheet', 'trial-balance'],
      });

      // Column effects — each matched pair reduces both sides to zero net.
      if (link.aDueFromCode) addEffect(effects, link.companyAId, link.aDueFromCode, -m1);
      if (link.bDueToCode) addEffect(effects, link.companyBId, link.bDueToCode, -m1);
      if (link.bDueFromCode) addEffect(effects, link.companyBId, link.bDueFromCode, -m2);
      if (link.aDueToCode) addEffect(effects, link.companyAId, link.aDueToCode, -m2);
    } else if (status === 'break') {
      // Break with nothing matched (e.g. one-sided legacy entry): still surface it.
      entries.push({
        id: `link-${link.id}`,
        ref: nextRef(),
        description: `Due from / due to — ${link.aName} ↔ ${link.bName}`,
        source: 'auto',
        amount: 0,
        accounts: [],
        status,
        difference: round2(difference),
        appliesTo: ['balance-sheet', 'trial-balance'],
      });
    }
  }

  // 2. Investment in subsidiaries vs the subsidiary's share capital
  //    (only where one side holds 100% of the other; A-holds-B wins when both
  //    sides claim 100% — avoids double elimination). Goodwill excess is
  //    judged at GROUP level — one warning if total investment exceeds total
  //    subsidiary share capital — never per link.
  const isInvestment = (l: EntityLine) =>
    l.type === 'asset' && !l.isControlAccount && /investment/i.test(l.name);
  const isShareCapital = (l: EntityLine) =>
    l.type === 'equity' && (l.subType === 'common_shares' || /share capital|common share/i.test(l.name));

  const heldToHolder = new Map<string, string>(); // held companyId → holder companyId
  for (const link of linksInScope) {
    const aHolds = Number(link.aOwnershipOfB) >= 100;
    const bHolds = Number(link.bOwnershipOfA) >= 100;
    if (!aHolds && !bHolds) continue;
    const holderId = aHolds ? link.companyAId : link.companyBId;
    const heldId = aHolds ? link.companyBId : link.companyAId;
    if (!heldToHolder.has(heldId)) heldToHolder.set(heldId, holderId);
  }

  const investmentsByHolder = new Map<string, EntityLine[]>();
  const sharesByHeld = new Map<string, EntityLine[]>();
  for (const [heldId, holderId] of heldToHolder) {
    if (!investmentsByHolder.has(holderId)) {
      investmentsByHolder.set(holderId, (linesByCompany[holderId] ?? []).filter(isInvestment));
    }
    if (!sharesByHeld.has(heldId)) {
      sharesByHeld.set(heldId, (linesByCompany[heldId] ?? []).filter(isShareCapital));
    }
  }

  const sumPositive = (lines: EntityLine[]) => lines.reduce((s, l) => s + Math.max(0, l.amount), 0);
  const totalInvestment = [...investmentsByHolder.values()].reduce((s, l) => s + sumPositive(l), 0);
  const totalShare = [...sharesByHeld.values()].reduce((s, l) => s + sumPositive(l), 0);

  for (const [heldId, holderId] of heldToHolder) {
    const investments = investmentsByHolder.get(holderId) ?? [];
    const shareCapital = sharesByHeld.get(heldId) ?? [];
    const invTotal = sumPositive(investments);
    const shareTotal = sumPositive(shareCapital);
    if (invTotal < 0.005 || shareTotal < 0.005) continue;

    const amount = Math.min(invTotal, shareTotal);

    // Eliminate against the largest share-capital line, then the investment
    // line that matches the amount (largest first).
    const targetShare = [...shareCapital].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
    let remaining = amount;
    const invAccounts: { companyId: string; glAccountCode: string; debit: number; credit: number }[] = [];
    for (const inv of investments.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))) {
      if (remaining < 0.005) break;
      const take = Math.min(remaining, Math.max(0, inv.amount));
      if (take >= 0.005) {
        invAccounts.push({ companyId: holderId, glAccountCode: inv.code, debit: 0, credit: round2(take) });
        addEffect(effects, holderId, inv.code, -take);
        remaining -= take;
      }
    }
    addEffect(effects, heldId, targetShare.code, -amount);
    invAccounts.push({ companyId: heldId, glAccountCode: targetShare.code, debit: round2(amount), credit: 0 });

    entries.push({
      id: `inv-${heldId}`,
      ref: nextRef(),
      description: 'Investment in subsidiaries against share capital',
      source: 'auto',
      amount: round2(amount),
      accounts: invAccounts,
      status: 'matched',
      difference: 0,
      appliesTo: ['balance-sheet', 'trial-balance'],
    });
  }

  if (totalInvestment - totalShare > 0.01) {
    warnings.push({
      code: 'goodwill',
      message: 'Investment in subsidiaries exceeds their share capital — goodwill on consolidation is not presented in v1.',
    });
  }

  return { entries, effects, warnings };
}

/**
 * Apply manual eliminations to the merged line set. Each elimination must be
 * balanced (debits = credits within 0.005) — the route validates and rejects
 * unbalanced input before this point.
 */
export function applyManualEliminations(
  lines: Map<string, { code: string; type: string }>,
  manualElims: ManualElimination[]
): { entries: EliminationEntry[]; effects: EliminationEffects } {
  const entries: EliminationEntry[] = [];
  const effects: EliminationEffects = {};

  manualElims.forEach((m, i) => {
    const debitTotal = m.accounts.reduce((s, a) => s + (Number(a.debit) || 0), 0);
    const creditTotal = m.accounts.reduce((s, a) => s + (Number(a.credit) || 0), 0);
    const amount = Math.max(debitTotal, creditTotal);

    for (const acc of m.accounts) {
      const line = lines.get(acc.glAccountCode);
      if (!line) continue;
      // Reduction = the side opposite the line's normal side.
      const isDebitNormal = line.type === 'asset' || line.type === 'expense';
      const reduction = isDebitNormal ? Number(acc.credit) || 0 : Number(acc.debit) || 0;
      addEffect(effects, acc.companyId, acc.glAccountCode, -reduction);
    }

    entries.push({
      id: `manual-${i}-${m.ref}`,
      ref: m.ref || `ADJ-${String(i + 1).padStart(2, '0')}`,
      description: m.description,
      source: 'manual',
      amount: round2(amount),
      accounts: m.accounts.map((a) => ({
        companyId: a.companyId,
        glAccountCode: a.glAccountCode,
        debit: Number(a.debit) || 0,
        credit: Number(a.credit) || 0,
      })),
      status: 'matched',
      difference: 0,
      appliesTo: m.appliesTo,
    });
  });

  return { entries, effects };
}

/**
 * Foreign currency translation reserve for each entity — the balancing plug
 * between the translated balance sheet and translated equity:
 *   fctr = Σassets@closing − Σliabilities@closing − Σequity@historical − CYE
 * (CYE = current-year earnings at average — passed in, computed from the
 * FY-to-date line feed). Emitted by the server as a real consolidated-only
 * line, never derived in the client.
 */
export function computeFctrByEntity(
  linesByCompany: Record<string, EntityLine[]>,
  cyeByEntity: Record<string, number>,
  companyIds: string[]
): Record<string, number> {
  const fctr: Record<string, number> = {};
  for (const companyId of companyIds) {
    const lines = linesByCompany[companyId] ?? [];
    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    for (const l of lines) {
      if (l.type === 'asset') assets += l.amount;
      else if (l.type === 'liability') liabilities += l.amount;
      else if (l.type === 'equity') equity += l.amount;
    }
    fctr[companyId] = assets - liabilities - equity - (cyeByEntity[companyId] ?? 0);
  }
  return fctr;
}

/** Current-year earnings (income − expense) per entity, translated at the average rate. */
export function computeCyeByEntity(
  linesByCompany: Record<string, EntityLine[]>,
  companyIds: string[]
): Record<string, number> {
  const cye: Record<string, number> = {};
  for (const companyId of companyIds) {
    let total = 0;
    for (const l of linesByCompany[companyId] ?? []) {
      if (l.type === 'income') total += l.amount;
      else if (l.type === 'expense') total -= l.amount;
    }
    cye[companyId] = total;
  }
  return cye;
}
