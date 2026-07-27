/**
 * LedgerPro — Inter-company void and amend.
 *
 * Void: reverses BOTH entries in one database transaction.
 * Amend: void + repost, so the audit trail keeps both versions.
 *
 * Guard: any direct edit or void of a journal entry where interCompanyId
 * is set must be rejected at the mutation handler and routed here instead.
 */

import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { assertMemberOfBoth } from './link';
import { postInterCompany, InterCompanyPostInput } from './post';

// ─── Void ───

export async function voidInterCompany(
  userId: string,
  icId: string,
  reason?: string
) {
  const ic = await db.interCompanyTransaction.findUniqueOrThrow({
    where: { id: icId },
  });

  if (ic.status === 'VOIDED') {
    throw new Error('This inter-company transaction has already been voided.');
  }

  await assertMemberOfBoth(userId, ic.sourceCompanyId, ic.targetCompanyId);

  return db.$transaction(async (tx) => {
    const reversalDate = new Date();

    // Void both journal entries (create reversing entries)
    for (const entryId of [ic.sourceEntryId, ic.mirrorEntryId].filter(Boolean) as string[]) {
      const entry = await tx.journalEntry.findUniqueOrThrow({
        where: { id: entryId },
        include: { lines: true },
      });

      if (entry.voidedAt) continue; // already voided

      // Create reversal entry
      const reversal = await tx.journalEntry.create({
        data: {
          companyId: entry.companyId,
          entryDate: reversalDate,
          description: `Reversal of: ${entry.description}${reason ? ` (${reason})` : ''}`,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId ?? undefined,
          createdBy: userId,
          reversalOfId: entry.id,
          lines: {
            create: entry.lines.map((l) => ({
              glAccountCode: l.glAccountCode,
              description: l.description ?? undefined,
              debit: l.credit,   // swap
              credit: l.debit,   // swap
            })),
          },
        },
      });

      // Mark original as voided
      await tx.journalEntry.update({
        where: { id: entry.id },
        data: { voidedAt: reversalDate, voidedBy: userId },
      });

      // Update balances for the reversal
      for (const line of entry.lines) {
        const account = await tx.chartOfAccount.findFirst({
          where: { code: line.glAccountCode, companyId: entry.companyId },
        });
        if (!account) continue;

        const netEffect = Number(line.credit) - Number(line.debit); // reversed
        const balanceChange =
          account.type === 'asset' || account.type === 'expense'
            ? netEffect
            : -netEffect;

        await tx.chartOfAccount.update({
          where: { id: account.id },
          data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
        });
      }
    }

    // Mark IC transaction as voided
    return tx.interCompanyTransaction.update({
      where: { id: icId },
      data: { status: 'VOIDED', voidedAt: reversalDate, voidedById: userId },
    });
  });
}

// ─── Amend ───

/**
 * Amend an inter-company transaction.
 * This is void + repost — the audit trail keeps both versions,
 * and the old pair is permanently visible as voided.
 */
export async function amendInterCompany(
  userId: string,
  icId: string,
  next: InterCompanyPostInput
) {
  await voidInterCompany(userId, icId, 'Amended');
  return postInterCompany(userId, next);
}
