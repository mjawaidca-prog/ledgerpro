import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { exchangePublicToken, getItem, getItemAccounts } from '@/lib/bank-feed/plaid-client';
import { encryptToken } from '@/lib/bank-feed/crypto';
export const dynamic = 'force-dynamic';

// POST /api/plaid/exchange — completes the Plaid Link flow: the public token
// is exchanged for an access token, which is envelope-encrypted at rest
// immediately. The token never appears in the response, logs, or audit.
// Connections are owner-approved: the owner authorizes and pays.
export async function POST(req: NextRequest) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;

    const body = await req.json().catch(() => null);
    const publicToken = typeof body?.publicToken === 'string' ? body.publicToken.trim() : '';
    if (!publicToken) {
      return NextResponse.json({ error: 'publicToken is required.' }, { status: 400 });
    }

    const { accessToken, itemId } = await exchangePublicToken(publicToken);
    try {
      const [item, accounts] = await Promise.all([getItem(accessToken), getItemAccounts(accessToken)]);

      // Balance-only ("Beta") institutions have no transaction feed — the
      // connection is still recorded but flagged so BF-4 can gate activation.
      const depository = new Set(['checking', 'savings']);
      const credit = new Set(['credit card', 'credit']);

      const connection = await db.bankConnection.create({
        data: {
          companyId: session.companyId!,
          provider: 'plaid',
          itemId: item.itemId,
          institutionId: item.institutionId,
          institutionName: item.institutionName ?? 'Unknown institution',
          accessTokenEncrypted: encryptToken(accessToken),
          consentExpiresAt: item.consentExpiresAt ? new Date(item.consentExpiresAt) : null,
          billableOwnerId: session.userId ?? null,
          createdById: session.userId ?? null,
          accounts: {
            create: accounts.map((a) => ({
              providerAccountId: a.providerAccountId,
              name: a.name,
              mask: a.mask,
              subtype: a.subtype ?? 'unknown',
              currency: a.currency,
              currentBalance: a.currentBalance,
              availableBalance: a.availableBalance,
              // Default feeding: depository and credit accounts feed; personal
              // and other subtypes stay stored but off.
              isFeeding: depository.has(a.subtype ?? '') || credit.has(a.subtype ?? ''),
            })),
          },
        },
        include: { accounts: true },
      });

      await auditLog(session.companyId!, session.userId, 'bank_feed.connection.create', 'bank_connection', connection.id, undefined, {
        institutionName: connection.institutionName,
        accountCount: connection.accounts.length,
      });

      return NextResponse.json(
        {
          data: {
            connectionId: connection.id,
            institutionName: connection.institutionName,
            consentExpiresAt: connection.consentExpiresAt,
            accounts: connection.accounts.map((a) => ({
              providerAccountId: a.providerAccountId,
              name: a.name,
              mask: a.mask,
              subtype: a.subtype,
              currency: a.currency,
              currentBalance: a.currentBalance,
              isFeeding: a.isFeeding,
            })),
          },
        },
        { status: 201 }
      );
    } catch (inner: any) {
      // The exchange succeeded but item setup failed — remove the provider
      // item so the user is not left with an orphaned consent.
      try {
        const { removeItem } = await import('@/lib/bank-feed/plaid-client');
        await removeItem(accessToken);
      } catch {}
      throw inner;
    }
  } catch (error: any) {
    console.error('POST /api/plaid/exchange error:', error);
    const message = error?.response?.data?.error_message || error?.message || 'Failed to connect the bank.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
