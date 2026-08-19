/**
 * LedgerPro — Company data backup & restore.
 *
 * Export produces a full, portable JSON snapshot of one company's data.
 * Restore never overwrites an existing company — it always creates a brand
 * new one and rebuilds every record under it with fresh IDs, remapping all
 * internal references (categoryId, customerId, vendorId, sourceId, etc.)
 * via old-id -> new-id maps built as each entity type is recreated.
 *
 * Deliberately excluded from both export and restore: audit log history,
 * notifications, import batches/column mapping profiles, transfer-match
 * records, and report templates. These are operational/history metadata,
 * not the accounting data itself — restoring them would either be
 * meaningless (audit log for actions that never happened in the new
 * company) or add substantial complexity for little value. Journal entries
 * whose sourceType is 'transfer' still restore, just without their
 * TransferMatch link (sourceId is dropped for that one sourceType).
 */

import { db } from '@/lib/db';

export const BACKUP_FORMAT_VERSION = 1;

export async function exportCompanyBundle(companyId: string) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });

  const [
    chartOfAccounts,
    financialAccounts,
    contacts,
    transactions,
    journalEntries,
    invoices,
    bills,
    budgets,
    recurringTemplates,
    categorizationRules,
    periodCloses,
    fxRevaluations,
  ] = await Promise.all([
    db.chartOfAccount.findMany({ where: { companyId } }),
    db.financialAccount.findMany({ where: { companyId } }),
    db.contact.findMany({ where: { companyId } }),
    db.transaction.findMany({ where: { companyId } }),
    db.journalEntry.findMany({ where: { companyId }, include: { lines: true } }),
    db.invoice.findMany({ where: { companyId }, include: { lineItems: true } }),
    db.bill.findMany({ where: { companyId }, include: { lineItems: true } }),
    db.budget.findMany({ where: { companyId }, include: { lines: true } }),
    db.recurringTemplate.findMany({ where: { companyId }, include: { lines: true } }),
    db.categorizationRule.findMany({ where: { companyId } }),
    db.periodClose.findMany({ where: { companyId } }),
    db.fxRevaluation.findMany({ where: { companyId } }),
  ]);

  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    company: {
      name: company.name,
      legalName: company.legalName,
      fiscalYearStart: company.fiscalYearStart,
      fiscalYearEnd: company.fiscalYearEnd,
      businessType: company.businessType,
      businessNumber: company.businessNumber,
      gstNumber: company.gstNumber,
      province: company.province,
      currency: company.currency,
      locale: company.locale,
      timezone: company.timezone,
      enabledCurrencies: company.enabledCurrencies,
      rateSource: company.rateSource,
      realizedFxAccountCode: company.realizedFxAccountCode,
      unrealizedFxAccountCode: company.unrealizedFxAccountCode,
      fxRoundingAccountCode: company.fxRoundingAccountCode,
    },
    chartOfAccounts,
    financialAccounts,
    contacts,
    transactions,
    journalEntries,
    invoices,
    bills,
    budgets,
    recurringTemplates,
    categorizationRules,
    periodCloses,
    fxRevaluations,
  };
}

export type CompanyBackupBundle = Awaited<ReturnType<typeof exportCompanyBundle>>;

/**
 * Recreate a full company from an exported bundle under a brand-new
 * companyId. `restoredName` overrides the company name (defaults to
 * "<original name> (Restored)") so it's visually distinguishable from the
 * original if that company still exists.
 */
