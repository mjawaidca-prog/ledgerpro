# LedgerPro direct bank feeds program

This document defines the staged direct bank feed program: a Plaid integration that pulls transactions into LedgerPro's existing review queue each morning, applies the tenant's bank rules, and waits for human approval — feeds and statement imports are equal peers, and nothing posts to the ledger unattended.

The program is delivered in six stages, BF-0 through BF-5, each on its own staging branch with a stage document in `docs/` and a hard completion gate before merge. The first milestone is BF-0 + BF-1: verified provider assumptions plus the secure connection foundation, built against Plaid sandbox.

## Stages

| Stage | Branch | Document | Completion requirement |
|---|---|---|---|
| BF-0 | (plan on main) | `BF_PROGRAM.md` | Plaid CA transactions coverage, production access requested, sandbox credentials, pricing and billing ownership decided |
| BF-1 | `codex/bf1-connection` | `BF1_CONNECTION.md` | A sandbox bank connects safely and maps to the correct company accounts |
| BF-2 | `codex/bf2-sync` | `BF2_SYNC.md` | New transactions arrive reliably without creating journal entries |
| BF-3 | `codex/bf3-controls` | `BF3_CONTROLS.md` | Accounting acceptance tests pass without duplicate posting or lost legitimate transactions |
| BF-4 | `codex/bf4-screens` | `BF4_SCREENS.md` | Complete customer workflow passes in staging |
| BF-5 | `codex/bf5-pilot` | `BF5_PILOT.md` | Real-bank reconciliation and operational checks pass before wider access |

## Non-negotiable product rules

1. Nothing posts to the ledger from a sync. Feed rows arrive auto-categorized but still **To Review**; the import service's optional automatic-posting is explicitly disabled for feeds.
2. The cost of a connection stays with the account owner who authorized it.
3. Access tokens never reach the browser, a response body, a log line, or an error report.
4. A feed row and an imported row for the same transaction must never both survive.
5. FX gain/loss defers entirely to the existing FX settlement logic — the feed never posts FX gain/loss.
6. Statement imports remain available throughout; a broken feed always falls back to import.

## What the codebase already provides

- `Transaction` with `dedupeHash` — feed rows enter the same review queue; duplicate detection is shared with imports (the handoff's "new dedupe_hash column" already exists).
- `BankRule` engine — feeds reuse the import path's rule evaluation; the two sources must never categorize differently.
- `FinancialAccount` (already carries legacy `plaidItemId`/`plaidAccessToken` fields) — provider accounts map to existing GL-linked accounts with company, currency, and asset/liability validation.
- `closedPeriodGuard`, `accountLockedGuard`, reconciliation locks, FX settlement in `journal.ts`, the `AuditLog`, and the tenant-scoping patterns.
- Vercel cron (Hobby: one run per day) — webhook `SYNC_UPDATES_AVAILABLE` is the primary trigger; a daily scheduled check is the safety net. Hourly refresh is deferred.

## Compliance copy (corrected wording, per BF-0 review)

- "Credentials go to the bank — **LedgerPro does not receive bank login credentials**" (never "Plaid does not store credentials").
- Consent expiry is provider-reported and displayed; never invent an expiry date.
- No unverified institution counts ("3,400+ Canadian institutions" is removed).
- Balances-only ("Beta") institutions are excluded from transaction-feed activation.
- Do not promise "data held in Canada" for the feed service without written Plaid confirmation.
- Sync cadence copy distinguishes checking for updates from requesting a bank refresh (providers typically check institutions one to four times daily; refresh is separate).
- Disconnect retains review work by default; a separate explicit option removes eligible, untouched feed rows.

## Billing boundary

Plaid bills the integration; LedgerPro separately charges the designated customer to pass on the cost. A connection can contain multiple accounts, charges may continue while a connection is broken, and stopping sync alone does not end them. Disconnect must successfully call `/item/remove` before discarding the token.

## Initial scope

Canadian CAD/USD bank and credit-card accounts; webhook updates plus a daily scheduled check; manual approval for posting; owner-approved connection add-on. Hourly refresh and balances-only connections are later work.

Status: BF-0 pending provider setup (Plaid team, CA `transactions` production access request, sandbox keys); BF-1 implementation started.
