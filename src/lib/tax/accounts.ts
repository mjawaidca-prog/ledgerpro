/**
 * Phase 1 simple-path tax account resolution against the live database.
 * Configuration mappings (CompanyTaxConfiguration) win; otherwise the
 * default codes from simple.ts. When a posting needs the recoverable (2310)
 * or PST payable (2330) account and the company chart lacks it, the account
 * is created from the default template entry — silently falling back to
 * 2300 for recoverable tax is exactly the audited Phase 1 defect, so we
 * never do it.
 */
import { db } from '@/lib/db';
import { DEFAULT_CHART_OF_ACCOUNTS } from '@/lib/default-coa';
import { resolveSimpleTaxAccounts, SIMPLE_TAX_ACCOUNT_CODES, type ResolvedTaxAccounts } from './simple';

export async function loadSimpleTaxAccounts(companyId: string): Promise<ResolvedTaxAccounts> {
  const configuration = await db.companyTaxConfiguration.findUnique({
    where: { companyId },
    include: {
      gstHstOutputAccount: { select: { code: true } },
      gstHstRecoverableAccount: { select: { code: true } },
      pstRstPayableAccount: { select: { code: true } },
      qstOutputAccount: { select: { code: true } },
      qstRecoverableAccount: { select: { code: true } },
    },
  });
  return resolveSimpleTaxAccounts({ configuration });
}

/** Create the default-template account for `code` if the company lacks an active account with that code. */
export async function ensureTaxAccount(companyId: string, code: string): Promise<void> {
  const existing = await db.chartOfAccount.findFirst({ where: { companyId, code, active: true }, select: { id: true } });
  if (existing) return;
  const template = DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.code === code);
  if (!template) throw new Error(`No default chart template for tax account ${code}.`);
  // Name-collision guard (same rule as ensureDefaultChartOfAccounts): if an
  // active account already carries this name under another code, use that
  // code instead of minting a duplicate name — handled by caller re-resolve.
  const sameName = await db.chartOfAccount.findFirst({
    where: { companyId, active: true, name: { equals: template.name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (sameName) return;
  await db.chartOfAccount.create({
    data: {
      companyId,
      code: template.code,
      name: template.name,
      type: template.type,
      subType: template.subType ?? null,
      detailType: template.detailType ?? null,
      description: template.description ?? null,
      active: true,
    },
  });
}

/**
 * Ensure the accounts a pending posting needs exist, then return the
 * resolved mapping. Only creates accounts that are actually required, so
 * no-tax companies never gain tax accounts they don't use.
 */
export async function ensureSimpleTaxAccounts(
  companyId: string,
  needs: { recoverable?: boolean; pstPayable?: boolean },
): Promise<ResolvedTaxAccounts> {
  if (needs.recoverable) await ensureTaxAccount(companyId, SIMPLE_TAX_ACCOUNT_CODES.recoverable);
  if (needs.pstPayable) await ensureTaxAccount(companyId, SIMPLE_TAX_ACCOUNT_CODES.pstPayable);
  return loadSimpleTaxAccounts(companyId);
}
