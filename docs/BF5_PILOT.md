# BF-5 controlled production pilot — runbook

**Status: NO-GO pending readiness fixes and provider confirmation (reviewed 2026-09-15).** Initial connection can be performed in a session, but acceptance requires five business days of evidence. BF-0 requires confirmed Canadian Transactions production access.

## 2026-09-15 independent implementation review

Latest reviewed main: `23a485c`. Vercel reports a READY production deployment.
Production has the four bank-feed tables and zero feed transaction rows; real-bank
pilot evidence is not established. Never treat staging sandbox rehearsal as
production acceptance.

Corrections prepared on `codex/bf5-pilot-review`:
- ES256 webhook verification with five-minute issued-at validation and a
  constant-time comparison of the SHA-256 of the exact raw request body.
- Convert Plaid's outflow-positive amounts to LedgerPro's inflow-positive
  convention once at the provider adapter. Existing stored rows are not rewritten.
- Send redirect and webhook URLs in Link token requests.
- Return HTTP 503 for failed webhook syncs to permit provider retry.
- Restrict production Link/exchange/sync to explicit company IDs; add an
  emergency stop that leaves provider disconnect available.
- Let the bank-feed cron reach its own bearer-secret guard without a session.
- Avoid printing Plaid error objects from connection and webhook routes.
- Persist failed sync runs after the transaction rolls back.
- Roll back the full update when pagination exceeds its time/page budget,
  retaining the original cursor for retry rather than committing partial pages.
- Use the exchange response's connection ID for account mapping; report first
  sync failures instead of showing success unconditionally.
- Resume OAuth redirects using a short-lived, user/company-bound Link session;
  reconnect success requires a successful authenticated sync.
- Serialize disconnect and mapping with sync; prevent mapping two bank accounts
  to one ledger account and reject post-sync mapping changes requiring backfill.
- Preserve the initial cursor when webhooks arrive before mapping is saved.
- Prevent corrections and settlements from moving rows into locked periods;
  blocked settlements cannot create duplicate review rows.
- Exclude feed rows and already-linked imports from fuzzy overlap matching.
- Send correction notifications only after the batch commits.

Validation on this review branch: TypeScript passed; production build completed;
the full unit suite passed (391 tests, 9 skipped at that run). Added regressions
cover early unmapped webhooks, page-budget failure, locked-period settlements and
corrections, provider-scoped removal and overlap restrictions. These are mocked
unit checks, not evidence of real database rollback or bank consent completion.

Additional release checks still required:
- Rehearse the selected institution's Link and OAuth return/resume flow in a
  browser. Implementation is prepared; bank-hosted verification is still required.
- Verify failure-run persistence with an actual PostgreSQL rollback.
- Rehearse pagination retries; oversized updates currently fail closed after
  eight pages or the time budget. Add a durable full-update staging mechanism
  before admitting accounts whose initial history exceeds those limits.
- Verify disconnect/sync concurrency against PostgreSQL (unit mocks cannot
  prove advisory lock ordering). Provider error logs in disconnect are sanitized.
- Confirm production credentials, KEK, provider approval and pilot company.
- Agree pilot charges explicitly. `billableOwnerId` is attribution, not an
  implemented charge/collection workflow.

Required production settings: `PLAID_ENV=production`, configured credentials,
`BANK_FEED_KEK`, `PLAID_REDIRECT_URI`, `PLAID_WEBHOOK_URL`,
`BANK_FEED_PILOT_COMPANY_IDS=<approved exact company ID>` and
`BANK_FEEDS_DISABLED=false`. Empty allowlist blocks all production syncs and
new connections. `BANK_FEEDS_DISABLED=true` pauses sync; only successful provider
item removal ends the connection. Do not broaden access until the matrix passes.

The gate: a real bank connects, feed results reconcile against statements, billing and disconnect behave, and the decision to widen access is evidence-based.

## 0. Preconditions

- [ ] Plaid: `transactions` production access approved for the team.
- [ ] Plaid dashboard: redirect URI registered exactly as the production `PLAID_REDIRECT_URI` (`https://ledger.nexvarlab.com/banking/feeds`).
- [ ] Plaid dashboard: webhook URL registered as `https://ledger.nexvarlab.com/api/plaid/webhook`.
- [ ] Production database: the four BF migrations applied (guarded sequence in §1).
- [ ] Vercel production env: `PLAID_CLIENT_ID`, `PLAID_SECRET_PRODUCTION`, `PLAID_REDIRECT_URI`, and a generated `BANK_FEED_KEK` set (values provided by the owner; never committed).
- [ ] Pilot company selected: on Pro or Enterprise (the `bankFeeds` entitlement is enforced), with an owner available to authorize.

