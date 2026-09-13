# BF-1 secure connection foundation

BF-1 builds the connection layer for direct bank feeds: provider connections with envelope-encrypted access tokens, provider-account records that map onto LedgerPro's existing GL-linked `FinancialAccount` model, durable sync-run history, and the Plaid Link + exchange + disconnect flows. It closes the gate "a sandbox bank connects safely and maps to the correct company accounts" — verified live against the real Plaid sandbox.

## What shipped

- **Schema (additive migration `20260913100000_bf1_bank_connections`)**:
  - `BankConnection` — one provider item per company: `itemId` (unique), institution metadata, provider-reported `consentExpiresAt` (never invented), `billableOwnerId` (the owner who authorized and pays), status enum (`active | login_required | pending_expiration | revoked | error`), and the envelope-encrypted access token.
  - `BankFeedAccount` — one row per provider account: subtype, currency, balances, `is_feeding`, and an optional `financialAccountId` mapping to the GL. Unmapped accounts are stored so they can be enabled later without reconnecting.
  - `BankSyncRun` — durable per-connection sync history (trigger, status, row counts, error).
- **Envelope encryption** (`src/lib/bank-feed/crypto.ts`) — each token is encrypted with a fresh AES-256-GCM data key; the data key is wrapped by a deployment KEK (`BANK_FEED_KEK`). Ciphertexts carry the wrapped key, IV and tag (`v1.…`), so a KEK rotation only re-wraps keys. Tokens never reach responses, logs, or audit.
- **Plaid client** (`src/lib/bank-feed/plaid-client.ts`) — Link token creation scoped to Canadian `transactions`, public-token exchange, item metadata with provider-reported consent expiry, account listing, and item removal.
- **Routes** (session-authed, dashboard):
  - `POST /api/plaid/link-token` — mints a Link session (owner/admin/bookkeeper).
  - `POST /api/plaid/exchange` — owner-only; exchanges the public token, stores the encrypted access token, records accounts with the handoff's defaults (depository + credit feed; personal and other subtypes stay stored but off), audits the connection, and removes the provider item if setup fails partway.
  - `GET /api/plaid/connections` — connections with accounts and recent syncs; tokens are never selected.
  - `PATCH /api/plaid/connections/[id]/accounts` — the handoff's mapping rules enforced server-side: feeding accounts require a GL account, currency must match, credit-card subtypes map to liability accounts, depository to assets, and a GL account already fed by another connection cannot be reused.
  - `DELETE /api/plaid/connections/[id]` — owner-only; removes the provider item **first** (a failed provider removal keeps the local consent record so the user can retry — an orphaned provider item would keep billing), then deletes the connection. Review work is retained; the explicit row-removal option arrives with the screens in BF-4.

## Compliance copy (as corrected in the plan)

- "Credentials go to the bank — LedgerPro does not receive bank login credentials."
- Consent expiry is provider-reported (`item.consent_expiration_time`) and displayed as-is.
- No institution counts or "held in Canada" claims are made.

## Automated acceptance evidence

- Unit suite (18 new tests, 317 total in the full run): encryption round-trip, fresh-data-key uniqueness, tamper and wrong-KEK rejection; exchange token hygiene (ciphertext in the DB, never in the response), feeding defaults for depository/credit vs personal accounts, owner-only authorization and audit; mapping rules (currency mismatch, credit-to-liability, double-feeding blocked, valid update); disconnect ordering (provider removal strictly before local deletion, 502 when the provider refuses). Full verify pipeline passes (secret scan, migration safety, schema validation, typecheck, tests, build).
- **2026-09-13 — live staging rehearsal passed** against the real Plaid sandbox and the staging database (synthetic company `p1f-staging-ontario`): Link token created (CA transactions scope); sandbox public token exchanged for a real access token (RBC Royal Bank, 14 provider accounts); the token stored as envelope-encrypted ciphertext with a verified decrypt round-trip and **no plaintext anywhere in the database**; feeding defaults applied exactly per the handoff (checking/savings/credit feed; mortgage, loans and investment subtypes stay off); provider item removed at Plaid before the local record was deleted. The route handlers are session-authed, so the rehearsal drove the same client functions the routes call; the route wiring itself is unit-tested and the production build of the routes passed CI.
- Migration applied to staging with zero drift.

## Rollback and release boundary

- The migration is additive; no existing tables were touched.
- Production has zero bank connections; the feed code is inert until an owner completes the Link flow.
- Disconnect is the operational kill switch: provider-first, audited, and reversible by reconnecting.

## Completion decision

- **2026-09-13 — CI run 69 passed all gates** and the live Plaid sandbox rehearsal passed (evidence above).
- BF-0 remains the external prerequisite for production: Plaid CA `transactions` production access must be approved before BF-5's real-bank pilot.
