# API-B read-only API

API-B delivers the read surface of the public API on the API-A security foundation: every entity and report an accountant or reporting integration needs, with decimal-string money, explicit currencies, bounded pagination, change-sync filters and report metadata. It closes the gate "API results reconcile with dashboard reports" — verified by an automated reconciliation suite, not by assertion.

## What shipped

- **Base URL** `https://ledger.nexvarlab.com/api/v1` (key auth via `Authorization: Bearer lp_live_…`, read permission on every route).

### Entities

| Endpoint | Coverage |
|---|---|
| `GET /api/v1/company` | Company profile (safe fields) |
| `GET /api/v1/accounts` | Chart of accounts; filters: type, active; sync: updatedAfter |
| `GET /api/v1/contacts` | Customers and vendors; filters: type, status |
| `GET /api/v1/invoices`, `GET /api/v1/invoices/[id]` | Invoices with line items; filters: status, customerId, issueFrom/To |
| `GET /api/v1/bills`, `GET /api/v1/bills/[id]` | Bills with line items; filters: kind, status, vendorId, billFrom/To |
| `GET /api/v1/payments` | Recorded payments (posted payment journal entries with GL lines); filters: from/To, createdAfter |
| `GET /api/v1/transactions` | Bank/card transactions; filters: financialAccountId, status, from/To |
| `GET /api/v1/journal-entries`, `GET /api/v1/journal-entries/[id]` | General journal with GL lines; filters: sourceType, from/To, createdAfter |
| `GET /api/v1/tax-codes` | Active codes with **approved** versions and component rates (3dp) |

### Reports (`rateScope: report` — the stricter limit class)

`/reports/trial-balance`, `/reports/balance-sheet`, `/reports/profit-loss`, `/reports/ar-aging`, `/reports/ap-aging` — each returns `meta` with `reportingPeriod`, `periodStart`/`periodEnd`, `accountingBasis: "accrual"` and `generatedAt`.

## Conventions

- **Money**: decimal strings ("1000.00", rates "0.130", FX "1.34567890") with explicit currency per record. No floats cross the wire.
- **Pagination**: bounded cursor pagination — `limit` (default 50, max 100), opaque `cursor`, response envelope `{ data, pagination: { nextCursor, hasMore } }`.
- **Sync**: `updatedAfter` (ISO datetime) on every list that tracks `updatedAt`; append-only posted facts (payments, journal entries) use `createdAfter` instead. Voided and reversed records are included with their status/voidedAt so synchronizing clients can mirror them.
- **Errors**: the v1 envelope `{ error: { code, message } }` with stable codes (`invalid_api_key`, `rate_limited`, `not_found`, `invalid_parameter`, …).

## Reconciliation — the gate

The report builders share the dashboard's GL primitives (`getGLActivity`, `normalBalance`, `toDebitCredit`, `fiscalYearStartFor`). The test suite drives the **dashboard report handlers and the v1 report handlers on identical seeded data** and asserts row-level equality:

- Trial balance: every v1 row's debit/credit equals the dashboard row's value (numbers compared; v1 emits decimal strings by design).
- AR/AP aging: every bucket total and count equals the dashboard's.
- P&L and balance sheet builders are additionally pinned to hand-computed fixtures, so a shared bug cannot make both sides agree on a wrong number.
- Trial balance fixture: 1010 debit 500.00 / 4000 credit 1000.00 / totals 1000.00 each side; P&L net 500.00; balance sheet 500 = 0 + 500 balanced.

## Automated acceptance evidence

- Local `npm run verify`: secret scan, migration safety, schema validation, typecheck, **238 unit tests**, production build — all pass.
- Unit suite additions: serialization invariants (decimal strings, ISO dates, report meta), pagination bounds and cursor stability, tenant scoping (every query carries the key's `companyId`), foreign-id → 404 without leakage, read-permission wiring on every route.
- Live staging rehearsal (preview deployment `ledgerpro-iqkefv12i`, branch-scoped env on `ledgerpro-staging`): all 14 endpoints return 200 with correct shapes; no-key → 401; `limit=1` returns one row with `nextCursor`/`hasMore`; **the report rate limit fired live** (429 with `retryAfterSeconds` after crossing 10/min, recovered after the window).

## Rollback and release boundary

- No schema changes — API-B is code-only; rollback is a redeploy of the previous commit.
- No write endpoints exist; read-only keys cannot change any record.
- Rate limits bound extraction: 120 req/min + 5000/day per key, and 10 req/min + 500/day for report endpoints.

## Completion decision

- **2026-09-11 — staging rehearsal passed** against the API-B preview deployment on the synthetic staging company (P1-F Synthetic Ontario Pilot): all list endpoints, all five reports, pagination, 401 path and live rate limiting verified.
- CI run [number] to be recorded after PR #12 gates pass.
- Production ships with zero keys and `apiAccessEnabled = false` everywhere — the read API is inert until an owner opts in.
