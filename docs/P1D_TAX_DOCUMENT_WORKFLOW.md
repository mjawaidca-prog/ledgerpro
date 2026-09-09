# P1-D reviewed tax document workflow

P1-D connects the disabled-by-default P1 tax foundation to invoice, bill, printable-invoice, and bank-import surfaces. It does not enable any company. P1-F still requires an explicitly approved pilot.

## Invoice and bill entry

When `CompanyTaxConfiguration.enabled` is false, the existing single-rate screens and posting routes are unchanged. When it is true:

- `/api/tax/context` returns only the active company's approved, effective tax-code versions, readiness issues, and same-company owner/admin reviewers.
- Each document line requires an approved tax code. The screen shows component names and rates, including separate GST and QST/PST where applicable.
- The user explicitly selects a tax code and records place-of-supply evidence. Recovery starts at zero, with no preselected approval. Recoverable purchase components require a percentage, reason, supporting reference, and the signed-in owner/admin's own approval. A bookkeeper cannot approve on another person's behalf; a delegated approval queue is not part of this release.
- `/api/tax/preview` reloads the tax codes, categories, account mappings, memberships, and reviewer permissions from the database. It calculates integer-minor-unit totals with the same P1 engine used for posting.
- The create routes ignore browser totals in reviewed mode, repeat the server preview, replace the document header subtotal/tax/total with that result, and invoke `postTaxDocument`. Legacy posting is not called.
- Foreign-currency tax uses the document's server-resolved frozen rate. The home total comes from the sum of rounded P1 line/component conversions.
- Document creation, tax snapshots, journals, account balance updates, final status, and a replay receipt commit in one transaction. Concurrent identical save retries return the same document; changed contents using the same key return 409. If configuration changes between preview and posting, the save fails without leaving a partial document.

Reviewed-tax drafts are deliberately blocked in this release because mutable draft decisions do not yet have their own evidence table. This prevents a draft from losing its jurisdiction or recovery decisions. The user must complete and post the reviewed document in one session; ordinary legacy drafts remain unchanged.

## Posted documents and PDFs

Invoice and bill detail APIs load immutable snapshots and component rows. Posted reviewed-tax documents display the selected code and component amounts, use the frozen header totals, and are locked against direct editing. Corrections use the P1-C reversal path. The public printable invoice/PDF shows net line amounts and a separate component-level GST/HST/QST/PST breakdown, including correct inclusive-price presentation.

Unpaid reviewed documents can be voided atomically, in the current open period even when the original period is closed. Paid or matched documents require settlement reversal first. Reviewed documents cannot be switched back to draft or marked paid through a header edit. Enabling a company also blocks legacy-document editing/reposting until its tax treatment is reviewed; existing facts remain readable.

## Bank and statement imports

Statement parsing and import remain unchanged. Imported rows stay in review. Before posting a bank row, the P1-D bank adapter checks the company feature flag:

- disabled company: legacy categorization and tax behavior remains unchanged;
- enabled company with no legacy tax: ordinary untaxed posting remains available; and
- enabled company with legacy `taxCode`, `taxRate`, or `taxAmount`: posting is blocked with instructions to create the related reviewed invoice, bill, or expense and match the payment.

This guard prevents a reviewed-tax company from silently collapsing GST/HST/QST/PST, recovery, jurisdiction, and evidence into the historical account-2300 shortcut. Direct reviewed component posting from a statement row remains outside the initial ordinary-goods/services scope.

## Server and security controls

- Active-company isolation is enforced by `requireCompany` and every tax/category/reviewer database query.
- Browser tax totals and labels are not trusted.
- Only owner, admin, and bookkeeper roles may preview or post; recovery approval is owner/admin only.
- Expired, draft, retired, foreign-company, or legacy-unclassified codes are rejected.
- Posted tax facts remain immutable and reversals copy the original tax and FX facts.
- Feature-off behavior has no new schema dependency and no route change in accounting output.

## Verification

P1-D adds adapter/validator, request-replay, recovery-evidence, and route tests and retains all P1-A through P1-C fixtures. CI additionally runs seven real Postgres lifecycle tests for mixed GST/QST, concurrent retries, recovery evidence, atomic rollback, reviewer impersonation, immutable documents, and current-period reversal. Only authentication context is substituted in those CI route tests; the posting engine, Prisma transaction, and database constraints are real. The fixtures refuse to run outside a disposable local `ledgerpro_ci` database.

The release gate is typecheck, secret scan, migration safety, Prisma validation, all unit tests, optimized Next.js build, CI database tests, preview deployment, and browser smoke testing. No production tax company is enabled by this phase.
