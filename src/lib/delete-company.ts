/**
 * Phase 0.2 — permanent company deletion (data purge).
 *
 * LedgerPro had NO way to delete a company: no UI control and no DELETE
 * route. Owners accumulated dead stub companies (e.g. an empty duplicate
 * named "2751623" next to the real "2751623 Alberta Corporation") with
 * no remedy. This module is the data half of the fix; the route half is
 * src/app/api/companies/[id]/route.ts.
 *
 * WHY AN EXPLICIT ORDERED PURGE: prisma/schema.prisma does NOT cascade
 * Company -> most children. Membership/Subscription and ~18 models use
 * onDelete: Cascade, but the core bookkeeping models (ChartOfAccount,
 * FinancialAccount, Transaction, JournalEntry, Invoice, Bill, Contact,
 * ImportBatch, AuditLog, Budget, PeriodClose, TransferMatch) declare NO
 * onDelete (Prisma default = Restrict for required relations), and the
 * tax-workpaper models (DocumentLineTaxSnapshot, TaxPosting,
 * TaxReturnWorkpaper, TaxWorkpaperRemittance) explicitly Restrict.
 * A bare `company.delete()` therefore fails on any company that has
 * ever had a chart of accounts — i.e. every real company. Rather than a
 * schema migration rewriting every FK, we delete child rows explicitly,
 * inside ONE transaction, children before parents, in the FK-safe
 * order below.
 *
 * The order was derived from schema.prisma (58 models) by listing every
 * relation that can point at a company-owned row. Global models with no
 * company scope (User, Plan, TaxRate, ExchangeRate, ReportPackage —
 * user-scoped) are never touched.
 */

// Prisma delegate names, in FK-safe deletion order (children first).
// Each entry is applied with a company-scoped `where` (see steps()).
export const COMPANY_PURGE_DELEGATES = [
  // ── Grandchildren (no companyId of their own; scoped via parent) ──
  'documentLineTaxComponent', // via snapshot.companyId
  'apiRateCounter', // via apiKey.companyId
  'webhookDelivery', // via endpoint.companyId
  'bankFeedTransaction', // via connection.companyId
  'bankSyncRun', // via connection.companyId
  'bankFeedAccount', // via connection.companyId
  'taxWorkpaperRemittance',
  'documentLineTaxSnapshot', // self-ref reversalOfId nulled first (see steps)
  'taxPosting', // self-ref reversalOfId nulled first
  'taxReturnWorkpaper',
  'fxRevaluation',
  'interCompanyTransaction', // via link companyAId/companyBId or its entries
  'journalLine', // via journalEntry.companyId
  'transferMatch', // must precede journalEntry (entries restrict-reference it)
  'journalEntry', // self-ref reversalOfId nulled first
  'transaction',
  'invoiceLineItem', // via invoice.companyId
  'billLineItem', // via bill.companyId
  'invoice',
  'bill',
  'budgetLine', // via budget.companyId
  'budget',
  'recurringLine', // via template.companyId
  'recurringTemplate',
  'taxCodeComponent', // via taxCodeVersion.taxCode.companyId
  'taxCodeVersion', // via taxCode.companyId
  'taxCode',
  'companyTaxConfiguration', // restrict-references chart accounts: before them
  'companyTaxRegistration',
  'categorizationRule',
  'bankRule',
  'reconciliation',
  'statementImport',
  'importBatch', // precedes columnMapping (batches reference mappings)
  'columnMapping', // via account.companyId
  'importPreset',
  'importReminder',
  'fxFeedStatus',
  'reportTemplate',
  'apiIdempotencyRecord',
  'apiKey',
  'webhookEndpoint',
  'bankConnection',
  'contact',
  'periodClose',
  'auditLog',
  'notification', // companyId column but NO FK relation — orphans otherwise
  'chartOfAccount',
  'financialAccount',
  'relatedPartyLink', // companyAId OR companyBId (cross-company guardrail)
  'subscription',
  'membership',
] as const;

export type CompanyPurgeDelegate = (typeof COMPANY_PURGE_DELEGATES)[number];

/** One executable purge step against a Prisma-like client. */
export interface PurgeStep {
  delegate: CompanyPurgeDelegate | 'taxPostingUpdate' | 'documentLineTaxSnapshotUpdate' | 'journalEntryUpdate' | 'company';
  run: (tx: any) => Promise<unknown>;
}

