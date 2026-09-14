# BF-4 screens and connection billing

BF-4 turns the feed engine into a customer-facing surface: the five handoff screen states at `/banking/feeds`, per-connection sync settings, manual sync, the sync log, reconnect flows, and the disconnect workflow with the explicit untouched-row option. Billing ownership is enforced at the entitlement level: bank feeds are a Pro/Enterprise add-on. The stage closes the gate "complete customer workflow passes in staging" — the backend workflow was rehearsed live end to end; the screens themselves are exercised through the same routes with the production build verified by CI.

## What shipped

- **`/banking/feeds`** — one screen, five states per the handoff:
  1. **Not connected** — hero, three steps (authorize once / arrive daily / you still approve), the four compliance facts ("billed per connection · read-only access · credentials go to your bank, never to LedgerPro · statement import still works"), Connect + statement-import fallback.
  2. **Plaid Link** — the hosted consent modal is shipped, never rebuilt (§3.3). The SDK script is injected on demand and destroyed after success/exit.
  3. **Select accounts** — one row per provider account with the client-side mirrors of the server rules (currency-matched GL choices, credit cards to liability accounts only), "Not linked — will not feed" for unchecked rows, and "Start the feed" which saves the mapping and runs the first sync.
  4. **Connected** — per-connection card: status pill (Feed live / Reconnect needed / Consent renews soon / Feed stopped / Sync failed), mono meta line, Sync now, "N to review", account rows, Arrived/Last-sync/Status tiles, sync-log errors, settings and disconnect.
  5. **Reconnect** — Link re-opened in update mode via a connection-scoped link token (login-required, consent-expiry and revoked states).
- **Sync settings** — cadence (daily only in this release; hourly/twice-daily are later work per the plan's initial scope), auto-categorize (rules engine on/off), failure notifications. `history_start` is not exposed because the sync cursor manages history; the handoff's read-only-after-first-sync rule is documented for the settings UI's later iteration.
- **Manual sync** — `POST /api/plaid/connections/[id]/sync`, lock-safe, with outcomes surfaced in the toast and the sync log.
- **Disconnect** — provider-first removal, then the explicit option (`?removeUnreviewed=1`) deletes only untouched feed rows (still `toreview`, never categorized, matched, reconciled or voided); posted ledger entries are always kept and review work is retained by default.
- **Billing** — the connection records `billableOwnerId` at exchange (the owner who authorized pays), the exchange route enforces the `Plan.bankFeeds` entitlement (403 otherwise, mirroring the API plan gate), and every lifecycle event is audit-logged. Actual charge flows remain a billing-system concern per the plan's billing boundary.
- **Additive migration** `20260913170000_bf4_sync_settings` — `cadence` (daily), `autoCategorize` (on), `notifyOnFailure` (on).

## Automated acceptance evidence

- Unit suite (12 new tests, 356 total): settings route validation and audit; default disconnect keeps rows; `removeUnreviewed=1` deletes only untouched toreview feed rows; exchange plan gate (403 without `bankFeeds` entitlement, provider never called); sync honoring `autoCategorize` off; failure notifications. Full verify pipeline passes, including the production build of the feeds page and the new routes.
- **2026-09-14 — live staging rehearsal passed** against the real Plaid sandbox and the staging database: 24 sandbox transactions synced with rules on; settings persisted (auto-categorize off); disconnect with the explicit option removed exactly the 24 untouched rows; staging plan rows mirror production entitlement (`bankFeeds` on Pro/Enterprise); provider item removed before local deletion. Migration applied to staging with zero drift.
- CI run 80 passed all gates (PR #26).

## Rollback and release boundary

- The migration is additive. Disconnect remains the operational kill switch; the UI's default keeps review work.
- Production has zero connections — the screens are inert until an entitled owner connects.

## Completion decision

- **2026-09-14 — CI run 80 green** and the live staging rehearsal passed (evidence above).
- Remaining for the full handoff fidelity: hourly/twice-daily cadences and the `history_start` selector are deferred per the initial scope, and the billing charge flow belongs to the billing system (documented boundary).
