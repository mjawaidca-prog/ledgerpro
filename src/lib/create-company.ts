import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { ensureDefaultChartOfAccounts } from '@/lib/default-coa';
import { derivedFiscalYearEnd } from '@/lib/fiscal-year';

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

  const fiscalYearStart = new Date(new Date().getFullYear().toString() + '-01-01');
  const company = await client.company.create({
    data: {
      name: companyName,
      fiscalYearStart,
      // Phase 0 (P0-5): end is derived from start from day one, so a new
      // company's two fields can never start out inconsistent.
      fiscalYearEnd: new Date(`${derivedFiscalYearEnd(fiscalYearStart)}T00:00:00.000Z`),
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