/**
 * Build the ordered purge steps for one company. Pure construction (no
 * DB calls) so tests can assert the full ordered operation list; the
 * route executes them inside db.$transaction.
 *
 * Cross-company guardrails: intercompany rows can reference the OTHER
 * company's data (a RelatedPartyLink pairs two companies; an
 * InterCompanyTransaction's mirror entry can live in the other
 * company's books). Deleting this company necessarily removes those
 * link/transaction rows — they cannot exist with one side gone, and
 * their Restrict/default FKs would otherwise block the purge. The other
 * company's own journal entries are NEVER deleted: only rows scoped to
 * this company (plus the shared link rows themselves) are removed.
 */
export function companyPurgeSteps(companyId: string): PurgeStep[] {
  const byCompany = { where: { companyId } };
  const steps: PurgeStep[] = [
    // Grandchildren scoped through their parent relation.
    { delegate: 'documentLineTaxComponent', run: (tx) => tx.documentLineTaxComponent.deleteMany({ where: { snapshot: { companyId } } }) },
    { delegate: 'apiRateCounter', run: (tx) => tx.apiRateCounter.deleteMany({ where: { apiKey: { companyId } } }) },
    { delegate: 'webhookDelivery', run: (tx) => tx.webhookDelivery.deleteMany({ where: { endpoint: { companyId } } }) },
    { delegate: 'bankFeedTransaction', run: (tx) => tx.bankFeedTransaction.deleteMany({ where: { connection: { companyId } } }) },
    { delegate: 'bankSyncRun', run: (tx) => tx.bankSyncRun.deleteMany({ where: { connection: { companyId } } }) },
    { delegate: 'bankFeedAccount', run: (tx) => tx.bankFeedAccount.deleteMany({ where: { connection: { companyId } } }) },

    { delegate: 'taxWorkpaperRemittance', run: (tx) => tx.taxWorkpaperRemittance.deleteMany(byCompany) },

    // Self-referencing reversal chains: clear the self-FK first so the
    // deleteMany cannot trip its own Restrict/NoAction constraint.
    { delegate: 'documentLineTaxSnapshotUpdate', run: (tx) => tx.documentLineTaxSnapshot.updateMany({ where: { companyId }, data: { reversalOfId: null } }) },
    { delegate: 'documentLineTaxSnapshot', run: (tx) => tx.documentLineTaxSnapshot.deleteMany(byCompany) },
    { delegate: 'taxPostingUpdate', run: (tx) => tx.taxPosting.updateMany({ where: { companyId }, data: { reversalOfId: null } }) },
    { delegate: 'taxPosting', run: (tx) => tx.taxPosting.deleteMany(byCompany) },
    { delegate: 'taxReturnWorkpaper', run: (tx) => tx.taxReturnWorkpaper.deleteMany(byCompany) },
    { delegate: 'fxRevaluation', run: (tx) => tx.fxRevaluation.deleteMany(byCompany) },

    // Intercompany transactions whose link touches this company OR
    // whose source/mirror entry belongs to this company.
    {
      delegate: 'interCompanyTransaction',
      run: (tx) => tx.interCompanyTransaction.deleteMany({
        where: {
          OR: [
            { link: { companyAId: companyId } },
            { link: { companyBId: companyId } },
            { sourceEntry: { companyId } },
            { mirrorEntry: { companyId } },
          ],
        },
      }),
    },

    { delegate: 'journalLine', run: (tx) => tx.journalLine.deleteMany({ where: { journalEntry: { companyId } } }) },
    { delegate: 'transferMatch', run: (tx) => tx.transferMatch.deleteMany(byCompany) },
    { delegate: 'journalEntryUpdate', run: (tx) => tx.journalEntry.updateMany({ where: { companyId }, data: { reversalOfId: null } }) },
    { delegate: 'journalEntry', run: (tx) => tx.journalEntry.deleteMany(byCompany) },

    { delegate: 'transaction', run: (tx) => tx.transaction.deleteMany(byCompany) },

    { delegate: 'invoiceLineItem', run: (tx) => tx.invoiceLineItem.deleteMany({ where: { invoice: { companyId } } }) },
    { delegate: 'billLineItem', run: (tx) => tx.billLineItem.deleteMany({ where: { bill: { companyId } } }) },
    { delegate: 'invoice', run: (tx) => tx.invoice.deleteMany(byCompany) },
    { delegate: 'bill', run: (tx) => tx.bill.deleteMany(byCompany) },

    { delegate: 'budgetLine', run: (tx) => tx.budgetLine.deleteMany({ where: { budget: { companyId } } }) },
    { delegate: 'budget', run: (tx) => tx.budget.deleteMany(byCompany) },
    { delegate: 'recurringLine', run: (tx) => tx.recurringLine.deleteMany({ where: { template: { companyId } } }) },
    { delegate: 'recurringTemplate', run: (tx) => tx.recurringTemplate.deleteMany(byCompany) },

    { delegate: 'taxCodeComponent', run: (tx) => tx.taxCodeComponent.deleteMany({ where: { taxCodeVersion: { taxCode: { companyId } } } }) },
    { delegate: 'taxCodeVersion', run: (tx) => tx.taxCodeVersion.deleteMany({ where: { taxCode: { companyId } } }) },
    { delegate: 'taxCode', run: (tx) => tx.taxCode.deleteMany(byCompany) },

    { delegate: 'companyTaxConfiguration', run: (tx) => tx.companyTaxConfiguration.deleteMany(byCompany) },
    { delegate: 'companyTaxRegistration', run: (tx) => tx.companyTaxRegistration.deleteMany(byCompany) },
    { delegate: 'categorizationRule', run: (tx) => tx.categorizationRule.deleteMany(byCompany) },
    { delegate: 'bankRule', run: (tx) => tx.bankRule.deleteMany(byCompany) },
    { delegate: 'reconciliation', run: (tx) => tx.reconciliation.deleteMany(byCompany) },
    { delegate: 'statementImport', run: (tx) => tx.statementImport.deleteMany(byCompany) },
    { delegate: 'importBatch', run: (tx) => tx.importBatch.deleteMany(byCompany) },
    { delegate: 'columnMapping', run: (tx) => tx.columnMapping.deleteMany({ where: { account: { companyId } } }) },
    { delegate: 'importPreset', run: (tx) => tx.importPreset.deleteMany(byCompany) },
    { delegate: 'importReminder', run: (tx) => tx.importReminder.deleteMany(byCompany) },
    { delegate: 'fxFeedStatus', run: (tx) => tx.fxFeedStatus.deleteMany(byCompany) },
    { delegate: 'reportTemplate', run: (tx) => tx.reportTemplate.deleteMany(byCompany) },
    { delegate: 'apiIdempotencyRecord', run: (tx) => tx.apiIdempotencyRecord.deleteMany(byCompany) },
    { delegate: 'apiKey', run: (tx) => tx.apiKey.deleteMany(byCompany) },
    { delegate: 'webhookEndpoint', run: (tx) => tx.webhookEndpoint.deleteMany(byCompany) },
    { delegate: 'bankConnection', run: (tx) => tx.bankConnection.deleteMany(byCompany) },

    { delegate: 'contact', run: (tx) => tx.contact.deleteMany(byCompany) },
    { delegate: 'periodClose', run: (tx) => tx.periodClose.deleteMany(byCompany) },
    { delegate: 'auditLog', run: (tx) => tx.auditLog.deleteMany(byCompany) },
    { delegate: 'notification', run: (tx) => tx.notification.deleteMany(byCompany) },
    { delegate: 'chartOfAccount', run: (tx) => tx.chartOfAccount.deleteMany(byCompany) },
    { delegate: 'financialAccount', run: (tx) => tx.financialAccount.deleteMany(byCompany) },

    {
      delegate: 'relatedPartyLink',
      run: (tx) => tx.relatedPartyLink.deleteMany({ where: { OR: [{ companyAId: companyId }, { companyBId: companyId }] } }),
    },
    { delegate: 'subscription', run: (tx) => tx.subscription.deleteMany(byCompany) },
    { delegate: 'membership', run: (tx) => tx.membership.deleteMany(byCompany) },

    { delegate: 'company', run: (tx) => tx.company.delete({ where: { id: companyId } }) },
  ];
  return steps;
}

/** Execute the full purge inside the caller's transaction client. */
export async function purgeCompany(tx: any, companyId: string): Promise<void> {
  for (const step of companyPurgeSteps(companyId)) {
    await step.run(tx);
  }
}

/**
 * The name the user must type to confirm deletion: the legal name when
 * one is set (it is the company's identity on reports), else the plain
 * name — the same preference as companyDisplayName(). The server
 * accepts EITHER name or legalName as an exact match (both unambiguously
 * identify this company to its owner); this picks the one the UI asks
 * for.
 */
export function companyConfirmationName(company: { name?: string | null; legalName?: string | null }): string {
  return company?.legalName || company?.name || '';
}

export function confirmationMatches(
  typed: unknown,
  company: { name?: string | null; legalName?: string | null }
): boolean {
  if (typeof typed !== 'string') return false;
  const t = typed.trim();
  if (!t) return false;
  return t === (company.name ?? '') || t === (company.legalName ?? '');
}
