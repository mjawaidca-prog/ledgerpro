import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { ensureDefaultChartOfAccounts } from '@/lib/default-coa';

type CompanyClient = Prisma.TransactionClient | typeof db;

/**
 * Create a new company with its owner membership, trial subscription, and
 * default Chart of Accounts. Shared by new-user registration and by an
 * already-logged-in user adding an additional company, so both stay in sync.
 */
export async function createCompanyForUser(
  client: CompanyClient,
  userId: string,
  companyName: string,
) {
  const freePlan = await client.plan.findFirst({ where: { name: 'Free Trial' } });
  if (!freePlan) throw new Error('No free trial plan found. Run seed first.');

  const company = await client.company.create({
    data: {
      name: companyName,
      fiscalYearStart: new Date(new Date().getFullYear().toString() + '-01-01'),
      currency: 'CAD',
      locale: 'en-CA',
      timezone: 'America/Edmonton',
    },
  });

  await client.membership.create({
    data: { userId, companyId: company.id, role: 'owner' },
  });

  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + 30);
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await client.subscription.create({
    data: {
      companyId: company.id,
      planId: freePlan.id,
      status: 'trialing',
      trialEndsAt: trialEnd,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  });

  await ensureDefaultChartOfAccounts(company.id, client as any);

  return company;
}
