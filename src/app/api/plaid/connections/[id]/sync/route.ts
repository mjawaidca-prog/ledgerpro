import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { syncConnection } from '@/lib/bank-feed/sync';
export const dynamic = 'force-dynamic';

// POST /api/plaid/connections/[id]/sync — manual "Sync now". The sync
// engine's lock makes overlapping invocations no-ops; failures surface in
// the sync log and (when enabled) as owner notifications.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireCompany(req, { roles: ['owner', 'admin', 'bookkeeper'] });
    if (session.error) return session.error;

    const connection = await db.bankConnection.findFirst({
      where: { id: params.id, companyId: session.companyId! },
      select: { id: true },
    });
    if (!connection) {
      return NextResponse.json({ error: 'Bank connection not found' }, { status: 404 });
    }

    await auditLog(session.companyId!, session.userId, 'bank_feed.sync.manual', 'bank_connection', params.id);

    const outcome = await syncConnection(params.id, 'manual');
    return NextResponse.json({ data: outcome });
  } catch (error: any) {
    console.error('POST /api/plaid/connections/[id]/sync failed');
    return NextResponse.json(
      { error: 'Sync failed. Check the sync log or contact support.' },
      { status: 502 }
    );
  }
}
