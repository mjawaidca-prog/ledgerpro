/**
 * LedgerPro — Related-party detection.
 *
 * After any manual journal entry saves, check its lines for control-account
 * hits and return a suggested mirror so the UI can prompt the user.
 * This catches entries that users hand-post to a Due from/To account instead
 * of using the dedicated inter-company form.
 */

import { db } from '@/lib/db';

export interface MirrorSuggestion {
  entryId: string;
  targetCompanyId: string;
  targetCompanyName: string;
  amount: string;
  direction: 'RECEIVABLE' | 'PAYABLE';
  suggestedKind: 'JOURNAL';
  controlAccountCode: string;
  controlAccountName: string;
}

/**
 * Check a journal entry for lines hitting a control account.
 * Returns a mirror suggestion if one is found, or null if the entry
 * is already linked or doesn't touch any inter-company accounts.
 */
export async function suggestMirror(
  entryId: string
): Promise<MirrorSuggestion | null> {
  const entry = await db.journalEntry.findUniqueOrThrow({
    where: { id: entryId },
    include: { lines: true },
  });

  // Already linked — nothing to suggest
  if (entry.interCompanyId) return null;

  // JournalLine has glAccountCode (string), not a relation — look up
  // the chart of account to check if any line hits a control account
  const hits: { line: (typeof entry.lines)[number]; account: { code: string; name: string; isControlAccount: boolean; relatedPartyCompanyId: string | null } }[] = [];

  for (const line of entry.lines) {
    const account = await db.chartOfAccount.findFirst({
      where: {
        code: line.glAccountCode,
        companyId: entry.companyId,
        isControlAccount: true,
        relatedPartyCompanyId: { not: null },
      },
    });
    if (account) {
      hits.push({ line, account });
    }
  }

  if (hits.length === 0) return null;

  // Use the first hit to generate the suggestion
  const hit = hits[0];
  const targetCompany = await db.company.findUnique({
    where: { id: hit.account.relatedPartyCompanyId! },
    select: { id: true, name: true },
  });

  if (!targetCompany) return null;

  const isDebit = Number(hit.line.debit) > 0;
  const amount = isDebit ? hit.line.debit.toString() : hit.line.credit.toString();

  return {
    entryId,
    targetCompanyId: targetCompany.id,
    targetCompanyName: targetCompany.name,
    amount,
    direction: isDebit ? 'RECEIVABLE' : 'PAYABLE',
    suggestedKind: 'JOURNAL',
    controlAccountCode: hit.account.code,
    controlAccountName: hit.account.name,
  };
}
