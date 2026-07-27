import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  try {
    const companies = await db.company.findMany({ take: 1, select: { id: true, name: true } });
    console.log('Companies:', JSON.stringify(companies));

    if (companies.length > 0) {
      const id = companies[0].id;

      const coa = await db.chartOfAccount.findMany({
        where: { companyId: id, type: 'expense', active: true },
        select: { name: true, balance: true, code: true },
        take: 2
      });
      console.log('COA query OK:', JSON.stringify(coa));

      const txns = await db.transaction.findMany({
        where: { companyId: id },
        select: { amount: true, description: true, category: { select: { type: true } } },
        take: 2
      });
      console.log('Transactions query OK:', JSON.stringify(txns));

      const je = await db.journalEntry.findMany({
        where: { companyId: id },
        include: { lines: { select: { debit: true, credit: true, glAccountCode: true } } },
        take: 2
      });
      console.log('Journal entries query OK:', je.length, 'entries');
    }
    console.log('All queries passed');
  } catch(e: any) {
    console.error('ERROR:', e.message);
    console.error('STACK:', e.stack?.slice(0, 500));
  }
  await db.$disconnect();
}

main();
