import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { exportCompanyBundle } from '@/lib/backup';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;

    const bundle = await exportCompanyBundle(companyId);

    await auditLog(companyId, userId, 'company.export_backup', 'company', companyId);

    const fileName = `ledgerpro-backup-${bundle.company.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    console.error('GET /api/backup/export error:', error);
    return NextResponse.json({ error: error.message || 'Failed to export backup' }, { status: 500 });
  }
}
