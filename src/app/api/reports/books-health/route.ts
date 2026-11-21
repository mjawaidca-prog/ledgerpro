import { NextRequest, NextResponse } from 'next/server';
import { requireCompany } from '@/lib/api-helpers';
import {
  assembleBooksHealth,
  dismissHealthFlag,
  restoreHealthFlag,
} from '@/lib/health/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/books-health
 *
 * The books-health checklist for the active company: the deterministic
 * anomaly & duplicate radar (src/lib/health/engine.ts) grouped as
 * Needs attention / Worth a look / Healthy, with reviewer dismissals
 * applied. Dismissed flags come back separately so the page can show
 * what was silenced and restore it.
 *
 * POST /api/reports/books-health  { fingerprint, reason }
 * Dismiss one flag with the reviewer's reason. The dismissal keys on
 * the flag's fingerprint, so it silences exactly that item.
 *
 * DELETE /api/reports/books-health?fingerprint=…
 * Restore a dismissed flag.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const { companyName, report, dismissed } = await assembleBooksHealth(companyId);
    return NextResponse.json({ data: { companyName, ...report, dismissed } });
  } catch (error) {
    console.error('GET /api/reports/books-health error:', error);
    return NextResponse.json({ error: 'Failed to run the books health check' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req);
    if (error) return error;

    const body = await req.json().catch(() => null);
    const fingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint : '';
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!/^[a-z_]+:[0-9a-f]{8}$/.test(fingerprint)) {
      return NextResponse.json({ error: 'A valid flag fingerprint is required' }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json(
        { error: 'A dismissal needs a reason — it stays on record with the flag.' },
        { status: 400 }
      );
    }

    await dismissHealthFlag({ companyId, userId: userId ?? null, fingerprint, reason });
    return NextResponse.json({ data: { dismissed: fingerprint } });
  } catch (error) {
    console.error('POST /api/reports/books-health error:', error);
    return NextResponse.json({ error: 'Failed to dismiss the flag' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const fingerprint = new URL(req.url).searchParams.get('fingerprint') ?? '';
    if (!/^[a-z_]+:[0-9a-f]{8}$/.test(fingerprint)) {
      return NextResponse.json({ error: 'A valid flag fingerprint is required' }, { status: 400 });
    }

    await restoreHealthFlag(companyId, fingerprint);
    return NextResponse.json({ data: { restored: fingerprint } });
  } catch (error) {
    console.error('DELETE /api/reports/books-health error:', error);
    return NextResponse.json({ error: 'Failed to restore the flag' }, { status: 500 });
  }
}
