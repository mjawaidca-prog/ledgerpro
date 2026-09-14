# BF-3 duplicate and accounting controls

BF-3 makes the "no duplicate posting, no lost legitimate transactions" gate provable: statement-overlap detection in both directions, pending-to-posted settlement that preserves human work, locked-account protection for provider corrections, and owner notifications whenever the provider's view of the world conflicts with the ledger. It closes the gate "accounting acceptance tests pass without duplicate posting or lost legitimate transactions" — verified live against the real Plaid sandbox and the real import dedupe path.

## What shipped

- **Feed-side overlap detection** (`src/lib/bank-feed/overlap.ts`) — account-scoped, cents-exact amount comparison, ±2-day date window, and Sørensen–Dice bigram similarity on normalized descriptions:
  - ≥ 0.75 similarity → **duplicate**: no row is created; the provider link points at the existing row.
  - below threshold → **ambiguous**: the row IS created (two legitimate identical purchases must remain possible) and the link is flagged `overlapCandidate` so the BF-4 review UI can surface it for a human decision.
- **Pending-to-posted settlement** — a settled version updates the pending review row in place: amount/date/description refresh, the **user's categorization is untouched**, and the provider link is rewritten to the settled id with `settledAt` set. No duplicate row is ever created. A settled version of an already-posted or reconciled row is blocked with an owner notification.
- **Locked-reconciliation guard** — provider corrections (`modified`) for rows inside a locked reconciliation are blocked and notified, never silently rewritten.
- **Provider removals** — the link is marked `removedByProviderAt`; the review row is kept and owners are notified. Deletion stays a human decision (the explicit option arrives in BF-4's screens).
- **Amount discipline** — provider amounts pass through verbatim (no sign flipping; the `signMultiplier` behavior was deliberately removed in BUG-1 and feeds match imports), rounded to cents; NaN/Infinity collapse to zero.
- **Import-direction overlap** — verified, not rebuilt: the existing import dedupe already flags feed-originated rows with its `same_amount` (±3 days, normalized description) rule, so a statement covering a fed period cannot silently double-post either.
- **Additive migration** `20260913150000_bf3_overlap_flag` — `BankFeedTransaction.overlapCandidate`.

## Automated acceptance evidence

- Unit suite (16 new tests): overlap verdicts (duplicate / ambiguous / none, incl. outside-window identical purchases and cents-level amount differences), dice sanity, verbatim amount normalization incl. credit-card signs, settlement keeping categorization with no duplicate, settlement-blocked notifications, ambiguous-row flagging, high-confidence dedupe linking, locked-reconciliation correction blocks with notifications, provider-removal notifications. **349 unit tests** pass in the full verify pipeline.
- **2026-09-13 — live staging rehearsal passed** against the real Plaid sandbox and the staging database: 24 sandbox transactions synced; a statement import covering the same period ran through the real import dry-run and **flagged all 24 rows as `same_amount` overlaps** (exact-hash misses are expected — the feed hashes include the provider id as the FITID — and the import's own overlap rule is the second net); feed-side classification returned `duplicate` for a slightly-changed description and `ambiguous` for a same-amount different merchant. Migration applied to staging with zero drift.
- CI run 76 passed all gates for the stage (PR #25).

## Rollback and release boundary

- The migration is additive. The worst case of any sync behavior is a visible, deletable review-queue row or a flag — nothing is posted, deleted, or silently rewritten.
- Production has zero connections and zero feed rows; the controls are inert until BF-4's screens let an owner connect.

## Completion decision

- **2026-09-13 — CI run 76 green** and the live staging rehearsal passed (evidence above).
