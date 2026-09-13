// BF-2: provider transaction synchronization.
//
// Sync pulls Plaid transactions/sync pages into the SAME review queue the
// statement import feeds: rows are created with status 'toreview', rules
// applied exactly like imports (auto-categorized but never posted), and the
// shared dedupeHash keeps feed rows and imported rows from both surviving.
// The provider transaction id acts as the OFX FITID in the dedupe key.
//
// Safety rules:
// - One sync per connection at a time (advisory lock + running-run guard).
// - The cursor advances ONLY inside the same transaction that commits a
//   page's rows — a partial failure re-reads from the last committed page.
// - Modified rows update only rows still in review (never reconciled, never
//   voided); anything else is recorded on the sync run, never silently
//   changed (formal correction alerts arrive in BF-3).
// - Removed rows mark the provider link; the LedgerPro row is NEVER deleted.
// - Nothing here creates journal entries — posting stays a human action.

import { db } from '@/lib/db';
import { decryptToken } from '@/lib/bank-feed/crypto';
import { syncTransactionsPage } from '@/lib/bank-feed/plaid-client';
import { makeDedupeKey } from '@/lib/banking/dedupe';
import { applyRules, type BankRuleLike } from '@/lib/banking/rules';

const PAGE_SIZE = 500;
const MAX_PAGES_PER_RUN = 8; // bounded per invocation; the next trigger continues
const SYNC_CUTOFF_SECONDS = 20; // serverless budget guard

function directionFor(amount: number): 'in' | 'out' {
  return amount > 0 ? 'in' : 'out';
}

async function loadRules(companyId: string): Promise<BankRuleLike[]> {
  const rules = await db.bankRule.findMany({ where: { companyId, enabled: true }, orderBy: { order: 'asc' } });
  return rules.map((r) => ({
    id: r.id,
    name: r.name,
    order: r.order,
    op: r.op,
    value: r.value,
    anyOf: r.anyOf,
    scope: r.scope as BankRuleLike['scope'],
    setCategoryCode: r.setCategoryCode,
    setTaxCode: r.setTaxCode,
    setTaxRate: r.setTaxRate ? Number(r.setTaxRate) : null,
    setTaxInclusive: r.setTaxInclusive,
    setContactId: r.setContactId,
    autoPost: r.autoPost,
    enabled: r.enabled,
  }));
}

export interface SyncOutcome {
  syncRunId: string;
  skipped: boolean;
  added: number;
  deduped: number;
  updated: number;
  removedMarked: number;
  blockedUpdates: number;
  pages: number;
}

/**
 * Runs one sync for a connection. Safe to call from the webhook, the cron,
 * or the manual "Sync now" button — the lock makes overlapping calls no-ops.
 */
