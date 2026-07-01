import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCompany } from '@/lib/api-helpers';
export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const body = await req.json();
    const { categoryId, status, matchRef } = body;

    const existing = await db.transaction.findUnique({ where: { id: params.id, companyId } });
    if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    const updateData: any = {};
    if (categoryId !== undefined) {
      const category = await db.chartOfAccount.findFirst({
        where: {
          companyId,
          OR: [
            { id: categoryId },
            { code: categoryId },
          ],
        },
      });

      if (!category) {
        return NextResponse.json({ error: 'Category not found' }, { status: 400 });
      }

      updateData.categoryId = category.id;
      updateData.status = 'categorized';
    }
    if (status) updateData.status = status;
    if (matchRef !== undefined) updateData.matchRef = matchRef;

    const tx = await db.transaction.update({
      where: { id: params.id },
      data: updateData,
      include: {
        account: { select: { id: true, name: true } },
        category: { select: { id: true, code: true, name: true } },
      },
    });

    return NextResponse.json({ data: tx });
  } catch (error) {
    console.error('PUT /api/transactions/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId, error } = await requireCompany(req, { requireOnboarding: true });
    if (error) return error;

    const existing = await db.transaction.findUnique({
      where: { id: params.id, companyId },
      include: { account: { select: { id: true, glAccountCode: true } } },
    });
    if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    // If posted to GL, reverse the journal entry and balance changes
    if (existing.status === 'reconciled' && existing.matchRef) {
      await reverseJournalEntry(existing.matchRef, companyId);
    }

    // Reverse financial account balance ONLY for posted (reconciled) transactions.
    // Non-posted transactions never affected the balance — reversing them corrupts it.
    if (existing.status === 'reconciled' && existing.account?.glAccountCode) {
      await db.financialAccount.updateMany({
        where: { glAccountCode: existing.account.glAccountCode, companyId },
        data: { currentBalance: { increment: -Number(existing.amount) } },
      });
    }

    await db.transaction.delete({ where: { id: params.id } });

    return NextResponse.json({ data: { deleted: params.id } });
  } catch (error) {
    console.error('DELETE /api/transactions/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
  }
}

/** Reverse a journal entry: delete lines, reverse COA balances, delete entry */
async function reverseJournalEntry(matchRef: string, companyId: string) {
  const entry = await db.journalEntry.findUnique({
    where: { id: matchRef },
    include: { lines: true },
  });
  if (!entry) return;

  // Reverse COA balances
  for (const line of entry.lines) {
    const acct = await db.chartOfAccount.findFirst({
      where: { code: line.glAccountCode, companyId },
    });
    if (!acct) continue;
    const net = Number(line.debit) - Number(line.credit);
    const balanceChange = (acct.type === 'asset' || acct.type === 'expense') ? -net : net;
    await db.chartOfAccount.update({
      where: { id: acct.id },
      data: { balance: { increment: balanceChange } },
    });
    // Reverse parent balance too
    if (acct.parentCode) {
      await db.chartOfAccount.updateMany({
        where: { code: acct.parentCode, companyId },
        data: { balance: { increment: balanceChange } },
      });
    }
  }

  // Delete lines and entry
  await db.journalLine.deleteMany({ where: { journalEntryId: entry.id } });
  await db.journalEntry.delete({ where: { id: entry.id } });
}
