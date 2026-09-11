import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// DELETE — revoke a key immediately. Revocation is a soft flag: the row and
// its audit history stay, but every future request with this key gets a 401.
// Scoped to the owner's company so one company can never revoke another's key.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;

    const existing = await db.apiKey.findFirst({
      where: { id: params.id, companyId: session.companyId! },
      select: { id: true, name: true, revokedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    const updated = await db.apiKey.updateMany({
      where: { id: params.id, companyId: session.companyId!, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await auditLog(session.companyId!, session.userId, 'api_key.revoke', 'api_key', params.id, undefined, {
      keyName: existing.name,
      alreadyRevoked: updated.count === 0,
    });

    return NextResponse.json({ data: { id: params.id, revoked: true } });
  } catch (error) {
    console.error('DELETE /api/keys/[id] error:', error);
    return NextResponse.json({ error: 'Failed to revoke API key' }, { status: 500 });
  }
}
