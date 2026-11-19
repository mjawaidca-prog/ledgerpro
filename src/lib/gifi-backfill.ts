/**
 * GIFI backfill for existing companies (GIFI plan §5 / decision D4).
 *
 * Every company created before the pre-coded templates shipped has a
 * chart full of accounts with `gifiCode = null`, even where the account
 * IS a default-template account whose code we know. This routine fills
 * exactly those — and nothing else:
 *
 *  - an account is filled only when its LedgerPro code AND its name
 *    both match a template account (name compared trimmed and
 *    case-insensitively — whitespace/case only, never fuzzy). Account
 *    codes are unique per company, but a user may have reused a
 *    template code for a different account, so the code alone is not
 *    proof; the name alone is not either.
 *  - an account that already carries ANY stored GIFI value is never
 *    overwritten — not even an invalid one (a user typed it; the
 *    readiness list flags it for a human instead).
 *  - template accounts that are deliberately uncoded (Retained
 *    Earnings, Opening Balance Equity, Owner's Capital/Draw,
 *    Miscellaneous Expense) never fill anything.
 *  - the template is chosen by the company's businessType, so a
 *    corporation matches against the corporation variant (Share
 *    Capital → 3500, Due from Shareholder → 1301, …).
 *
 * Idempotent: a second run fills nothing. Run at ship time via
 * scripts/backfill-gifi-codes.ts (dry-run unless --apply).
 */

import { chartTemplateForBusinessType } from '@/lib/default-coa';

export interface GifiBackfillAccount {
  id: string;
  code: string;
  name: string;
  gifiCode: string | null;
}

export interface GifiBackfillClient {
  chartOfAccount: {
    findMany: (args: {
      where: { companyId: string };
      select: { id: true; code: true; name: true; gifiCode: true };
    }) => Promise<GifiBackfillAccount[]>;
    update: (args: {
      where: { id: string };
      data: { gifiCode: string };
    }) => Promise<unknown>;
  };
}

export interface GifiBackfillFill {
  accountCode: string;
  accountName: string;
  gifiCode: string;
}

export interface GifiBackfillResult {
  companyId: string;
  /** Accounts examined. */
  scanned: number;
  /** Accounts this run filled (or would fill, when apply=false). */
  filled: number;
  /** Accounts that already carried a stored GIFI value — untouched. */
  alreadyCoded: number;
  /** Uncoded accounts with no exact template match — left for the readiness list. */
  noMatch: number;
  fills: GifiBackfillFill[];
}

function matchKey(code: string, name: string): string {
  return `${code}\0${name.trim().toLowerCase()}`;
}

export async function backfillGifiCodesForCompany(
  companyId: string,
  client: GifiBackfillClient,
  options?: { businessType?: string | null; apply?: boolean },
): Promise<GifiBackfillResult> {
  const apply = options?.apply ?? true;
  const template = chartTemplateForBusinessType(options?.businessType);
  const codedTemplate = new Map<string, string>();
  for (const account of template) {
    if (account.gifiCode) {
      codedTemplate.set(matchKey(account.code, account.name), account.gifiCode);
    }
  }

  const accounts = await client.chartOfAccount.findMany({
    where: { companyId },
    select: { id: true, code: true, name: true, gifiCode: true },
  });

  const result: GifiBackfillResult = {
    companyId,
    scanned: accounts.length,
    filled: 0,
    alreadyCoded: 0,
    noMatch: 0,
    fills: [],
  };

  for (const account of accounts) {
    if (account.gifiCode !== null && account.gifiCode.trim() !== '') {
      result.alreadyCoded++;
      continue;
    }
    const gifiCode = codedTemplate.get(matchKey(account.code, account.name));
    if (!gifiCode) {
      result.noMatch++;
      continue;
    }
    if (apply) {
      await client.chartOfAccount.update({
        where: { id: account.id },
        data: { gifiCode },
      });
    }
    result.filled++;
    result.fills.push({ accountCode: account.code, accountName: account.name, gifiCode });
  }

  return result;
}
