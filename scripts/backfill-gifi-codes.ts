/**
 * Backfill script: GIFI codes for existing companies (GIFI plan §5 / D4).
 *
 * Companies created before the pre-coded chart templates shipped have
 * template accounts with no GIFI code. This fills an account ONLY when
 * its LedgerPro code AND name exactly match a template account (of the
 * template for the company's businessType) and it currently has no
 * code. It never overwrites a stored value. See src/lib/gifi-backfill.ts
 * for the full rule set. Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-gifi-codes.ts           # dry run (report only)
 *   npx tsx scripts/backfill-gifi-codes.ts --apply   # actually write codes
 */

import { PrismaClient } from '@prisma/client';
import { backfillGifiCodesForCompany } from '../src/lib/gifi-backfill';

const db = new PrismaClient();

async function main() {
  const apply = process.argv.slice(2).includes('--apply');
  console.log(apply ? '🔧 APPLY mode — will write GIFI codes' : '🔍 DRY RUN — reporting only (use --apply to write)');
  console.log('');

  const companies = await db.company.findMany({
    select: { id: true, name: true, businessType: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Found ${companies.length} companies\n`);

  let totalFilled = 0;
  let totalScanned = 0;
  for (const company of companies) {
    const result = await backfillGifiCodesForCompany(company.id, db as any, {
      businessType: company.businessType,
      apply,
    });
    totalFilled += result.filled;
    totalScanned += result.scanned;
    console.log(
      `${company.name} [${company.businessType ?? 'unset'}]: ` +
        `${result.scanned} accounts — ${apply ? 'filled' : 'would fill'} ${result.filled}, ` +
        `already coded ${result.alreadyCoded}, no template match ${result.noMatch}`,
    );
    for (const fill of result.fills) {
      console.log(`    ${fill.accountCode} ${fill.accountName} → GIFI ${fill.gifiCode}`);
    }
  }

  console.log('');
  console.log(`Total: ${totalScanned} accounts scanned, ${totalFilled} ${apply ? 'filled' : 'would be filled'}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
