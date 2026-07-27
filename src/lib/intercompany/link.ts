/**
 * LedgerPro — Related-party link provisioning.
 *
 * Declaring a link between two companies auto-creates four control accounts:
 *   - Due from B (asset) in Company A
 *   - Due to B (liability) in Company A
 *   - Due from A (asset) in Company B
 *   - Due to A (liability) in Company B
 *
 * Only users with membership in BOTH companies can create a link.
 */

import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

// ─── Helpers ───

/**
 * Find the next available account code starting from `base`.
 * Scans existing codes with the same 2-digit prefix and returns
 * the first unused integer.
 */
async function nextCode(
  companyId: string,
  base: number,
  tx: Prisma.TransactionClient
): Promise<string> {
  const prefix = String(base).slice(0, 2);
  const existing = await tx.chartOfAccount.findMany({
    where: { companyId, code: { startsWith: prefix } },
    select: { code: true },
  });
  let code = base;
  while (existing.some((a) => a.code === String(code))) code++;
  return String(code);
}

// ─── Permission check ───

export async function assertMemberOfBoth(
  userId: string,
  companyX: string,
  companyY: string
) {
  const count = await db.membership.count({
    where: {
      userId,
      companyId: { in: [companyX, companyY] },
      role: { in: ['owner', 'admin', 'bookkeeper'] },
    },
  });
  if (count < 2) {
    throw new Error(
      'You need access to both companies to manage related-party links.'
    );
  }
}

// ─── Provisioning ───

async function provisionControlAccounts(
  tx: Prisma.TransactionClient,
  companyId: string,
  counterparty: { id: string; name: string }
) {
  const dueFrom = await tx.chartOfAccount.create({
    data: {
      companyId,
      name: `Due from ${counterparty.name}`,
      code: await nextCode(companyId, 1310, tx),
      type: 'asset',
      subType: 'current_asset',
      isControlAccount: true,
      relatedPartyCompanyId: counterparty.id,
    },
  });

  const dueTo = await tx.chartOfAccount.create({
    data: {
      companyId,
      name: `Due to ${counterparty.name}`,
      code: await nextCode(companyId, 2310, tx),
      type: 'liability',
      subType: 'current_liability',
      isControlAccount: true,
      relatedPartyCompanyId: counterparty.id,
    },
  });

  return { dueFrom, dueTo };
}

// ─── Create link ───

export async function createRelatedPartyLink(
  userId: string,
  companyX: string,
  companyY: string
) {
  // Canonical ordering — the pair is always stored ordered by id
  const [companyAId, companyBId] = [companyX, companyY].sort();

  await assertMemberOfBoth(userId, companyAId, companyBId);

  return db.$transaction(async (tx) => {
    const a = await tx.company.findUniqueOrThrow({ where: { id: companyAId } });
    const b = await tx.company.findUniqueOrThrow({ where: { id: companyBId } });

    // Check for existing link
    const existing = await tx.relatedPartyLink.findUnique({
      where: { companyAId_companyBId: { companyAId, companyBId } },
    });
    if (existing) {
      throw new Error(
        `A related-party link between ${a.name} and ${b.name} already exists.`
      );
    }

    const aAcc = await provisionControlAccounts(tx, a.id, b);
    const bAcc = await provisionControlAccounts(tx, b.id, a);

    return tx.relatedPartyLink.create({
      data: {
        companyAId,
        companyBId,
        aDueFromAccountId: aAcc.dueFrom.id,
        aDueToAccountId: aAcc.dueTo.id,
        bDueFromAccountId: bAcc.dueFrom.id,
        bDueToAccountId: bAcc.dueTo.id,
      },
      include: {
        companyA: { select: { id: true, name: true } },
        companyB: { select: { id: true, name: true } },
      },
    });
  });
}

// ─── Query links ───

export async function getRelatedPartyLinks(userId: string) {
  // Get all companies the user belongs to
  const memberships = await db.membership.findMany({
    where: { userId },
    select: { companyId: true },
  });
  const companyIds = memberships.map((m) => m.companyId);

  return db.relatedPartyLink.findMany({
    where: {
      isActive: true,
      OR: [
        { companyAId: { in: companyIds } },
        { companyBId: { in: companyIds } },
      ],
    },
    include: {
      companyA: { select: { id: true, name: true } },
      companyB: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}
