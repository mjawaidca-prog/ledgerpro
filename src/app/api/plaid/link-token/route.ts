import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { createLinkToken } from '@/lib/bank-feed/plaid-client';
import { decryptToken } from '@/lib/bank-feed/crypto';
import { updateLinkToken } from '@/lib/bank-feed/plaid-client';
import { bankFeedPilotAllowed } from '@/lib/bank-feed/pilot';
export const dynamic = 'force-dynamic';

// POST /api/plaid/link-token — mints a Plaid Link token for the signed-in
// user. Pass { connectionId } to re-open Link in update mode for reconnect
// and consent-renewal flows. Provider credentials go to the bank, never to
// LedgerPro.
export async function POST(req: NextRequest) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;
    if (!bankFeedPilotAllowed(session.companyId!)) return NextResponse.json({ error: 'Bank feeds are restricted to the approved production pilot.' }, { status: 403 });

    const body = await req.json().catch(() => null);
    const connectionId = typeof body?.connectionId === 'string' && body.connectionId ? body.connectionId : null;

    if (connectionId) {
      const connection = await db.bankConnection.findFirst({
        where: { id: connectionId, companyId: session.companyId! },
        select: { id: true, accessTokenEncrypted: true, status: true },
      });
      if (!connection) {
        return NextResponse.json({ error: 'Bank connection not found' }, { status: 404 });
      }
      if (connection.status === 'revoked') return NextResponse.json({ error: 'Disconnect this revoked connection, then connect the bank again.' }, { status: 409 });
      const { linkToken, expiration } = await updateLinkToken({
        accessToken: decryptToken(connection.accessTokenEncrypted),
        userId: session.userId!,
      });
      await auditLog(session.companyId!, session.userId, 'bank_feed.link_token.update', 'bank_connection', connectionId, undefined, {
        expiresAt: expiration,
      });
      return NextResponse.json({ data: { linkToken, expiration, updateMode: true } });
    }

    const company = await db.company.findUniqueOrThrow({
      where: { id: session.companyId! },
      select: { name: true },
    });

    const { linkToken, expiration } = await createLinkToken({
      userId: session.userId!,
      companyName: company.name,
    });

    await auditLog(session.companyId!, session.userId, 'bank_feed.link_token', 'bank_connection', undefined, undefined, {
      expiresAt: expiration,
    });

    return NextResponse.json({ data: { linkToken, expiration, updateMode: false } });
  } catch (error: any) {
    console.error('POST /api/plaid/link-token failed');
    return NextResponse.json(
      { error: error?.message?.includes('not configured') ? 'Bank feeds are not configured in this environment.' : 'Failed to create a bank link session.' },
      { status: 500 }
    );
  }
}
