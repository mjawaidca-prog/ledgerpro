import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

// POST — the company-level emergency disable switch. Turning it off makes
// every key for this company fail authentication immediately; turning it on
// restores access. Keys and audit history are never deleted.
export async function POST(req: NextRequest) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;

    const body = await req.json().catch(() => null);
    if (typeof body?.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Body must include an "enabled" boolean.' }, { status: 400 });
    }

    await db.company.update({
      where: { id: session.companyId! },
      data: { apiAccessEnabled: body.enabled },
    });

    await auditLog(
      session.companyId!,
      session.userId,
      body.enabled ? 'api_access.enable' : 'api_access.disable',
      'company',
      session.companyId!,
      undefined,
      { via: 'developer_settings' }
    );

    return NextResponse.json({ data: { apiAccessEnabled: body.enabled } });
  } catch (error) {
    console.error('POST /api/keys/access error:', error);
    return NextResponse.json({ error: 'Failed to update API access' }, { status: 500 });
  }
}
