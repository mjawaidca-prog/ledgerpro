# BF-2 transaction synchronization

BF-2 pulls provider transactions into the same review queue statement imports feed: cursor-based Plaid sync, JWT-verified webhooks as the primary trigger, a daily cron as the safety net, per-connection locking, and durable sync-run history. It closes the gate "new transactions arrive reliably without creating journal entries" — verified live against the real Plaid sandbox.

## What shipped

- **Schema (additive migration `20260913130000_bf2_feed_transactions`)** — `BankFeedTransaction` links provider transactions to their LedgerPro review rows (unique per provider account + provider id; survives settlement and corrections), and `BankConnection.transactionsCursor` stores the Plaid sync cursor.
- **Sync engine** (`src/lib/bank-feed/sync.ts`):
  - Plaid `transactions/sync` paging, up to 500 rows and 8 pages per invocation with a 20-second time budget — the next webhook or cron run continues where it left off.
  - **The cursor commits inside the same transaction as each page's rows** — a crash re-reads the page, never skips it.
  - Feed rows mirror the import path exactly: `status: toreview`, `source: feed`, the shared `dedupeHash` (provider transaction id acts as the OFX FITID), and bank rules applied through the import path's own `applyRules` engine — auto-categorized but still requiring human review.
  - **No journal entries are ever created by a sync** — posting remains a human action.
  - One sync per connection at a time: a PostgreSQL advisory lock plus a running-run guard make overlapping invocations no-ops.
  - Modified rows update only review-queue rows; reconciled, voided or posted rows are blocked and counted (`blockedUpdates`), never silently rewritten.
  - Removed provider rows mark `removedByProviderAt` on the link — the LedgerPro row is never deleted.
- **Webhook** (`POST /api/plaid/webhook`) — every payload must carry a valid `Plaid-Verification` JWT (ES384, verified against the item's webhook verification key fetched per item); unverified payloads are rejected with 400 before any processing. `SYNC_UPDATES_AVAILABLE` triggers the connection's sync; other codes are acknowledged. The route is exempt from dashboard session auth in middleware — the JWT is the only credential.
- **Cron** (`GET /api/plaid/sync-cron`, CRON_SECRET-guarded, daily) — the safety net for missed webhooks.

## Defects found and fixed during the live rehearsal

1. `pg_advisory_xact_lock` returns `void`, which the Prisma driver cannot deserialize — fixed with a `::text` cast.
2. Prisma's default 5-second interactive-transaction timeout killed syncs mid-flight (`P2028`) because the provider HTTP call runs inside the transaction — raised to a 60-second budget with a 15-second maxWait.
3. Failure marking originally ran inside the (now poisoned) transaction, masking the real error — moved outside the transaction.

## Automated acceptance evidence

- Unit suite (20 new tests): row creation with the shared dedupe key and no journal entries; rule application identical to imports; cursor advancement atomic with rows; overlap skipping without provider calls; dedupe-hit linking without duplicates; modified rows (review-only updates, reconciled blocked); removals marking links only; failure marking. Webhook tests include real ES384 JWT generation/verification with tamper rejection, plus the route's 400/trigger/ack behaviors. Full verify pipeline passes (334 tests at stage close).
- **2026-09-13 — live staging rehearsal passed** against the real Plaid sandbox (RBC, ins_39) and the staging database: 24 sandbox transactions synced across passes; every row `toreview` with `source: feed`; 24 distinct dedupe hashes; provider links equal rows; **zero journal entries**; cursor set; sync runs recorded `success`; and once the sandbox's lazily-generated history settled, a further sync added **zero** rows — duplicate prevention holds.
- Migration applied to staging with zero drift.

## Rollback and release boundary

- The migration is additive; no existing tables were touched.
- Sync never mutates posted facts: the worst case is an extra review-queue row, which is visible and deletable in the review UI.
- Production has zero connections and zero feed rows — the sync engine is inert until BF-4's screens let an owner connect.

## Completion decision

- **2026-09-13 — CI run 72 passed all gates** for the stage; the two rehearsal fixes shipped on `fe407dd` with CI green on the main push.
- **2026-09-13 — live staging rehearsal passed** (evidence above).
