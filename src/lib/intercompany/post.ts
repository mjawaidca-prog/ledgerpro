/**
 * LedgerPro — Inter-company posting service.
 *
 * Post one side of a related-party transaction and LedgerPro writes the
 * matching contra entry in the other company — same date, same amount,
 * mirrored accounts, permanently linked.
 *
 * Both entries are written inside one database transaction. If the mirror
 * cannot be written (closed period, missing account, etc.), neither side
 * is written — the entire operation rolls back.
 */

import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { assertMemberOfBoth } from './link';

// ─── Types ───

export interface InterCompanyPostInput {
  sourceCompanyId: string;
  targetCompanyId: string;
  kind: 'FUND_TRANSFER' | 'EXPENSE_ON_BEHALF' | 'RECHARGE' | 'JOURNAL';
  date: Date;
  amount: Prisma.Decimal;           // always positive, in source currency
  sourceOffsetAccountCode: string;  // credited in source (bank / AP / income)
  targetOffsetAccountCode: string;  // debited in target (bank / expense)
  memo?: string;
  fxRate?: Prisma.Decimal;          // target units per source unit
}

// ─── Helpers ───

function nextReference(tx: Prisma.TransactionClient, prefix: string): Promise<string> {
  // Generate a sequential reference like IC-0042
  return tx.interCompanyTransaction
    .findFirst({
      where: { reference: { startsWith: prefix } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    })
    .then((last) => {
      if (!last) return `${prefix}-0001`;
      const num = parseInt(last.reference.split('-')[1], 10) + 1;
      return `${prefix}-${String(num).padStart(4, '0')}`;
    });
}

async function validateBalanced(lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[]) {
  const totalDebit = lines.reduce((sum, l) => sum.add(l.debit), new Prisma.Decimal(0));
  const totalCredit = lines.reduce((sum, l) => sum.add(l.credit), new Prisma.Decimal(0));
  if (!totalDebit.equals(totalCredit)) {
    throw new Error(
      `Journal entry is not balanced. Total debits: ${totalDebit}, total credits: ${totalCredit}`
    );
  }
}

// ─── Post ───

export async function postInterCompany(
  userId: string,
  input: InterCompanyPostInput
) {
  const { sourceCompanyId, targetCompanyId, kind, date, amount, memo } = input;

  if (sourceCompanyId === targetCompanyId) {
    throw new Error('Cannot post an inter-company transaction to the same company.');
  }
  if (amount.lte(0)) {
    throw new Error('Amount must be positive.');
  }

  // Dual membership required — user must have access to both books
  await assertMemberOfBoth(userId, sourceCompanyId, targetCompanyId);

  // Resolve the link — canonical order (sorted by id)
  const [companyAId, companyBId] = [sourceCompanyId, targetCompanyId].sort();
  const link = await db.relatedPartyLink.findUniqueOrThrow({
    where: { companyAId_companyBId: { companyAId, companyBId } },
  });

  // Determine which control accounts to use based on direction
  const sourceIsA = sourceCompanyId === companyAId;
  const srcDueFromCode = sourceIsA
    ? (await db.chartOfAccount.findUniqueOrThrow({ where: { id: link.aDueFromAccountId } })).code
    : (await db.chartOfAccount.findUniqueOrThrow({ where: { id: link.bDueFromAccountId } })).code;
  const tgtDueToCode = sourceIsA
    ? (await db.chartOfAccount.findUniqueOrThrow({ where: { id: link.bDueToAccountId } })).code
    : (await db.chartOfAccount.findUniqueOrThrow({ where: { id: link.aDueToAccountId } })).code;

  const mirrorAmount = input.fxRate ? amount.mul(input.fxRate) : amount;

  return db.$transaction(async (tx) => {
    // Guard: closed periods in both companies
    const periodChecks: [string, Date][] = [
      [sourceCompanyId, date],
      [targetCompanyId, date],
    ];
    for (const [cid, entryDate] of periodChecks) {
      const closed = await tx.periodClose.findFirst({
        where: {
          companyId: cid,
          status: 'closed',
          periodStart: { lte: entryDate },
          periodEnd: { gte: entryDate },
        },
      });
      if (closed) {
        throw new Error(
          `Date ${date.toISOString().slice(0, 10)} falls within a closed period in one of the companies.`
        );
      }
    }

    const reference = await nextReference(tx, 'IC');

    const zero = new Prisma.Decimal(0);

    // --- Source entry ---
    // Dr  Due from (asset)        XXX.XX
    // Cr  sourceOffsetAccount     XXX.XX
    const sourceLines = [
      { glAccountCode: srcDueFromCode, description: `Due from — ${reference}`, debit: amount, credit: zero },
      { glAccountCode: input.sourceOffsetAccountCode, description: memo || `IC ${reference}`, debit: zero, credit: amount },
    ];
    await validateBalanced(sourceLines);

    const sourceEntry = await tx.journalEntry.create({
      data: {
        companyId: sourceCompanyId,
        entryDate: date,
        description: memo || `Inter-company ${reference}`,
        sourceType: 'manual',
        sourceId: reference,
        createdBy: userId,
        interCompanyRole: 'SOURCE',
        lines: {
          create: sourceLines.map((l) => ({
            glAccountCode: l.glAccountCode,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
          })),
        },
      },
    });

    // --- Mirror entry ---
    // Dr  targetOffsetAccount     XXX.XX
    // Cr  Due to (liability)      XXX.XX
    const mirrorLines = [
      { glAccountCode: input.targetOffsetAccountCode, description: memo || `IC ${reference}`, debit: mirrorAmount, credit: zero },
      { glAccountCode: tgtDueToCode, description: `Due to — ${reference}`, debit: zero, credit: mirrorAmount },
    ];
    await validateBalanced(mirrorLines);

    const mirrorEntry = await tx.journalEntry.create({
      data: {
        companyId: targetCompanyId,
        entryDate: date,
        description: memo || `Inter-company ${reference}`,
        sourceType: 'manual',
        sourceId: reference,
        createdBy: userId,
        interCompanyRole: 'MIRROR',
        lines: {
          create: mirrorLines.map((l) => ({
            glAccountCode: l.glAccountCode,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
          })),
        },
      },
    });

    // --- Link record ---
    const ic = await tx.interCompanyTransaction.create({
      data: {
        reference,
        linkId: link.id,
        sourceCompanyId,
        targetCompanyId,
        kind,
        date,
        amount,
        fxRate: input.fxRate,
        memo,
        sourceEntryId: sourceEntry.id,
        mirrorEntryId: mirrorEntry.id,
        status: 'POSTED',
        createdById: userId,
      },
    });

    // Backfill the interCompanyId on both journal entries
    await tx.journalEntry.updateMany({
      where: { id: { in: [sourceEntry.id, mirrorEntry.id] } },
      data: { interCompanyId: ic.id },
    });

    // Update GL account balances for both entries
    const balanceUpdates: [string, { glAccountCode: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]][] = [
      [sourceCompanyId, sourceLines],
      [targetCompanyId, mirrorLines],
    ];
    for (const [cid, lines] of balanceUpdates) {
      for (const line of lines) {
        const account = await tx.chartOfAccount.findFirst({
          where: { code: line.glAccountCode, companyId: cid },
        });
        if (!account) continue;

        const netEffect = Number(line.debit) - Number(line.credit);
        const balanceChange =
          account.type === 'asset' || account.type === 'expense'
            ? netEffect
            : -netEffect;

        await tx.chartOfAccount.update({
          where: { id: account.id },
          data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
        });

        if (account.parentCode) {
          await tx.chartOfAccount.updateMany({
            where: { code: account.parentCode, companyId: cid },
            data: { balance: { increment: new Prisma.Decimal(balanceChange) } },
          });
        }
      }
    }

    // Audit log
    await tx.auditLog.create({
      data: {
        companyId: sourceCompanyId,
        userId,
        action: 'INTERCOMPANY_POST',
        entityType: 'InterCompanyTransaction',
        entityId: ic.id,
        metadata: {
          reference,
          sourceCompanyId,
          targetCompanyId,
          kind,
          amount: amount.toString(),
        } as any,
      },
    });

    return ic;
  });
}
