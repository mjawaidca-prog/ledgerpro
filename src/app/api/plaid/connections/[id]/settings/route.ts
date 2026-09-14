import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// PATCH /api/plaid/connections/[id]/settings — sync cadence (daily only in
// the initial scope; hourly and twice-daily are later work), rule-based
// auto-categorization, and failure notifications.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireCompany(req, { roles: ['owner', 'admin'] });
    if (session.error) return session.error;

    const connection = await db.bankConnection.findFirst({
      where: { id: params.id, companyId: session.companyId! },
      select: { id: true },
    });
    if (!connection) {
      return NextResponse.json({ error: 'Bank connection not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const data: Record<string, unknown> = {};
    if (body?.cadence !== undefined) {
      if (body.cadence !== 'daily') {
        return NextResponse.json({ error: 'Only the daily cadence is available in this release.' }, { status: 400 });
      }
      data.cadence = 'daily';
    }
    if (body?.autoCategorize !== undefined) {
      if (typeof body.autoCategorize !== 'boolean') {
        return NextResponse.json({ error: 'autoCategorize must be a boolean.' }, { status: 400 });
      }
      data.autoCategorize = body.autoCategorize;
    }
    if (body?.notifyOnFailure !== undefined) {
      if (typeof body.notifyOnFailure !== 'boolean') {
        return NextResponse.json({ error: 'notifyOnFailure must be a boolean.' }, { status: 400 });
      }
      data.notifyOnFailure = body.notifyOnFailure;
    }
    if (!Object.keys(data).length) {
      return NextResponse.json({ error: 'No settings provided.' }, { status: 400 });
    }

    await db.bankConnection.update({ where: { id: params.id }, data });
    await auditLog(session.companyId!, session.userId, 'bank_feed.settings.update', 'bank_connection', params.id, undefined, data);

    return NextResponse.json({ data: { id: params.id, ...data } });
  } catch (error) {
    console.error('PATCH /api/plaid/connections/[id]/settings error:', error);
    return NextResponse.json({ error: 'Failed to update sync settings' }, { status: 500 });
  }
}
