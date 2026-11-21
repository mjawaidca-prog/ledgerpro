import { NextRequest, NextResponse } from 'next/server';
import { requireCompany, auditLog, closedPeriodGuard, accountLockedGuard } from '@/lib/api-helpers';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bank-transactions/[id]/match-proposals/confirm-journal —
 * confirm an assistant proposal that pairs this bank row with an
 * EXISTING journal entry (a loan payment the loan tool posted, a
 * manual entry, …). No new entry is created: the write is the same
 * transaction record the document match route writes — status
 * 'reconciled', matchRef = the entry, matchedDocs naming it — under
 * the same guards. Body: { entryId }.
 *
 * The amount is re-verified server-side against the entry's line on
 * this row's bank GL account; client figures are never trusted.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, userId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const entryId = typeof body.entryId === 'string' ? body.entryId : null;
    if (!entryId) return NextResponse.json({ error: 'entryId is required.' }, { status: 400 });

    const tx = await db.transaction.findUnique({
      where: { id: params.id, companyId },
      include: { account: { select: { id: true, glAccountCode: true } } },
    });
    if (!tx) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 });
    if (tx.status === 'reconciled' && tx.matchRef) {
      return NextResponse.json({ error: 'This row is already posted.' }, { status: 409 });
    }

    const lockGuard = await accountLockedGuard(companyId, tx.financialAccountId, tx.date);
    if (lockGuard) return lockGuard;
    const periodGuard = await closedPeriodGuard(companyId, tx.date);
    if (periodGuard) return periodGuard;

    const bankCode = tx.account?.glAccountCode;
    if (!bankCode) return NextResponse.json({ error: 'This bank account has no GL code.' }, { status: 400 });

    const entry = await db.journalEntry.findUnique({
      where: { id: entryId, companyId },
      include: { lines: { where: { glAccountCode: bankCode } } },
    });
    if (!entry || entry.voidedAt) {
      return NextResponse.json({ error: 'Journal entry not found or voided.' }, { status: 404 });
    }

    const isInflow = Number(tx.amount) > 0;
    const line = entry.lines[0];
    const entryAmount = line ? (isInflow ? Number(line.debit) : Number(line.credit)) : 0;
    if (Math.abs(entryAmount - Math.abs(Number(tx.amount))) > 0.005) {
      return NextResponse.json(
        { error: 'The entry amount no longer equals this bank line to the cent — match not applied.' },
        { status: 400 }
      );
    }

    // Another row may already claim this entry.
    const claimed = await db.transaction.findFirst({
      where: { companyId, status: 'reconciled', matchRef: entryId, id: { not: tx.id } },
      select: { id: true },
    });
    if (claimed) {
      return NextResponse.json({ error: 'That entry is already matched to another bank line.' }, { status: 409 });
    }

    const docs = [{ type: 'journal' as const, id: entryId, amount: Math.abs(Number(tx.amount)) }];
    await db.transaction.update({
      where: { id: params.id },
      data: { status: 'reconciled', matchRef: entryId, matchedDocs: docs as any },
    });

    await auditLog(companyId, userId, 'bank_transaction.match', 'transaction', params.id, { docs } as any);

    return NextResponse.json({ data: { entries: [entryId], matchedDocs: docs } }, { status: 201 });
  } catch (err) {
    console.error('POST /api/bank-transactions/[id]/match-proposals/confirm-journal error:', err);
    return NextResponse.json({ error: 'Failed to confirm the match' }, { status: 500 });
  }
}
