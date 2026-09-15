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
import { classifyOverlap } from '@/lib/bank-feed/overlap';
import { bankFeedPilotAllowed } from '@/lib/bank-feed/pilot';

const PAGE_SIZE = 500;
const MAX_PAGES_PER_RUN = 8; // bounded per invocation; the next trigger continues
const SYNC_CUTOFF_SECONDS = 20; // serverless budget guard
const DAY_MS = 86_400_000;

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
  settled: number;
  held: number;
  updated: number;
  removedMarked: number;
  blockedUpdates: number;
  pages: number;
}

const ZERO_OUTCOME: SyncOutcome = {
  syncRunId: '', skipped: false, added: 0, deduped: 0, settled: 0, held: 0,
  updated: 0, removedMarked: 0, blockedUpdates: 0, pages: 0,
};

/** Provider adapters supply LedgerPro's inflow-positive convention.
 *  Round to cents here; do not apply a second sign conversion. */
export function normalizeFeedAmount(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

async function notifyCompany(companyId: string, title: string, body: string, actor?: string): Promise<void> {
  try {
    const members = await db.membership.findMany({
      where: { companyId, role: { in: ['owner', 'admin'] } },
      select: { userId: true },
    });
    for (const m of members) {
      await db.notification.create({
        data: { userId: m.userId, companyId, type: 'system', title, body },
      });
    }
  } catch (e) {
    console.error('[bf-sync] notification failed:', e);
  }
}

/**
 * Runs one sync for a connection. Safe to call from the webhook, the cron,
 * or the manual "Sync now" button — the lock makes overlapping calls no-ops.
 */
export async function syncConnection(connectionId: string, trigger: 'webhook' | 'manual' | 'cron'): Promise<SyncOutcome> {
  const started = Date.now();
  const lockTag = `bfsync:${connectionId}`;
  let syncRunId: string | null = null;
  let failureCompany: { companyId: string; institutionName: string; notifyOnFailure: boolean } | null = null;

  try {
    // The provider HTTP call runs inside this transaction, so the default
    // 5s Prisma timeout would kill slower syncs mid-flight (P2028). Give
    // the whole sync a generous budget; the advisory lock still serializes
    // overlapping runs.
    return await db.$transaction(async (tx) => {
    // pg_advisory_xact_lock returns void — cast so the Prisma driver can
    // deserialize it. The lock releases when this transaction ends.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockTag}, 0))::text`;

    const connection = await tx.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    if (!bankFeedPilotAllowed(connection.companyId)) return { ...ZERO_OUTCOME, skipped: true };
    if (connection.status === 'revoked' || connection.status === 'error') {
      throw new Error(`Connection is ${connection.status}.`);
    }

    failureCompany = connection;
    const running = await tx.bankSyncRun.findFirst({
      where: { connectionId, status: 'running', startedAt: { gt: new Date(Date.now() - 15 * 60_000) } },
    });
    if (running) {
      return { ...ZERO_OUTCOME, syncRunId: running.id, skipped: true };
    }

    const syncRun = await tx.bankSyncRun.create({
      data: { connectionId, trigger, status: 'running' },
    });
    syncRunId = syncRun.id;

    const accounts = await tx.bankFeedAccount.findMany({
      where: { connectionId, isFeeding: true },
      include: { financialAccount: { select: { lockedThrough: true } } },
    });
    const byProviderId = new Map(accounts.map((a) => [a.providerAccountId, a]));
    const rules = await loadRules(connection.companyId);
    const accessToken = decryptToken(connection.accessTokenEncrypted);

    const counts = { ...ZERO_OUTCOME };
    let pages = 0;
    let cursor = connection.transactionsCursor;

    try {
      for (;;) {
        if (Date.now() - started > SYNC_CUTOFF_SECONDS * 1000) throw new Error('Sync exceeded pilot time budget; cursor unchanged.');

        const page = await syncTransactionsPage({ accessToken, cursor });
        pages += 1;

        for (const item of page.removed) {
          if (!item.transactionId) continue;
          const marked = await tx.bankFeedTransaction.updateMany({
            where: { providerTransactionId: item.transactionId, removedByProviderAt: null },
            data: { removedByProviderAt: new Date() },
          });
          counts.removedMarked += marked.count;
          // Review-stage rows are kept (deletion is a human decision in
          // BF-4's UI); owners get a notification so nothing is lost.
          if (marked.count > 0) {
            await notifyCompany(
              connection.companyId,
              'Bank feed: provider removed a transaction',
              `${connection.institutionName} removed a transaction that is still waiting in Review & match. It has been kept for your decision.`
            );
          }
        }

        for (const item of page.modified) {
          const feedAccount = byProviderId.get(item.providerAccountId);
          const link = await tx.bankFeedTransaction.findUnique({
            where: { providerAccountId_providerTransactionId: { providerAccountId: item.providerAccountId, providerTransactionId: item.providerTransactionId } },
            include: { transaction: { select: { id: true, status: true, reconciledInId: true, voidedAt: true, date: true } } },
          });
          if (!link?.transaction) continue;
          const row = link.transaction;
          const accountLockedThrough = feedAccount?.financialAccount?.lockedThrough ?? null;
          // Only review-queue rows update in place; posted, reconciled, or
          // locked-account facts are never silently rewritten.
          if (
            row.reconciledInId ||
            row.voidedAt ||
            !['toreview', 'categorized'].includes(row.status) ||
            (accountLockedThrough && row.date <= accountLockedThrough)
          ) {
            counts.blockedUpdates += 1;
            await notifyCompany(
              connection.companyId,
              'Bank feed: correction blocked',
              `${connection.institutionName} changed a transaction that has already been posted or reconciled. Review it manually in the banking screen.`
            );
            continue;
          }
          await tx.transaction.update({
            where: { id: row.id },
            data: { date: new Date(item.date), description: item.description, amount: normalizeFeedAmount(item.amount) },
          });
          counts.updated += 1;
        }

        for (const item of page.added) {
          const feedAccount = byProviderId.get(item.providerAccountId);
          if (!feedAccount || !feedAccount.financialAccountId) continue; // unmapped accounts never feed

          const amount = normalizeFeedAmount(item.amount);
          const providerIdKey = {
            providerAccountId: item.providerAccountId,
            providerTransactionId: item.providerTransactionId,
          };

          // ── 1. Pending → settled: update the pending row in place, keeping
          // the user's categorization — never create a duplicate.
          if (item.pendingTransactionId) {
            const pendingLink = await tx.bankFeedTransaction.findUnique({
              where: {
                providerAccountId_providerTransactionId: {
                  providerAccountId: item.providerAccountId,
                  providerTransactionId: item.pendingTransactionId,
                },
              },
              include: { transaction: { select: { id: true, status: true, reconciledInId: true, voidedAt: true, categoryId: true, appliedRuleId: true } } },
            });
            if (pendingLink?.transaction) {
              const row = pendingLink.transaction;
              if (row.reconciledInId || row.voidedAt || !['toreview', 'categorized'].includes(row.status)) {
                counts.blockedUpdates += 1;
                await notifyCompany(
                  connection.companyId,
                  'Bank feed: settlement blocked',
                  `${connection.institutionName} settled a transaction that has already been posted or reconciled. Review it manually.`
                );
              } else {
                try {
                  // Keep the user's categorization; update amounts/date only.
                  await tx.transaction.update({
                    where: { id: row.id },
                    data: { date: new Date(item.date), description: item.description, amount },
                  });
                  await tx.bankFeedTransaction.update({
                    where: {
                      providerAccountId_providerTransactionId: {
                        providerAccountId: item.providerAccountId,
                        providerTransactionId: item.pendingTransactionId,
                      },
                    },
                    data: { providerTransactionId: item.providerTransactionId, settledAt: new Date() },
                  });
                  counts.settled += 1;
                } catch (e: any) {
                  if (e?.code === 'P2002') counts.deduped += 1; // settled id already seen
                  else throw e;
                }
                continue;
              }
            }
          }

          const dedupeHash = makeDedupeKey({
            date: item.date,
            amount,
            description: item.description,
            fitid: item.providerTransactionId,
          });

          // ── 2. Exact dedupe against the shared hash (feeds AND imports).
          const existing = await tx.transaction.findFirst({
            where: { companyId: connection.companyId, financialAccountId: feedAccount.financialAccountId, dedupeHash },
            select: { id: true },
          });
          if (existing) {
            counts.deduped += 1;
            await tx.bankFeedTransaction.upsert({
              where: { providerAccountId_providerTransactionId: providerIdKey },
              create: { connectionId, ...providerIdKey, pendingTransactionId: item.pendingTransactionId, transactionId: existing.id },
              update: { transactionId: existing.id },
            });
            continue;
          }

          // ── 3. Statement-overlap comparison (same account, amount and a
          // small date window). High-confidence matches dedupe; ambiguous
          // matches are created but flagged for human review.
          const overlapCandidates = await tx.transaction.findMany({
            where: {
              companyId: connection.companyId,
              financialAccountId: feedAccount.financialAccountId,
              date: { gte: new Date(new Date(item.date).getTime() - 2 * DAY_MS), lte: new Date(new Date(item.date).getTime() + 2 * DAY_MS) },
            },
            select: { id: true, date: true, amount: true, description: true },
          });
          const overlap = classifyOverlap(
            { date: new Date(item.date), amount, description: item.description },
            overlapCandidates.map((c) => ({ ...c, amount: Number(c.amount) }))
          );
          if (overlap.verdict === 'duplicate' && overlap.matchId) {
            counts.deduped += 1;
            await tx.bankFeedTransaction.upsert({
              where: { providerAccountId_providerTransactionId: providerIdKey },
              create: { connectionId, ...providerIdKey, pendingTransactionId: item.pendingTransactionId, transactionId: overlap.matchId, overlapCandidate: true },
              update: { transactionId: overlap.matchId },
            });
            continue;
          }

          // ── 4. Create the row through the same rule path as imports
          // (skipped entirely when the connection's autoCategorize is off).
          const hit = connection.autoCategorize
            ? applyRules(rules, {
                description: item.description,
                amount,
                accountId: feedAccount.financialAccountId!,
              })
            : null;
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
              amount,
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
              ...providerIdKey,
              pendingTransactionId: item.pendingTransactionId,
              transactionId: row.id,
              overlapCandidate: overlap.verdict === 'ambiguous',
            },
          });
          counts.added += 1;
          if (overlap.verdict === 'ambiguous') counts.held += 1;
        }

        // Cursor commits with the page's rows — a crash here re-reads the page.
        cursor = page.nextCursor;
        await tx.bankConnection.update({ where: { id: connectionId }, data: { transactionsCursor: cursor, lastSyncAt: new Date() } });

        if (!page.hasMore) break;
        if (pages >= MAX_PAGES_PER_RUN) throw new Error('Sync exceeded pilot page budget; cursor unchanged.');
      }
    } catch (error) {
      // Let the complete batch roll back, including its cursor, before recording failure.
      throw error;
    }

    await tx.bankSyncRun.update({
      where: { id: syncRun.id },
      data: { status: 'success', finishedAt: new Date(), addedCount: counts.added, dedupedCount: counts.deduped },
    });

    return { ...counts, syncRunId: syncRun.id, pages };
    }, { maxWait: 15000, timeout: 60000 });
  } catch (error) {
    // The transaction has now rolled back: its running row no longer exists.
    // Create the failure evidence outside it; do not update an uncommitted row.
    if (syncRunId && failureCompany) {
      const company = failureCompany as { companyId: string; institutionName: string; notifyOnFailure: boolean };
      try {
        await db.bankSyncRun.create({ data: {
          connectionId, trigger, status: 'failed', startedAt: new Date(started),
          finishedAt: new Date(), error: 'Sync failed; no batch rows or cursor changes committed.',
          addedCount: 0, dedupedCount: 0,
        } });
      } catch { console.error('[bf-sync] could not persist failure record'); }
      if (company.notifyOnFailure) await notifyCompany(company.companyId, 'Bank feed: sync failed',
        'The bank feed could not synchronize. No batch changes were committed. Retry or contact support.');
    }
    throw error;
  }
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