export async function syncConnection(connectionId: string, trigger: 'webhook' | 'manual' | 'cron'): Promise<SyncOutcome> {
  const started = Date.now();
  const lockTag = `bfsync:${connectionId}`;

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockTag}, 0))`;

    const connection = await tx.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    if (connection.status === 'revoked' || connection.status === 'error') {
      throw new Error(`Connection is ${connection.status}.`);
    }

    const running = await tx.bankSyncRun.findFirst({
      where: { connectionId, status: 'running', startedAt: { gt: new Date(Date.now() - 15 * 60_000) } },
    });
    if (running) {
      return { syncRunId: running.id, skipped: true, added: 0, deduped: 0, updated: 0, removedMarked: 0, blockedUpdates: 0, pages: 0 };
    }

    const syncRun = await tx.bankSyncRun.create({
      data: { connectionId, trigger, status: 'running' },
    });

    const accounts = await tx.bankFeedAccount.findMany({ where: { connectionId, isFeeding: true } });
    const byProviderId = new Map(accounts.map((a) => [a.providerAccountId, a]));
    const rules = await loadRules(connection.companyId);
    const accessToken = decryptToken(connection.accessTokenEncrypted);

    let added = 0;
    let deduped = 0;
    let updated = 0;
    let removedMarked = 0;
    let blockedUpdates = 0;
    let pages = 0;
    let cursor = connection.transactionsCursor;

    try {
      for (;;) {
        if (Date.now() - started > SYNC_CUTOFF_SECONDS * 1000) break;

        const page = await syncTransactionsPage({ accessToken, cursor });
        pages += 1;

        for (const item of page.removed) {
          if (!item.transactionId) continue;
          const marked = await tx.bankFeedTransaction.updateMany({
            where: { providerTransactionId: item.transactionId, removedByProviderAt: null },
            data: { removedByProviderAt: new Date() },
          });
          removedMarked += marked.count;
        }

        for (const item of page.modified) {
          const link = await tx.bankFeedTransaction.findUnique({
            where: { providerAccountId_providerTransactionId: { providerAccountId: item.providerAccountId, providerTransactionId: item.providerTransactionId } },
            include: { transaction: { select: { id: true, status: true, reconciledInId: true, voidedAt: true } } },
          });
          if (!link?.transaction) continue;
          const row = link.transaction;
          // Only review-queue rows update in place; posted or reconciled
          // facts are never silently rewritten.
          if (row.reconciledInId || row.voidedAt || !['toreview', 'categorized'].includes(row.status)) {
            blockedUpdates += 1;
            continue;
          }
          await tx.transaction.update({
            where: { id: row.id },
            data: { date: new Date(item.date), description: item.description, amount: item.amount },
          });
          updated += 1;
        }

        for (const item of page.added) {
          const feedAccount = byProviderId.get(item.providerAccountId);
          if (!feedAccount || !feedAccount.financialAccountId) continue; // unmapped accounts never feed

          const dedupeHash = makeDedupeKey({
            date: item.date,
            amount: item.amount,
            description: item.description,
            fitid: item.providerTransactionId,
          });
          const existing = await tx.transaction.findFirst({
            where: { companyId: connection.companyId, financialAccountId: feedAccount.financialAccountId, dedupeHash },
            select: { id: true },
          });
          if (existing) {
            deduped += 1;
            // Still record the provider link so settlement/corrections can
            // resolve against the existing row in BF-3.
            await tx.bankFeedTransaction.upsert({
              where: { providerAccountId_providerTransactionId: { providerAccountId: item.providerAccountId, providerTransactionId: item.providerTransactionId } },
              create: { connectionId, providerAccountId: item.providerAccountId, providerTransactionId: item.providerTransactionId, pendingTransactionId: item.pendingTransactionId, transactionId: existing.id },
              update: { transactionId: existing.id },
            });
            continue;
          }

          const hit = applyRules(rules, {
            description: item.description,
            amount: item.amount,
            accountId: feedAccount.financialAccountId!,
          });
          let categoryId: string | null = null;
          let appliedRuleId: string | null = null;
          if (hit) {
            appliedRuleId = hit.rule.id;
            if (hit.categoryCode) {
              const coa = await tx.chartOfAccount.findFirst({
                where: { companyId: connection.companyId, code: hit.categoryCode, active: true },
                select: { id: true },
              });
              categoryId = coa?.id ?? null;
            }
          }

          const row = await tx.transaction.create({
            data: {
              companyId: connection.companyId,
              financialAccountId: feedAccount.financialAccountId!,
              date: new Date(item.date),
              description: item.description,
              rawStatementText: item.description,
              amount: item.amount,
              currency: item.currency,
              dedupeHash,
              categoryId,
              appliedRuleId,
              status: 'toreview', // rules applied, still requires human review
              source: 'feed',
            },
          });
          await tx.bankFeedTransaction.create({
            data: {
              connectionId,
              providerAccountId: item.providerAccountId,
              providerTransactionId: item.providerTransactionId,
              pendingTransactionId: item.pendingTransactionId,
              transactionId: row.id,
            },
          });
          added += 1;
        }

        // Cursor commits with the page's rows — a crash here re-reads the page.
        cursor = page.nextCursor;
        await tx.bankConnection.update({ where: { id: connectionId }, data: { transactionsCursor: cursor, lastSyncAt: new Date() } });

        if (!page.hasMore) break;
        if (pages >= MAX_PAGES_PER_RUN) break;
      }
    } catch (error: any) {
      await tx.bankSyncRun.update({
        where: { id: syncRun.id },
        data: { status: 'failed', error: error?.message?.slice(0, 500) ?? 'Sync failed', finishedAt: new Date(), addedCount: added, dedupedCount: deduped },
      });
      throw error;
    }

    await tx.bankSyncRun.update({
      where: { id: syncRun.id },
      data: { status: 'success', finishedAt: new Date(), addedCount: added, dedupedCount: deduped },
    });

    return { syncRunId: syncRun.id, skipped: false, added, deduped, updated, removedMarked, blockedUpdates, pages };
  });
}

/** Cron safety net: sync every active connection (webhooks are the primary trigger). */
export async function runDueSyncs(limit = 20): Promise<{ synced: number; skipped: number; errors: number }> {
  const connections = await db.bankConnection.findMany({
    where: { status: { in: ['active', 'pending_expiration'] } },
    orderBy: { lastSyncAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
    select: { id: true },
  });
  let synced = 0;
  let skipped = 0;
  let errors = 0;
  for (const c of connections) {
    try {
      const outcome = await syncConnection(c.id, 'cron');
      if (outcome.skipped) skipped += 1;
      else synced += 1;
    } catch {
      errors += 1;
    }
  }
  return { synced, skipped, errors };
}
