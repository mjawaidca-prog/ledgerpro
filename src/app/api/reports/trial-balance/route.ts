import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
import { getGLActivity, endOfDay, toDebitCredit, fiscalYearStartFor, parseLocalDate } from '@/lib/reporting';
import type { GLType } from '@prisma/client';
export const dynamic = 'force-dynamic';

// ── Types ──

interface TBRow {
  code: string;
  name: string;
  type: string;
  detailType: string | null;
  gifiCode: string | null;
  debit: number;
  credit: number;
  priorDebit: number;
  priorCredit: number;
  changePctDebit: number;
  changePctCredit: number;
  direction: 'up' | 'down' | 'flat';
  favorable: boolean | null;
  hasActivity: boolean;
}

interface TBSection {
  rows: TBRow[];
  totalDebit: number;
  totalCredit: number;
  priorTotalDebit: number;
  priorTotalCredit: number;
  changePctDebit: number;
  changePctCredit: number;
  direction: 'up' | 'down' | 'flat';
  favorable: boolean | null;
}

// ── Helpers ──

function compareVal(current: number, prior: number): {
  priorAmount: number; changePct: number; direction: 'up' | 'down' | 'flat'; favorable: boolean | null;
} {
  const diff = current - prior;
  const pct = prior !== 0 ? Math.round((diff / Math.abs(prior)) * 1000) / 10 : (current !== 0 ? 100 : 0);
  const direction: 'up' | 'down' | 'flat' = diff > 0.005 ? 'up' : diff < -0.005 ? 'down' : 'flat';
  let favorable: boolean | null = null;
  if (direction !== 'flat') favorable = direction === 'up'; // for TB, increase = normal = favorable
  return { priorAmount: prior, changePct: pct, direction, favorable };
}

function compareSection(
  totalDebit: number, totalCredit: number,
  priorTotalDebit: number, priorTotalCredit: number
) {
  // Use the dominant side for comparison
  const dominant = Math.max(totalDebit, totalCredit);
  const priorDominant = Math.max(priorTotalDebit, priorTotalCredit);
  return {
    priorTotalDebit, priorTotalCredit,
    changePctDebit: priorTotalDebit !== 0 ? Math.round(((totalDebit - priorTotalDebit) / Math.abs(priorTotalDebit)) * 1000) / 10 : (totalDebit !== 0 ? 100 : 0),
    changePctCredit: priorTotalCredit !== 0 ? Math.round(((totalCredit - priorTotalCredit) / Math.abs(priorTotalCredit)) * 1000) / 10 : (totalCredit !== 0 ? 100 : 0),
    direction: (dominant - priorDominant > 0.005 ? 'up' : dominant - priorDominant < -0.005 ? 'down' : 'flat') as 'up' | 'down' | 'flat',
    favorable: (dominant !== priorDominant ? (dominant > priorDominant) : null) as boolean | null,
  };
}

async function buildTrialBalance(companyId: string, asOfDate: Date) {
  const [accounts, activity] = await Promise.all([
    db.chartOfAccount.findMany({ where: { active: true, companyId }, orderBy: { code: 'asc' } }),
    getGLActivity(companyId, { to: asOfDate }),
  ]);

  const rows: Omit<TBRow, 'priorDebit' | 'priorCredit' | 'changePctDebit' | 'changePctCredit' | 'direction' | 'favorable'>[] = accounts.map((acct) => {
    const act = activity[acct.code];
    const { debit, credit } = toDebitCredit(acct.type as GLType, act);
    return {
      code: acct.code, name: acct.name, type: acct.type, detailType: acct.detailType, gifiCode: acct.gifiCode,
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      hasActivity: !!act && (act.debits > 0 || act.credits > 0),
    };
  });

  const typeOrder = ['asset', 'liability', 'equity', 'income', 'expense'];
  const grouped: Record<string, typeof rows> = {};
  for (const row of rows) {
    if (!grouped[row.type]) grouped[row.type] = [];
    grouped[row.type].push(row);
  }

  const totalDebits = Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100;
  const totalCredits = Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.02;

  return { rows, grouped, typeOrder, totalDebits, totalCredits, isBalanced, accountCount: rows.length };
}

