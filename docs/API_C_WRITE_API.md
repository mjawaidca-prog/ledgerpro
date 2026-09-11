# API-C controlled write access

API-C adds controlled writes to the public API in the two releases the program plan defined: drafts first, then explicit accounting actions. It closes the gate "tax, FX, closed-period and duplicate-prevention tests pass" — the full lifecycle was exercised live on the synthetic staging company.

## Release 1 — drafts (`write_draft`)

- `POST /api/v1/contacts`, `PATCH /api/v1/contacts/[id]` — create/update customers and vendors with field-level errors; currency must be enabled for the company; tenant-scoped.
- `POST /api/v1/invoices` — creates a **draft** invoice: server-computed totals (the caller's numbers are never trusted), customer must exist and be a customer of the company, `dueDate ≥ issueDate`, and foreign-currency documents must freeze an `fxRate` (never recomputed later).
- `POST /api/v1/bills` — the same for draft bills (supplier check, `bill`/`expense` kind, frozen FX).

Drafts carry no tax decisions — reviewed tax is applied at posting, exactly like the dashboard's reviewed workflow.

## Release 2 — accounting actions (`write_posting`)

- `POST /api/v1/invoices/[id]/post`, `POST /api/v1/bills/[id]/post` — post a draft through the reviewed-tax engine. The tax decision travels in the body; the engine recomputes every amount from the immutable snapshots; document totals and status update in the same transaction.
- `POST /api/v1/payments` — record a payment already made externally through the FX-aware posting services (frozen document rate, settlement treatment, subledger + bank balance synchronized). Never initiates a transfer.
- `POST /api/v1/payments/[id]/reverse` — equal-and-opposite reversal with synchronized balances.
- `POST /api/v1/journal-entries` — create and post a balanced journal; balance, active accounts and closed periods enforced server-side.
- `POST /api/v1/journal-entries/[id]/void` — void through a reversal journal; nothing is deleted.
- `POST /api/v1/invoices/[id]/void`, `POST /api/v1/bills/[id]/void` — drafts are deleted; posted documents are voided through a tax-posting reversal, and only when no unreversed payments remain.

## Idempotency and duplicate prevention

- Every POST requires an `Idempotency-Key` header. `ApiIdempotencyRecord` commits **in the same transaction as the mutation**; a retry replays the stored response, and the unique index breaks the concurrent race.
- Posting also inherits the engine's own replay receipt (`companyId+sourceKey`), so duplicate protection holds at two independent layers.
- Migration `20260911180000_api_c_idempotency` is additive only.

## Controls preserved (identical to the dashboard)

- **Actor model:** the engine's `authorize()` skips the dashboard membership lookup **only** for an explicit `actor: { kind: 'api_key' }` — the key's `write_posting` permission is enforced at the route boundary. Every other control (tax configuration readiness, approved tax versions, recovery reviewers, period checks, balance checks) is untouched. Dashboard callers behave exactly as before.
- **Closed periods** block posting, payments and journals at both the route level and inside the engine (`assertPeriodOpen`).
- **FX** is frozen at draft creation; payments settle at the document's frozen rate (home-currency documents derive 1.00, never 0).
- **Audit:** every write records the integration identity (`apiKeyId`, `apiKeyName`) in the `AuditLog` metadata.

## Defects found and fixed during the stage

- The void guard matched payment **reversal** entries too (they copy the original's `sourceType`/`sourceId`), so a document could never be voided after its payment was reversed. Fixed by requiring `reversalOfId: null` on the live-payment check — verified live (payment → reversal → void now completes). The dashboard's own void check uses the same pattern and may warrant the same fix; out of scope for this stage, flagged for follow-up.

## Automated acceptance evidence

- Unit suite: idempotency replay/race semantics, field-level validation, tenant-scoped drafts, frozen-FX enforcement, tax-decision requirements, closed-period blocks, snapshot-computed totals, actor wiring (`userId: null` + `actor` on the engine command), audit identity, migration additivity. **264 unit tests** pass in the full verify pipeline (secret scan, migration safety, schema validation, typecheck, build).
- Live staging rehearsal (preview `ledgerpro-7illevzxr`, branch-scoped env on `ledgerpro-staging`): contact create + same-key replay (same id) + new-key create (new id); read-only key → 403 `insufficient_permissions`; draft invoice with server totals; invoice replay; posting with 13% HST → subtotal 100.00 / tax 13.00 / total 113.00 from snapshots; unbalanced journal → 400 `journal_unbalanced`; balanced journal + void; payment recorded; void with outstanding payment → 409 `tax_settlement_reversal_required`; payment reversed; void then succeeds.

## Rollback and release boundary

- The migration is additive; operational rollback is the existing kill switches (company toggle, `LEDGERPRO_API_DISABLED`).
- Production has zero keys with write permissions and `apiAccessEnabled = false` everywhere — no external write is possible until an owner opts in.

## Completion decision

- **2026-09-11 — staging rehearsal passed** (evidence above) on the synthetic staging company.
- CI run [number] to be recorded after PR #13 gates pass.
