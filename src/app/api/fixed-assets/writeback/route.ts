import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { toDollars } from '@/lib/loans/engine';
import { getCcaWritebackStatus, importCcaWriteback } from '@/lib/cca/writeback-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fixed-assets/writeback
 *
 * The write-back state for the Fixed Assets page: every imported
 * cca-writeback/1 record (versions kept), and for the latest one
 * the filed figures, the per-class variance against the register's
 * projection, and the proposed Schedule 1 journal with its state.
 * Read-only — importing is the POST below.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, error } = await requireCompany(req);
    if (error) return error;

    const status = await getCcaWritebackStatus(companyId);
    return NextResponse.json({ data: status });
  } catch (error) {
    console.error('GET /api/fixed-assets/writeback error:', error);
    return NextResponse.json({ error: 'Failed to load write-back status' }, { status: 500 });
  }
}

/**
 * POST /api/fixed-assets/writeback { payload }
 *
 * Import one cca-writeback/1 payload (the parsed JSON object, or
 * the raw JSON text). The payload is hash-verified and matched
 * against this company (id, business number, fiscal year) before
 * anything is stored; a second import for the same year versions
 * rather than replacing. Importing never posts anything — the
 * Sch 1 journal it carries stays a proposal until approved
 * through the post-journal route.
 */
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, {
      requireOnboarding: true,
      roles: ['owner', 'admin', 'bookkeeper'],
    });
    if (error) return error;

    const body = await req.json().catch(() => null);
    let payload: unknown = body?.payload ?? body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        return NextResponse.json(
          { error: 'The write-back payload is not valid JSON. Paste or upload the file exactly as Nexvar Tax produced it.' },
          { status: 400 }
        );
      }
    }
    if (payload == null || typeof payload !== 'object') {
      return NextResponse.json({ error: 'No write-back payload was provided.' }, { status: 400 });
    }

    const result = await importCcaWriteback(companyId, userId, payload);
    await auditLog(companyId, userId, 'fixed_asset.writeback.import', 'cca_writeback', result.recordId, {
      fiscalYear: result.fiscalYear.label,
      versioned: result.versioned,
      journalStatus: result.journalStatus,
      totalCcaClaimed: toDollars(result.totalCcaClaimedCents),
    });

    return NextResponse.json({
      data: {
        recordId: result.recordId,
        fiscalYear: result.fiscalYear,
        versioned: result.versioned,
        journalStatus: result.journalStatus,
        totalCcaClaimed: toDollars(result.totalCcaClaimedCents),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import the write-back';
    const status = /already on file/.test(message) ? 409 : 422;
    if (status === 422 && !message.startsWith('cca-writeback:')) {
      console.error('POST /api/fixed-assets/writeback error:', error);
    }
    return NextResponse.json({ error: message.replace(/^cca-writeback: /, '') }, { status });
  }
}