type RawTB = Awaited<ReturnType<typeof buildTrialBalance>>;

// ── Route ──

export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const asOfParam = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    const compare = searchParams.get('compare') || 'none';

    const asOfDate = endOfDay(parseLocalDate(asOfParam));
    const asOf = asOfDate.toISOString().slice(0, 10);

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { name: true, legalName: true, fiscalYearStart: true, currency: true },
    });
    const currency = company?.currency || 'USD';

    const current = await buildTrialBalance(companyId, asOfDate);

    // ── Comparison ──
    let priorRaw: RawTB | null = null;
    let comparisonLabel = '';
    let comparisonMode = 'none';

    if (compare === 'prior_year' || compare === 'prior_period') {
      comparisonMode = compare;
      let priorDate: Date;
      if (compare === 'prior_year') {
        priorDate = new Date(asOfDate);
        priorDate.setFullYear(priorDate.getFullYear() - 1);
      } else {
        // prior_period: previous period of equal duration
        const fyAnchor = company?.fiscalYearStart ?? new Date(new Date().getFullYear(), 0, 1);
        const fyStart = fiscalYearStartFor(fyAnchor, asOfDate);
        const durationMs = asOfDate.getTime() - fyStart.getTime();
        priorDate = new Date(fyStart.getTime() - 86400000); // day before FY start
      }
      comparisonLabel = priorDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      priorRaw = await buildTrialBalance(companyId, priorDate);
    }

    // ── Build sections with comparison ──
    const priorMap = new Map<string, { debit: number; credit: number }>();
    if (priorRaw) {
      for (const r of priorRaw.rows) priorMap.set(r.code, { debit: r.debit, credit: r.credit });
    }

    const sections: Record<string, TBSection> = {};
    for (const type of current.typeOrder) {
      const rows = current.grouped[type] || [];
      if (rows.length === 0) continue;

      const enriched: TBRow[] = rows.map(r => {
        const prior = priorMap.get(r.code) || { debit: 0, credit: 0 };
        const debitCmp = compareVal(r.debit, prior.debit);
        const creditCmp = compareVal(r.credit, prior.credit);
        // Use whichever side has activity for direction/favorability
        const hasDebit = r.debit !== 0 || prior.debit !== 0;
        return {
          ...r,
          priorDebit: Math.round(prior.debit * 100) / 100,
          priorCredit: Math.round(prior.credit * 100) / 100,
          changePctDebit: debitCmp.changePct,
          changePctCredit: creditCmp.changePct,
          direction: hasDebit ? debitCmp.direction : creditCmp.direction,
          favorable: hasDebit ? debitCmp.favorable : creditCmp.favorable,
        };
      });

      const totalDebit = enriched.reduce((s, r) => s + r.debit, 0);
      const totalCredit = enriched.reduce((s, r) => s + r.credit, 0);
      const priorTotalDebit = enriched.reduce((s, r) => s + r.priorDebit, 0);
      const priorTotalCredit = enriched.reduce((s, r) => s + r.priorCredit, 0);

      sections[type] = {
        rows: enriched,
        totalDebit: Math.round(totalDebit * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
        ...compareSection(totalDebit, totalCredit, priorTotalDebit, priorTotalCredit),
      };
    }

    const totalDebits = Math.round(current.totalDebits * 100) / 100;
    const totalCredits = Math.round(current.totalCredits * 100) / 100;

    const periodLabel = asOfDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    return NextResponse.json({
      data: {
        companyName: company?.legalName || company?.name || '',
        currency,
        period: { asOf, label: periodLabel },
        comparisonLabel,
        comparisonMode,
        generatedAt: new Date().toISOString(),
        sections,
        totalDebits,
        totalCredits,
        isBalanced: current.isBalanced,
        accountCount: current.accountCount,
      },
    });
  } catch (error) {
    console.error('GET /api/reports/trial-balance error:', error);
    return NextResponse.json({ error: 'Failed to generate trial balance' }, { status: 500 });
  }
}
