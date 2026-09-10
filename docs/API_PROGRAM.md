# LedgerPro public API program

This document defines the staged public API program for LedgerPro: a versioned, documented integration layer at `https://ledger.nexvarlab.com/api/v1` for authorized applications and accountants. "Public" means documented access for approved integrations—not public access to customers' financial data. Direct bank feeds remain out of scope.

The program is delivered in five stages, API-A through API-E, each on its own staging branch with a stage document in `docs/` and a hard completion gate before merge. The first milestone is API-A + API-B: a documented, secure read-only beta that delivers accountant reporting access on a tested security foundation before any write path exists.

## Stages

| Stage | Branch | Document | Completion requirement |
|---|---|---|---|
| API-A | `codex/api-a-security` | `API_A_SECURITY.md` | Unauthorized and cross-company requests are blocked |
| API-B | `codex/api-b-readonly` | `API_B_READONLY_API.md` | API results reconcile with dashboard reports |
| API-C | `codex/api-c-writes` | `API_C_WRITE_API.md` | Tax, FX, closed-period and duplicate-prevention tests pass |
| API-D | `codex/api-d-webhooks` | `API_D_WEBHOOKS.md` | Retries and duplicate deliveries work safely |
| API-E | `codex/api-e-docs-launch` | `API_E_DOCS_LAUNCH.md` | An external developer completes an integration using the documentation |

## Security model (API-A)

- API keys are the authentication mechanism for the initial release, for trusted server-to-server integrations. OAuth consent-based connections are a later extension for third-party applications serving many companies.
- Owners create named keys (for example "AccountNext Reporting") with read-only or specific write permissions, an expiry date, and last-use and request-count visibility. Rotation and immediate revocation are supported.
- Each key belongs to one company. An accountant with several clients holds separately authorized keys per client.
- Secret keys are shown exactly once and stored only as SHA-256 hashes. The plaintext secret never appears in responses or logs again.
- Every request re-checks company authorization and allowed operations from the key itself. The dashboard's active-company cookie is never consulted by `/api/v1` routes.
- Integration identity is recorded against every change through the existing `AuditLog` model.
- Rate limits use PostgreSQL-backed sliding windows, not in-memory counters, so limits are shared across serverless instances.
- A company-level and a platform-level emergency disable switch revoke API access immediately without deleting audit history.
- Responses exclude passwords, internal secrets and unnecessary personal information.

## Read-only surface (API-B)

Initial access:

- Company profile and chart of accounts
- Customers and vendors
- Invoices, bills and line items
- Recorded payments and bank transactions
- Journal entries and GL lines
- Approved tax codes and effective rates
- Trial Balance, Balance Sheet and P&L
- AR and AP aging

Every list endpoint supports bounded pagination and filters; synchronization includes changed records, including voided or removed records where relevant. Financial values use decimal strings with explicit currencies; reports include their reporting period, accounting basis and generation time.

Tax workpapers, consolidated reports and attachments are subsequent extensions under additional permissions.

## Controlled writes (API-C)

Two releases:

1. Drafts: create or update customers and vendors; create draft invoices and bills; validate tax-code selection and currency; return clear field-level errors.
2. Accounting actions: post approved documents; record payments already made externally; create and post balanced journals under separate permissions; void or reverse supported transactions through controlled workflows.

Recording a payment never implies initiating a bank transfer or charging a customer.

Writes preserve every dashboard control: company tax activation and registrations, approved tax codes and recovery percentages, frozen FX rates and settlement treatment, closed periods and locked reconciliations, balanced journals, required approvals and audit history. Idempotency keys, atomic database operations and conflict detection for concurrent edits make repeated requests safe against duplicates.

## Webhooks (API-D)

Signed webhooks notify connected applications of `invoice.created`, `invoice.posted`, `payment.recorded`, `bill.updated` and `journal.posted`. Delivery includes signatures, timestamps, event IDs, retry handling and a visible, replayable delivery history. Destination URLs are validated before delivery to prevent the webhook service from accessing private or internal systems. These are LedgerPro integration notifications, separate from Stripe payment webhooks.

## Documentation and launch (API-E)

- OpenAPI specification and endpoint reference
- Authentication instructions
- Copyable examples
- Error codes and troubleshooting
- Rate limits and pagination rules
- Tax and FX restrictions
- Versioning and deprecation policy
- Sandbox instructions using synthetic data and separate credentials

Launch sequence: test company and one accountant pilot first, then broader access. Starting policy: sandbox access for approved developers, production API access on Pro and Enterprise, no per-call billing initially, published usage allowances with stricter limits for expensive reports and writes, and owner visibility into integration usage, failures and revoked keys.

## Pre-launch test gates

- Company A cannot access Company B's records.
- Revoked or expired keys stop working.
- Read-only keys cannot make changes.
- Repeated requests cannot duplicate accounting entries.
- API reports match dashboard reports.
- Tax, FX and period controls cannot be bypassed.
- Large requests and excessive traffic are bounded.
- Logs do not expose secrets or financial payloads unnecessarily.

## Release discipline

Each stage follows the same discipline as the P1 tax series and `DEPLOYMENT.md`:

- Implementation on the stage branch with CI gates: `npm run verify` (secret scan, migration safety, schema validation, typecheck, unit tests, build) plus stage-specific tests.
- Schema changes are additive migrations only; the safety check rejects destructive SQL; staging rehearsal happens before production; migrations deploy before code.
- Pilot activity uses a synthetic staging company only (as in P1F). Production API keys and configurations stay disabled until the stage gate passes.
- Each completed stage lands its document in `docs/` with a dated completion decision backed by CI run numbers, staging evidence and production state.

## Open issues

The pricing page advertises "API access" while no public API exists yet, and its prices differ from the database seed configuration. Marketing, billing and API entitlements must be reconciled before API-E launch advertising.

Status: planned. No application changes have been made under this program.
