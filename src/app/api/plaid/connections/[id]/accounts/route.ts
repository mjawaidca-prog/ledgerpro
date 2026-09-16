import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany, auditLog } from '@/lib/api-helpers';
import type { Prisma } from '@prisma/client';
export const dynamic = 'force-dynamic';

// PATCH /api/plaid/connections/[id]/accounts — map provider accounts to
// LedgerPro GL accounts. The handoff's rules are enforced server-side:
// - feeding accounts require a GL account,
// - currency must match the GL account's currency,
// - credit-card subtypes map to liability accounts, depository to assets,
// - a GL account already fed by another connection cannot be reused.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireCompany(req, { roles: ['owner', 'admin', 'bookkeeper'] });
    if (session.error) return session.error;

    return await db.$transaction(async (tx) => {
    // Company lock serializes mappings across connections; the sync lock
    // prevents cursor advancement while account selection changes.
    const companyLock = `bfmap:${session.companyId}`;
    const syncLock = `bfsync:${params.id}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${companyLock}, 0))::text`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${syncLock}, 0))::text`;
    const connection = await tx.bankConnection.findFirst({
      where: { id: params.id, companyId: session.companyId! },
      include: { accounts: true },
    });
    if (!connection) {
      return NextResponse.json({ error: 'Bank connection not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const updates = Array.isArray(body?.accounts) ? body.accounts : [];
    if (!updates.length) {
      return NextResponse.json({ error: 'accounts is required.' }, { status: 400 });
    }

    const byProviderId = new Map(connection.accounts.map((a) => [a.providerAccountId, a]));
    const errors: Record<string, string> = {};
    const selected = new Set<string>();

    for (const u of updates) {
      const key = u.providerAccountId;
      const existing = byProviderId.get(key);
      if (!existing) {
        errors[key] = 'Unknown provider account.';
        continue;
      }
      const isFeeding = Boolean(u.is_feeding);
      const financialAccountId = typeof u.financialAccountId === 'string' && u.financialAccountId ? u.financialAccountId : null;

      if (isFeeding && !financialAccountId) {
        errors[key] = 'Link a ledger account before this account can feed.';
        continue;
      }
      if (!isFeeding) continue; // stored unmapped, enabled later without reconnecting
      if (selected.has(financialAccountId!)) {
        errors[key] = 'Each bank account needs a different ledger account.';
        continue;
      }
      selected.add(financialAccountId!);
      if (connection.transactionsCursor && (existing.financialAccountId !== financialAccountId || !existing.isFeeding)) {
        errors[key] = 'This connection has already synchronized. Contact support to add or change accounts without missing history.';
        continue;
      }

      const gl = await tx.financialAccount.findFirst({
        where: { id: financialAccountId!, companyId: session.companyId! },
        select: { id: true, currency: true, kind: true, name: true },
      });
      if (!gl) {
        errors[key] = 'The selected ledger account does not exist.';
        continue;
      }
      if (gl.currency !== existing.currency) {
        errors[key] = `This is a ${existing.currency} account. Choose a ${existing.currency} ledger account.`;
        continue;
      }
      const isCreditSubtype = /credit/i.test(existing.subtype);
      if (isCreditSubtype && gl.kind !== 'creditcard') {
        errors[key] = 'A credit card must map to a liability account.';
        continue;
      }
      if (!isCreditSubtype && gl.kind === 'creditcard') {
        errors[key] = 'A bank account must map to an asset account, not a credit card.';
        continue;
      }
      const alreadyFed = await tx.bankFeedAccount.findFirst({
        where: { financialAccountId: financialAccountId!, NOT: { connectionId: params.id, providerAccountId: key }, isFeeding: true },
        select: { connection: { select: { institutionName: true } } },
      });
      if (alreadyFed) {
        errors[key] = `Already fed by ${alreadyFed.connection.institutionName}.`;
      }
    }

    if (Object.keys(errors).length) {
      return NextResponse.json({ error: 'Account mapping failed.', fields: errors }, { status: 400 });
    }

    for (const u of updates) {
      const isFeeding = Boolean(u.is_feeding);
      const financialAccountId = typeof u.financialAccountId === 'string' && u.financialAccountId ? u.financialAccountId : null;
      await tx.bankFeedAccount.update({
        where: { connectionId_providerAccountId: { connectionId: params.id, providerAccountId: u.providerAccountId } },
        data: {
          isFeeding,
          financialAccountId: isFeeding ? financialAccountId : null,
        },
      });
    }

    await auditLog(session.companyId!, session.userId, 'bank_feed.accounts.map', 'bank_connection', params.id, undefined, {
      mapped: updates.length,
    });

    return NextResponse.json({ data: { mapped: updates.length } });
    }, { maxWait: 15000, timeout: 60000 });
  } catch (error) {
    console.error('PATCH /api/plaid/connections/[id]/accounts error:', error);
    return NextResponse.json({ error: 'Failed to save account mapping' }, { status: 500 });
  }
}
