/**
 * Backfill script for inter-company transactions.
 *
 * Finds historical journal entries that reference a control account
 * (isControlAccount: true) but were never recorded in the
 * InterCompanyTransaction table. Records them as UNMATCHED so they
 * surface on the reconciliation report instead of silently distorting
 * the group.
 *
 * This script NEVER invents a mirror entry — it only registers the
 * source side as unmatched, which can then be resolved through the
 * Related Parties UI.
 *
 * Usage:
 *   npx tsx scripts/backfill-intercompany.ts           # dry run (report only)
 *   npx tsx scripts/backfill-intercompany.ts --apply   # actually create records
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  console.log(apply ? '🔧 APPLY mode — will create records' : '🔍 DRY RUN — reporting only (use --apply to create)');
  console.log('');

  // Find all control accounts
  const controlAccounts = await db.chartOfAccount.findMany({
    where: { isControlAccount: true },
    select: { code: true, companyId: true, name: true, relatedPartyCompanyId: true },
  });

  console.log(`Found ${controlAccounts.length} control accounts\n`);

  const codesByCompany = new Map<string, typeof controlAccounts>();
  for (const a of controlAccounts) {
    const existing = codesByCompany.get(a.companyId) || [];
    existing.push(a);
    codesByCompany.set(a.companyId, existing);
  }

  let totalFound = 0;
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const [companyId, accounts] of codesByCompany) {
    const codes = accounts.map((a) => a.code);

    const lines = await db.journalLine.findMany({
      where: {
        glAccountCode: { in: codes },
        journalEntry: {
          companyId,
          interCompanyId: null,
          voidedAt: null,
        },
      },
      include: {
        journalEntry: { select: { id: true, entryDate: true, description: true, createdBy: true } },
      },
      orderBy: { journalEntry: { entryDate: 'desc' } },
      take: 200,
    });

    if (lines.length === 0) continue;

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });

    console.log(`\n${company?.name || companyId} — ${lines.length} unmatched lines:`);

    for (const line of lines) {
      const account = accounts.find((a) => a.code === line.glAccountCode);
      const entry = line.journalEntry;

      console.log(
        `  ${entry.entryDate.toISOString().slice(0, 10)}  ${entry.id.slice(0, 10)}...  ` +
        `${line.glAccountCode} (${account?.name})  ` +
        `Dr ${line.debit}  Cr ${line.credit}  — "${entry.description}"`
      );
      totalFound++;

      if (apply && account?.relatedPartyCompanyId) {
        try {
          // Check if a link already exists between these companies
          const [aId, bId] = [companyId, account.relatedPartyCompanyId].sort();
          const link = await db.relatedPartyLink.findUnique({
            where: { companyAId_companyBId: { companyAId: aId, companyBId: bId } },
          });

          if (link) {
            const reference = `IC-LEGACY-${entry.id.slice(0, 8)}`;
            await db.interCompanyTransaction.create({
              data: {
                reference,
                linkId: link.id,
                sourceCompanyId: companyId,
                targetCompanyId: account.relatedPartyCompanyId,
                kind: 'JOURNAL',
                date: entry.entryDate,
                amount: (Number(line.debit) || Number(line.credit)).toFixed(2) as any,
                memo: `[Legacy] ${entry.description}`,
                sourceEntryId: entry.id,
                status: 'UNMATCHED',
                createdById: entry.createdBy || '',
              },
            });

            // Mark the journal entry
            await db.journalEntry.update({
              where: { id: entry.id },
              data: { interCompanyId: reference },
            });

            console.log(`    → Created UNMATCHED ${reference}`);
            totalCreated++;
          } else {
            console.log(`    → Skipped: no link exists between ${companyId} and ${account.relatedPartyCompanyId}`);
            totalSkipped++;
          }
        } catch (e: any) {
          console.log(`    → Error: ${e.message}`);
          totalSkipped++;
        }
      }
    }
  }

  console.log(`\n──────────────────────────────`);
  console.log(`Total unmatched lines found: ${totalFound}`);
  if (apply) {
    console.log(`Records created: ${totalCreated}`);
    console.log(`Skipped: ${totalSkipped}`);
  } else {
    console.log(`Run with --apply to create ${totalFound} unmatched records`);
  }
  console.log('');

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
