import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { reverseImport } from '@/lib/banking/import-service';

export const dynamic = 'force-dynamic';

/** POST /api/imports/[id]/reverse — reverse an import within its 24h window. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    await reverseImport({ companyId, importId: params.id, userId: userId ?? undefined });
    await auditLog(companyId, userId, 'import.reverse', 'StatementImport', params.id);

    return NextResponse.json({ data: { reversed: true } });
  } catch (err: any) {
    console.error('POST /api/imports/[id]/reverse error:', err);
    if (err.message?.includes('posted') || err.message?.includes('24-hour') || err.message?.includes('already been reversed')) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: err.message || 'Failed to reverse the import' }, { status: 500 });
  }
}
