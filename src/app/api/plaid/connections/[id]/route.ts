import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import { removeItem } from '@/lib/bank-feed/plaid-client';
import { decryptToken } from '@/lib/bank-feed/crypto';
export const dynamic = 'force-dynamic';

// DELETE /api/plaid/connections/[id] — disconnect: the provider item is
// removed FIRST (ending consent at the bank), then the local connection and
// its mappings are deleted. Review work is retained by default: this stage
// deletes nothing in the transactions queue (the explicit row-removal option
// arrives with the screens in BF-4).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireCompany(req, { roles: ['owner'] });
    if (session.error) return session.error;

    const connection = await db.bankConnection.findFirst({
      where: { id: params.id, companyId: session.companyId! },
      select: { id: true, institutionName: true, accessTokenEncrypted: true },
    });
    if (!connection) {
      return NextResponse.json({ error: 'Bank connection not found' }, { status: 404 });
    }

    // Provider removal before local deletion: if this fails, the local
    // consent record survives so the user can retry — an orphaned provider
    // item would keep billing the integration.
    try {
      await removeItem(decryptToken(connection.accessTokenEncrypted));
    } catch (providerError: any) {
      console.error('DELETE /api/plaid/connections/[id] provider removal failed:', providerError?.message);
      return NextResponse.json(
        { error: 'Could not revoke consent at the bank. Try again before contacting support.' },
        { status: 502 }
      );
    }

    // Review work is retained by default. The explicit option removes only
    // eligible UNTOUCHED feed rows: still to review, never categorized,
    // matched, or reconciled — posted ledger entries are always kept.
    const { searchParams } = new URL(req.url);
    let removedRows = 0;
    if (searchParams.get('removeUnreviewed') === '1') {
      const linkIds = await db.bankFeedTransaction.findMany({
        where: { connectionId: params.id, transactionId: { not: null } },
        select: { transactionId: true },
      });
      const ids = linkIds.map((l) => l.transactionId as string);
      if (ids.length) {
        const deleted = await db.transaction.deleteMany({
          where: {
            id: { in: ids },
            companyId: session.companyId!,
            status: 'toreview',
            categoryId: null,
            contactId: null,
            reconciledInId: null,
            voidedAt: null,
            source: 'feed',
          },
        });
        removedRows = deleted.count;
      }
    }

    await db.bankConnection.delete({ where: { id: params.id } });

    await auditLog(session.companyId!, session.userId, 'bank_feed.connection.disconnect', 'bank_connection', params.id, undefined, {
      institutionName: connection.institutionName,
      removedUnreviewedRows: removedRows,
    });

    return NextResponse.json({ data: { id: params.id, disconnected: true, removedRows } });
  } catch (error) {
    console.error('DELETE /api/plaid/connections/[id] error:', error);
    return NextResponse.json({ error: 'Failed to disconnect the bank feed' }, { status: 500 });
  }
}
