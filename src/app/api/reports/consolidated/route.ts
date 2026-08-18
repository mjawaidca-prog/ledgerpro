import { NextRequest, NextResponse } from 'next/server';
import { requireCompanies } from '@/lib/api-helpers';
import {
  buildConsolidatedReport,
  PartialOwnershipError,
  UnbalancedEliminationError,
} from '@/lib/consolidation/engine';
import {
  CONSOLIDATED_STATEMENTS,
  type ConsolidatedStatement,
  type ManualElimination,
} from '@/lib/consolidation/types';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/reports/consolidated
 * Multi-company consolidated statements. `manualElims` is a URL-encoded JSON
 * array (contract extension over the design handoff — the README defines the
 * shape in ConsolidatedSetup but no transport; validated strictly).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const statement = searchParams.get('statement') as ConsolidatedStatement | null;
    const companyIds = (searchParams.get('companyIds') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    const from = searchParams.get('from') ?? undefined;
    const currency = searchParams.get('currency') ?? 'CAD';
    const eliminate = searchParams.get('eliminate') !== '0';
    const hideZero = searchParams.get('hideZero') !== '0';
    const excludeElim = (searchParams.get('excludeElim') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // ── Authorization first — never run anything before every company is verified.
    const { error } = await requireCompanies(req, companyIds);
    if (error) return error;

    // ── Validation ──
    if (!statement || !CONSOLIDATED_STATEMENTS.includes(statement)) {
      return NextResponse.json({ error: 'Unknown statement type.' }, { status: 400 });
    }
    if (companyIds.length < 2) {
      return NextResponse.json({ error: 'Select at least two companies to consolidate.' }, { status: 400 });
    }
    if (companyIds.length > 12) {
      return NextResponse.json({ error: 'Consolidate at most 12 companies at a time.' }, { status: 400 });
    }
    if (!DATE_RE.test(asOf) || (from && !DATE_RE.test(from))) {
      return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
    }

    let manualElims: ManualElimination[] = [];
    const manualParam = searchParams.get('manualElims');
    if (manualParam) {
      try {
        manualElims = JSON.parse(manualParam);
        if (!Array.isArray(manualElims)) throw new Error('not an array');
      } catch {
        return NextResponse.json({ error: 'Invalid manualElims payload.' }, { status: 400 });
      }
    }

    const report = await buildConsolidatedReport({
      statement,
      companyIds,
      asOf,
      from,
      currency,
      eliminate,
      hideZero,
      excludeElim,
      manualElims,
    });

    return NextResponse.json({ data: report });
  } catch (err) {
    if (err instanceof PartialOwnershipError) {
      return NextResponse.json(
        { error: err.message, code: 'partial_ownership' },
        { status: 400 }
      );
    }
    if (err instanceof UnbalancedEliminationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('GET /api/reports/consolidated error:', err);
    return NextResponse.json({ error: 'Failed to generate consolidated report' }, { status: 500 });
  }
}