## 1. Production migration application (guarded)

Same discipline as every prior stage — drift first, stop on anything unexpected:

```powershell
# Drift check: production DB vs schema. Expect ONLY the four BF migrations'
# constructs (BankConnection, BankFeedAccount, BankSyncRun, BankFeedTransaction,
# bankFeedAccounts on FinancialAccount, the sync settings columns, the enum
# types). Anything else: STOP and investigate.
$env:DATABASE_URL="<prod pooled>"; $env:DIRECT_URL="<prod direct>"
cd C:\Users\mjawa\Documents\LedgerPro
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prod-drift.sql
# Review prod-drift.sql, then:
npm run db:migrate:deploy
npm run db:migrate:drift   # must exit 0
```

## 2. Pilot execution checklist

- [ ] Owner opens **Banking → Bank feeds** in production and confirms the not-connected screen (compliance copy present).
- [ ] Connect a bank through hosted Link with the pilot account (one institution, one chequing account).
- [ ] Select accounts: verify the GL suggestions (currency-matched, depository → asset).
- [ ] Start the feed; confirm the first sync lands rows in **Review & match** with status To Review and no journal entries.
- [ ] Sync settings: keep defaults (daily, auto-categorize on, failure notifications on).
- [ ] Confirm the connected card: Feed live pill, mono meta line, arrived/duplicate tiles.

## 3. Verification matrix (feed vs statement)

Run these checks over the first 3–5 business days; every row needs evidence:

| Check | How | Passes when |
|---|---|---|
| Transaction parity | Compare every feed row against the bank statement for the same period | No missing and no extra rows (transit timing differences documented) |
| Amounts and dates | Spot-check 10 rows against the statement | Amounts match to the cent; dates within one banking day (posted vs authorized) |
| No duplicates | Count rows per statement transaction | Exactly one row per transaction; "Duplicates filtered" tile matches expectations |
| Rules applied | Review the categorization of 10 recurring merchants | Rules match import-path behavior; nothing posted automatically |
| Settlement | Watch pending transactions settle | The settled version updates the same row, keeps the user's category, no duplicate |
| Statement overlap | Import the same period's statement file | The import dry-run flags the overlap; no double rows survive |
| Webhook sync | Make no manual syncs for 2 days | Rows arrive within the provider's update cadence without Sync now |
| Daily cron | Pause webhooks mentally; the 13:00 cron covers | A missed-webhook day still syncs |

## 4. Billing verification

- [ ] Confirm the connection records the authorizing owner as `billableOwnerId` (the pilot user).
- [ ] Confirm the audit log shows `bank_feed.connection.create` with actor and timestamp.
- [ ] Disconnect at pilot end and confirm the audit shows `bank_feed.connection.disconnect`; provider billing ends (verify on the Plaid dashboard's item list).

## 5. Operational monitoring

- [ ] Sync log on the connected card shows trigger (webhook/manual/cron), status, and counts.
- [ ] Induce one failure (temporarily) or wait for one: failure notification reaches the owner, the run is marked failed, and the next trigger retries.
- [ ] Any blocked corrections (posted/reconciled rows) produce owner notifications, never silent changes.

## 6. Incident plan

| Event | Response |
|---|---|
| Feed misbehaves | Disconnect (provider-first, review work retained) — the import path is the fallback throughout |
| Duplicate suspicion | Duplicates are review rows only; nothing posts — review and delete the extra row, then re-check the overlap flags |
| Provider outage | Webhook retries + daily cron; the connected card shows the last sync status; no action needed |
| Full stop | Disconnect all connections; the platform switch (`LEDGERPRO_API_DISABLED`) does not govern feeds — disconnect is the feed kill switch |

## 7. Go / no-go decision (evidence-based)

Widen access when ALL of §3's checks pass for 5 consecutive business days AND:

- [ ] Zero unexplained duplicate rows.
- [ ] Zero journal entries created by syncs (verify via audit query).
- [ ] At least one blocked-correction notification behaved correctly.
- [ ] Disconnect and reconnect worked once each on the pilot account.

## 8. Post-pilot rollout

- [ ] Update Help center (Developer API → bank feeds articles) with any copy corrections found in the pilot.
- [ ] Remove any pilot-only limitations notes from the feeds screen if the pilot validates them.
- [ ] Enable broader access: owners on Pro/Enterprise may connect without further approval (the entitlement already gates it).
- [ ] Schedule the deferred scope review: hourly/twice-daily cadences, `history_start` selector, and balances-only institutions.

## Completion decision

(Filled on execution day.)

- Pilot dates: [ ]
- Account: [institution, masked account, plan]
- CI/verify evidence at pilot time: [run number]
- Verification matrix outcome: [ ]
- Go decision: [ ]
