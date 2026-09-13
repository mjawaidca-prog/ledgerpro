import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { createLinkToken } from '@/lib/bank-feed/plaid-client';
export const dynamic = 'force-dynamic';

// POST /api/plaid/link-token — mints a Plaid Link token for the signed-in
// user. The token only opens Plaid's hosted consent modal; provider
// credentials go to the bank, never to LedgerPro.
export async function POST(req: NextRequest) {
  try {
    const session = await requireCompany(req, { roles: ['owner', 'admin', 'bookkeeper'] });
    if (session.error) return session.error;

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

    return NextResponse.json({ data: { linkToken, expiration } });
  } catch (error: any) {
    console.error('POST /api/plaid/link-token error:', error);
    return NextResponse.json(
      { error: error?.message?.includes('not configured') ? 'Bank feeds are not configured in this environment.' : 'Failed to create a bank link session.' },
      { status: 500 }
    );
  }
}
