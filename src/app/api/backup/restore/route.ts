import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { restoreCompanyBundle, BACKUP_FORMAT_VERSION } from '@/lib/backup';
export const dynamic = 'force-dynamic';

// POST — restore a previously exported backup into a brand-new company.
// This never overwrites an existing company's data.
export async function POST(req: NextRequest) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (error) return error;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { bundle, restoredName } = body as { bundle: any; restoredName?: string };

    if (!bundle || typeof bundle !== 'object') {
      return NextResponse.json({ error: 'No backup file provided' }, { status: 400 });
    }
    if (bundle.version !== BACKUP_FORMAT_VERSION) {
      return NextResponse.json(
        { error: `This backup file is format version ${bundle.version}, but this server expects version ${BACKUP_FORMAT_VERSION}.` },
        { status: 400 }
      );
    }

    const restored = await restoreCompanyBundle(bundle, userId, restoredName);

    await auditLog(companyId, userId, 'company.restore_backup', 'company', restored.id, { restoredFrom: bundle.company?.name });

    return NextResponse.json({ data: { companyId: restored.id, name: restored.name } }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/backup/restore error:', error);
    return NextResponse.json({ error: error.message || 'Failed to restore backup' }, { status: 500 });
  }
}