export async function restoreCompanyBundle(
  bundle: CompanyBackupBundle,
  userId: string,
  restoredName?: string
) {
  if (bundle.version !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup format version: ${bundle.version}`);
  }

  return db.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        ...bundle.company,
        name: restoredName || `${bundle.company.name} (Restored)`,
        fiscalYearStart: new Date(bundle.company.fiscalYearStart),
        fiscalYearEnd: bundle.company.fiscalYearEnd ? new Date(bundle.company.fiscalYearEnd) : null,
        onboardingComplete: true,
      },
    });

    await tx.membership.create({
      data: { userId, companyId: company.id, role: 'owner' },
    });

    const coaIdMap = new Map<string, string>();
    for (const acct of bundle.chartOfAccounts) {
      const created = await tx.chartOfAccount.create({
        data: {
          companyId: company.id,
          code: acct.code,
          name: acct.name,
          type: acct.type,
          detailType: acct.detailType,
          parentCode: acct.parentCode,
          description: acct.description,
          balance: acct.balance,
          active: acct.active,
        },
      });
      coaIdMap.set(acct.id, created.id);
    }

    const finAcctIdMap = new Map<string, string>();
    for (const fa of bundle.financialAccounts) {
      const created = await tx.financialAccount.create({
        data: {
          companyId: company.id,
          name: fa.name,
          mask: fa.mask,
          kind: fa.kind,
          currency: fa.currency,
          currentBalance: fa.currentBalance,
          glAccountCode: fa.glAccountCode,
          syncStatus: 'manual', // bank feed connections don't carry over — reconnect manually
          displayColor: fa.displayColor,
          logoInitials: fa.logoInitials,
          isActive: fa.isActive,
        },
      });
      finAcctIdMap.set(fa.id, created.id);
    }

    const contactIdMap = new Map<string, string>();
    for (const c of bundle.contacts) {
      const created = await tx.contact.create({
        data: {
          companyId: company.id,
          name: c.name,
          companyName: c.companyName,
          type: c.type,
          email: c.email,
          currency: c.currency,
          phone: c.phone,
          address: c.address,
          outstandingBalance: c.outstandingBalance,
          status: c.status,
          notes: c.notes,
        },
      });
      contactIdMap.set(c.id, created.id);
    }

    const txIdMap = new Map<string, string>();
    for (const t of bundle.transactions) {
      const created = await tx.transaction.create({
        data: {
          companyId: company.id,
          financialAccountId: finAcctIdMap.get(t.financialAccountId)!,
          date: t.date,
          description: t.description,
          merchant: t.merchant,
          rawStatementText: t.rawStatementText,
          amount: t.amount,
          currency: t.currency,
          fxRate: t.fxRate,
          amountHome: t.amountHome,
          categoryId: t.categoryId ? coaIdMap.get(t.categoryId) ?? null : null,
          suggestedCategoryId: null,
          status: t.status,
          excludeReason: t.excludeReason,
          matchRef: null, // fixed up in a second pass once journal entry IDs exist
          reconciledAt: t.reconciledAt,
          reconciledBy: t.reconciledBy,
          voidedAt: t.voidedAt,
          voidedBy: t.voidedBy,
          source: t.source,
        },
      });
      txIdMap.set(t.id, created.id);
    }

    const invoiceIdMap = new Map<string, string>();
    for (const inv of bundle.invoices) {
      const created = await tx.invoice.create({
        data: {
          id: `INV-${Math.floor(Math.random() * 900000) + 100000}`,
          companyId: company.id,
          customerId: contactIdMap.get(inv.customerId)!,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          terms: inv.terms,
          currency: inv.currency,
          subtotal: inv.subtotal,
          taxRate: inv.taxRate,
          taxAmount: inv.taxAmount,
          total: inv.total,
          status: inv.status,
          sentAt: inv.sentAt,
          paidAt: inv.paidAt,
          paidAmount: inv.paidAmount,
          fxRate: inv.fxRate,
          fxRateSource: inv.fxRateSource,
          fxRateDate: inv.fxRateDate,
          totalHome: inv.totalHome,
          paidAmountHome: inv.paidAmountHome,
          notes: inv.notes,
          paymentAccountId: inv.paymentAccountId ? finAcctIdMap.get(inv.paymentAccountId) ?? null : null,
          lineItems: {
            create: inv.lineItems.map((li) => ({
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              amount: li.amount,
              categoryId: li.categoryId ? coaIdMap.get(li.categoryId) ?? null : null,
              sortOrder: li.sortOrder,
            })),
          },
        },
      });
      invoiceIdMap.set(inv.id, created.id);
    }

    const billIdMap = new Map<string, string>();
    for (const bill of bundle.bills) {
      const created = await tx.bill.create({
        data: {
          id: `${bill.kind === 'bill' ? 'BILL' : 'EXP'}-${Math.floor(Math.random() * 900000) + 100000}`,
          companyId: company.id,
          kind: bill.kind,
          vendorId: contactIdMap.get(bill.vendorId)!,
          billDate: bill.billDate,
          dueDate: bill.dueDate,
          terms: bill.terms,
          referenceNo: bill.referenceNo,
          subtotal: bill.subtotal,
          taxRate: bill.taxRate,
          taxAmount: bill.taxAmount,
          total: bill.total,
          currency: bill.currency,
          fxRate: bill.fxRate,
          fxRateSource: bill.fxRateSource,
          fxRateDate: bill.fxRateDate,
          totalHome: bill.totalHome,
          paidAmountHome: bill.paidAmountHome,
          importTaxAmount: bill.importTaxAmount,
          status: bill.status,
          paymentAccountId: bill.paymentAccountId ? finAcctIdMap.get(bill.paymentAccountId) ?? null : null,
          paidAt: bill.paidAt,
          paidAmount: bill.paidAmount,
          notes: bill.notes,
          attachments: bill.attachments,
          lineItems: {
            create: bill.lineItems.map((li) => ({
              description: li.description,
              amount: li.amount,
              categoryId: li.categoryId ? coaIdMap.get(li.categoryId) ?? null : null,
              sortOrder: li.sortOrder,
            })),
          },
        },
      });
      billIdMap.set(bill.id, created.id);
    }

    // sourceId points at whatever entity generated the entry, keyed by sourceType.
    function remapSourceId(sourceType: string, sourceId: string | null): string | null {
      if (!sourceId) return null;
      switch (sourceType) {
        case 'invoice': return invoiceIdMap.get(sourceId) ?? null;
        case 'bill': return billIdMap.get(sourceId) ?? null;
        case 'payment': return invoiceIdMap.get(sourceId) ?? billIdMap.get(sourceId) ?? txIdMap.get(sourceId) ?? null;
        case 'revaluation': return null; // remapped after FxRevaluation restore via journalIdMap
        default: return null; // 'transfer' link is dropped (TransferMatch isn't restored); 'manual' has no sourceId
      }
    }

    const journalIdMap = new Map<string, string>();
    for (const entry of bundle.journalEntries) {
      const created = await tx.journalEntry.create({
        data: {
          companyId: company.id,
          entryDate: entry.entryDate,
          description: entry.description,
          sourceType: entry.sourceType,
          sourceId: remapSourceId(entry.sourceType, entry.sourceId),
          createdBy: entry.createdBy,
          voidedAt: entry.voidedAt,
          voidedBy: entry.voidedBy,
          lines: {
            create: entry.lines.map((l) => ({
              glAccountCode: l.glAccountCode,
              description: l.description,
              currency: l.currency,
              fxRate: l.fxRate,
              debitForeign: l.debitForeign,
              creditForeign: l.creditForeign,
              debit: l.debit,
              credit: l.credit,
            })),
          },
        },
      });
      journalIdMap.set(entry.id, created.id);
    }

    // FxRevaluation — restore after journal entries so entry ids can be remapped.
    for (const reval of bundle.fxRevaluations ?? []) {
      const entryId = journalIdMap.get(reval.journalEntryId);
      if (!entryId) continue;
      const reversalId = reval.reversalEntryId ? journalIdMap.get(reval.reversalEntryId) ?? null : null;
      const created = await tx.fxRevaluation.create({
        data: {
          companyId: company.id,
          asOf: reval.asOf,
          rateType: reval.rateType,
          netAmount: reval.netAmount,
          journalEntryId: entryId,
          reversalEntryId: reversalId,
          lines: reval.lines as any, // JsonValue (read) → InputJsonValue (write)
          postedById: reval.postedById,
          postedAt: reval.postedAt,
          voidedAt: reval.voidedAt,
        },
      });
      // Point the two entries' sourceId at the restored revaluation id.
      await tx.journalEntry.updateMany({
        where: { id: { in: [entryId, reversalId].filter(Boolean) as string[] } },
        data: { sourceId: created.id },
      });
    }

    // Second pass: fix up cross-references that could only be resolved once
    // every entity in the cycle had a new ID (reconciled tx -> its journal
    // entry, and reversal entry -> the entry it reverses).
    for (const t of bundle.transactions) {
      if (!t.matchRef) continue;
      const newEntryId = journalIdMap.get(t.matchRef);
      if (!newEntryId) continue;
      await tx.transaction.update({ where: { id: txIdMap.get(t.id)! }, data: { matchRef: newEntryId } });
    }
    for (const entry of bundle.journalEntries) {
      if (!entry.reversalOfId) continue;
      const newOriginalId = journalIdMap.get(entry.reversalOfId);
      if (!newOriginalId) continue;
      await tx.journalEntry.update({ where: { id: journalIdMap.get(entry.id)! }, data: { reversalOfId: newOriginalId } });
    }

    for (const budget of bundle.budgets) {
      await tx.budget.create({
        data: {
          companyId: company.id,
          name: budget.name,
          fiscalYear: budget.fiscalYear,
          period: budget.period,
          lines: {
            create: budget.lines.map((l) => ({
              glAccountCode: l.glAccountCode,
              amount: l.amount,
              period: l.period,
            })),
          },
        },
      });
    }

    for (const template of bundle.recurringTemplates) {
      await tx.recurringTemplate.create({
        data: {
          companyId: company.id,
          name: template.name,
          description: template.description,
          frequency: template.frequency,
          nextPostDate: template.nextPostDate,
          endDate: template.endDate,
          active: template.active,
          sourceType: template.sourceType,
          lastPostedAt: template.lastPostedAt,
          timesPosted: template.timesPosted,
          lines: {
            create: template.lines.map((l) => ({
              glAccountCode: l.glAccountCode,
              description: l.description,
              debit: l.debit,
              credit: l.credit,
              sortOrder: l.sortOrder,
            })),
          },
        },
      });
    }

    for (const rule of bundle.categorizationRules) {
      const newCategoryId = coaIdMap.get(rule.categoryId);
      if (!newCategoryId) continue; // category no longer present — skip rather than fail the whole restore
      await tx.categorizationRule.create({
        data: {
          companyId: company.id,
          name: rule.name,
          pattern: rule.pattern,
          patternType: rule.patternType,
          categoryId: newCategoryId,
          minAmount: rule.minAmount,
          maxAmount: rule.maxAmount,
          priority: rule.priority,
          active: rule.active,
          matchCount: rule.matchCount,
          lastMatchedAt: rule.lastMatchedAt,
        },
      });
    }

    for (const pc of bundle.periodCloses) {
      await tx.periodClose.create({
        data: {
          companyId: company.id,
          periodStart: pc.periodStart,
          periodEnd: pc.periodEnd,
          closedBy: pc.closedBy,
          closedAt: pc.closedAt,
          status: pc.status,
          notes: pc.notes,
        },
      });
    }

    return company;
  }, { timeout: 60000, maxWait: 15000 });
}
