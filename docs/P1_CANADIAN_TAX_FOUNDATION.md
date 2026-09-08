# P1 Canadian tax foundation

Status: implementation groundwork, **not deployed tax compliance**. Prepared September 7, 2026 against the merged P0 code. Bank feeds, public API, external integrations, payroll and automatic CRA filing are outside this phase. Accountant review is a release gate, not a substitute for testing.

## 1. Evidence from the current implementation

| Area | Existing code | Consequence for P1 |
| --- | --- | --- |
| Rate defaults | `src/lib/taxes.ts`: province table; Nova Scotia historical periods; `getTaxRate` / `calculateTax` | Preserve public exports. A rate table is not a taxability or place-of-supply rules engine. Unsupported history currently falls back to today's rate. |
| Quebec | `TaxInfo.pst` contains QST; `ProvinceTaxRate` has GST/HST/PST fields | New data must distinguish QST from retail PST/RST; do not rename existing fields in place. |
| Invoices / bills | `prisma/schema.prisma`: header `taxRate` / `taxAmount`; no line-level component snapshots | Cannot faithfully store mixed tax treatment or recoverability. Additive schema changes needed after P0.1. |
| Validation / posting | `src/lib/validators/invoice.ts`, `bill.ts`, document API routes accept aggregate tax; `src/lib/journal.ts` credits sales tax and debits purchase tax to account 2300 | Entire purchase tax is treated as reducing sales tax payable. PST/RST needs separate, reviewed handling. Recompute new-format amounts server-side. |
| Bank imports | `src/lib/banking/splits.ts`: split tax codes, single rates and inclusive math; `posting.ts` | Preserve import workflow; later route new component decisions through the same posting service as bills. |
| Import tax / FX | Bill `importTaxAmount`; frozen document FX; separate import GST/HST posting | Preserve CBSA-assessed CAD tax, avoiding conversion twice or duplication with ordinary purchase tax. |
| Reports | `src/lib/consolidation/statements.ts::composeGstSummary` filters liability accounts by tax-like name | This is a balance summary, not a return workpaper, ITC eligibility check, or separate legal-entity filing. |

These findings refine the accountant feedback: existing Canadian rates and a tax summary do not yet establish end-to-end Canadian tax compliance. Existing FX, attachments, period locks and audit infrastructure should be integrated, not rebuilt.

## 2. Accounting decisions and scope

### Separate treatment from rate, and federal from provincial decisions

Every line has an explicit classification **per component**, not a single document-wide percentage. A GST exemption does not automatically determine provincial treatment. Proposed fields and behavior:

| Treatment | Calculation | Required review / reporting distinction |
| --- | --- | --- |
| `taxable` | Reviewed positive rate | Taxable supply; registration, jurisdiction and recovery requirements still apply. |
| `zero_rated` | Zero | Taxable at zero; distinguish from exempt because purchases used in making zero-rated supplies can qualify for ITCs. |
| `exempt` | Zero | Generally no ITCs for purchases used to make exempt supplies. |
| `out_of_scope` | Zero | Product classification requiring a reason, e.g. a non-supply movement of funds; never infer from a zero amount or foreign address alone. |

CRA distinguishes taxable/zero-rated and exempt supplies and their ITC consequences in [RC4022](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4022/general-information-gst-hst-registrants.html). `out_of_scope` is our workflow classification, not a blanket CRA ruling on a transaction. Allocation for mixed-use purchases requires evidence and review.

Components: `GST`, `HST`, `PST`, `RST`, `QST`; also store jurisdiction and administering authority. HST is a single combined tax component, not HST plus GST. Quebec GST is 5% and QST 9.975%, with QST calculated on the price excluding GST ([Revenu Québec basic rules](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/basic-rules-for-applying-the-gsthst-and-qst/)). Manitoba's general RST is 7% of price before GST ([Manitoba Finance](https://www.gov.mb.ca/finance/taxation/taxes/retail.html)); Saskatchewan's general PST is 6% ([Saskatchewan Finance](https://www.saskatchewan.ca/business/taxes-licensing-and-reporting/provincial-taxes-policies-and-bulletins/provincial-sales-tax)). These are general-rate fixtures, not proof all goods/services bear provincial tax.

### Recoverability and posting

Store an explicit eligible recovery fraction (0–100%), reason, supporting document references and reviewer. Do not infer recovery merely because a bill is taxable. GST/HST ITCs depend on registration, commercial activity, documentation and restrictions; special methods can change eligibility ([CRA ITCs](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/input-tax-credit.html)). QST input tax refunds are a separate recovery mechanism ([Revenu Québec ITCs/ITRs](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/itcs-and-itrs/)). B.C. PST does not have an input tax credit system ([B.C. small-business guide](https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst/publications/small-business-guide)). Treat PST/RST as nonrecoverable in the initial calculator; any provincial refund/credit workflow is a separately reviewed adjustment, not an ITC.

Proposed posting mappings are configurable per company and must reconcile to its existing COA. Do not hardcode new account numbers or change historical 2300 entries automatically.

| Event | Debits | Credits |
| --- | --- | --- |
| Taxable sale | AR / bank: gross | Revenue: net; each output-tax payable: component amount |
| Purchase | Expense/asset: net plus nonrecoverable tax; eligible GST/HST ITC and QST ITR controls separately | AP / bank: gross |
| Credit / reversal | Exact reversal of original frozen components and FX | Do not recalculate with current rates |
| Remittance | Appropriate tax liability/control | Bank; link to filing workpaper |

For a reviewed B.C. business purchase of $100 plus $5 GST and $7 PST with full GST recovery, expected accounting is expense/asset $107, GST recoverable $5 and AP $112. Partial commercial-use examples must keep the ineligible GST share in expense/asset. Self-assessment needs paired liability/recovery or expense entries under a dedicated review flow; it is not implemented by the foundation calculator.

## 3. Jurisdiction, timing and exception controls

Company province is a default only. Capture supply category, customer delivery/recipient address, relevant service/property location, selected jurisdiction, rule reference and override explanation. General services, tangible goods, real property and special rules need different resolvers; an address-only universal rule is unsafe. [CRA place-of-supply guidance](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-place-supply.html) determines which GST/HST rate applies.

P0's Nova Scotia invoice-date selection is a useful default, **not full transitional compliance**. For applicable supplies, the 2025 transition considers when consideration becomes due or is paid, and a prepayment may leave part at 15% and the rest at 14%. Record tax-point evidence and allow split consideration lines; use explicit review for unsupported categories, real property and transitional cases ([CRA Notice 342](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/notice342/nova-scotia-hst-rate-decrease-questions-answers-general-transitional-rules-personal-property-services.html)).

Planned rate catalog rules:

- Immutable version, jurisdiction, component, treatment, rate precision, effective-from/to, source URL and review timestamp.
- Strict ISO calendar-date validation; no silent fallback for unsupported historical dates.
- Explicit supported-date coverage, including any temporary relief rules within that coverage. Imported history outside coverage is held for review.
- Snapshot selected version and actual component amounts when posting; rate updates affect new decisions only.
- Capture company registration status/number/effective dates separately for federal and provincial regimes. Missing registration/eligibility decisions block automated treatment rather than silently zero-rating a sale.
- Initial release supports reviewed ordinary goods/services under the regular method. Quick method, special charity methods, real property, mixed-use special calculations, self-assessment and relief programs remain flagged manual-review cases until dedicated tests and accountant approval exist.

## 4. Isolated code delivered in this branch

`src/lib/tax/engine.ts` introduces `calculateTaxLine` with no imports from application, database, network, rates or posting code. Nothing calls it in production. `src/lib/taxes.ts` and all existing consumers remain unchanged.

Inputs are already-discounted/rounded **integer minor units**, price mode, direction and explicit component decisions. Rates are thousandths of a percentage point: `5000` means 5%, `9975` means 9.975%; recovery uses basis points (`10000` means 100%). Internal BigInt ratios avoid floating-point tax arithmetic; public results remain safe integer numbers. Supported runtime must implement BigInt. No assumption is made about tax law from a province or contact name.

Results include net, gross, each tax component, output tax, recoverable and nonrecoverable tax. The calculator validates safe integer bounds, classifications, rates, duplicate components, HST combinations and recovery restrictions. It preserves zero-rated/exempt/out-of-scope distinctions.

Proposed rounding policy: round each component half away from zero; negative credits are symmetric. For inclusive amounts calculate each component from the gross using `gross × rate / (100% + sum of rates)` and assign remaining minor units to net, preserving gross exactly. It deliberately does not recalculate inclusive taxes from rounded net. Accountant sign-off on this policy and supplier-invoice rounding adjustments is required before use. Quantity/discount rounding, currency conversion and document allocation remain outside this pure function.

Known limits: this is not a full jurisdiction validator (callers must establish which province and taxes apply), tax-code catalog, filing engine, automated recovery estimator, or complete tax-compliance service. Multiple provincial regimes on one line are rejected. No schema, production data or live posting changes are included.

## 5. Proposed additive data contract (after P0.1)

Design migrations only after the P0.1 baseline, staging restore rehearsal and drift checks pass. Proposed structures, not changes delivered here:

1. `CompanyTaxRegistration`: tenant, regime, identifier, validity, method, filing frequency, authorized reviewer.
2. `TaxCodeVersion`: stable code + immutable version, classification/component decisions, jurisdictions, effective window, source and review status.
3. `DocumentLineTaxSnapshot`: tenant, source document/line, version, effective/tax-point date, jurisdiction evidence, mode, component treatment/rate/tax, recovery fraction/amount, reason, document and CAD reporting amounts, FX source/rate/date, engine version.
4. `TaxPostingLink`: snapshot-to-journal-line mapping, idempotency/source key and reversal link. Document, tax snapshot and journal must commit atomically.
5. `TaxReturnWorkpaper`: legal registrant, period, authority, method, status, source-line inclusion set, adjustment support, reviewer and signed-off snapshot/version.

Use existing decimal money columns at persistence boundaries. Convert minor units using exact decimal serialization, not binary floating conversion; retain existing FX snapshots. Tax reporting in CAD for non-CAD documents needs a separately reviewed conversion policy and reconciliation to the home-currency ledger. CBSA CAD import assessments remain distinct.

## 6. Server/UI integration and backward compatibility

- Add a per-company opt-in feature flag, initially off; serve current invoice/bill flow unchanged until enablement criteria pass.
- Add line treatment/code, province evidence, inclusive/exclusive mode and itemized tax display. Default choices are editable before posting and require reason where overridden.
- Compute new-format totals on the server; reject forged client totals, disabled tax codes, foreign-tenant IDs, expired code versions and unauthorized overrides. Recompute preview when quantity, discount, price, date or jurisdiction changes.
- Reuse closing controls, audit infrastructure, tenant isolation and document statuses. A posted edit is a controlled reversal/repost or adjustment, not mutation of a filed snapshot.
- Keep old header fields populated as aggregates for existing readers/PDFs/exports; a mixed-rate header must be represented as mixed rather than an invented single rate. New readers prefer snapshots, old readers retain established totals.
- Mark legacy records `legacy_unclassified` in the new reporting layer. Never infer zero-rated versus exempt from `taxRate=0`, or split historical totals using the company’s current province.
- Preserve existing line totals, GL and FX exactly. Backfill only evidence-supported metadata in batches with preview, reason, operator and reconciliation. Any historical accounting correction is a separately approved adjustment.
- Gate imports from old clients/CSV: preserve legacy behavior only when new tax mode is disabled; require reviewed tax decisions before new-mode posting. No silent fallback to legacy posting for an enabled company.
- Staging acceptance compares AR/AP, trial balance, tax controls and report totals before/after migration. Rollback is feature-flag disable plus forward fix; do not drop new populated columns to roll back.

## 7. Filing workpapers, permissions and audit

Build separate registrant-and-authority workpapers, not a group-consolidated tax return. GST/HST output tax and eligible ITCs require transaction evidence; amounts billed but unpaid can matter. Revenu Québec similarly separates billed tax and eligible purchase recoveries ([Revenu Québec reporting](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/reporting-gsthst-and-qst/)).

For the regular GST/HST method, propose reconciled supporting schedules for line 101 revenue and categorized exclusions; 103 output tax; 104 additions; 105 sum; 106 eligible ITCs; 107 deductions; 108 sum; 109 net (105 minus 108); and separately supported instalments, rebates and self-assessments. Validate applicability, rounding and current line mapping against [CRA return instructions](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/instructions-preparing-return.html). Do not derive all these lines from net account 2300 movements.

Each summary drills down to document, line, component, evidence and GL entry, including opening controls, payments, credits, adjustments and legacy exceptions. QST needs its own output/recovery/net schedules. PST/RST reports are jurisdiction-specific collections, self-assessment and allowed adjustment schedules, not GST ITC reports; start the B.C. mapping with the [B.C. return guide](https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst/report-pay/pst-return-guide). Manitoba and Saskatchewan mappings need provincial form-by-form review before release.

Proposed workflow: draft → prepared → reviewed → filed-recorded. Owner/admin configures registration, codes and mappings; bookkeeper prepares entries/workpapers; authorized reviewer approves exceptions and final workpaper; viewer reads only. Use explicit permission checks in addition to role names. Record actor/time, old/new values, reason, rule/code version, document evidence and filing-snapshot inclusion. Locks prevent silent changes after filing; late documents create an exception/adjustment for review. Downloadable CSV/PDF workpapers must be labelled **not filed** until a user records external filing confirmation. CRA/Revenu Québec credentials and direct submission remain out of scope.

## 8. Sequenced implementation tasks and acceptance gates

| Stage | Work | Exit gate |
| --- | --- | --- |
| P1-A (this branch) | Evidence audit, bounded arithmetic engine, unit fixtures, design | All existing unit tests unchanged; new engine tests pass; no live behavior/schema changes |
| P1-B | Accountant approves supported scope, recovery/rounding rules, rates/effective coverage and account mapping; implement registration/code/snapshot migrations | P0.1 baseline and independent staging passed; non-destructive migration/rehearsal reviewed |
| P1-C | Server calculation service, atomic component postings, reversals and tenant permissions | Balanced sale/purchase/credit/FX postings, idempotency, locks and authorization tests |
| P1-D | Invoice/bill line UI + PDFs, posting preview, import/bank adapters | Mixed-tax documents match server; no trust in browser totals; legacy unchanged |
| P1-E | GST/HST regular-method workpapers then QST/PST/RST schedules | Transaction-to-return-to-GL reconciliation and accountant sign-off per jurisdiction |
| P1-F | Limited pilot with synthetic staging fixtures then explicitly approved company enablement | No unresolved exceptions or drift; rollback/backup evidence; production release approval |

Release acceptance matrix:

- Every province/territory and supported rate period, exact date boundaries and invalid dates; no unsupported-history fallback. Nova Scotia prepayment/paid-payable boundary and partial consideration fixtures.
- GST/HST taxable, zero-rated, exempt and out-of-scope remain distinct in UI, storage, exports and reports. GST-taxable/PST-exempt and the converse require explicit per-regime decisions.
- Quebec $100 ordinary taxable sale yields GST $5.00, QST $9.98; no compounding. Reviewed B.C. purchase yields $5 recoverable and $7 nonrecoverable, never $12 ITC.
- Exclusive/inclusive, low-value half-cent rounding, fractional quantity, discounts, refunds/credit notes, partial recovery and mixed-use documentation; document and GL totals balance to the cent.
- Immutable posting/FX snapshots; credit notes reverse original rates; CBSA import tax not converted twice or duplicated.
- Regular-method workpaper periods, unpaid invoices/bills, adjustments, remittances, opening balances, credit-note timing and late-posted entries reconcile; wrong method blocks automatic return calculation.
- Cross-tenant access, Viewer mutation, unsupported tax-code combinations, disabled codes, manipulated totals and posting to locked periods are rejected server-side.
- Historical document/PDF and ledger regression fixtures unchanged; legacy ambiguity is visible and excluded from automatic readiness, never silently guessed.
- Idempotent request retries, transaction rollback on posting failure, source evidence integrity and no duplicate report inclusion.
- Staging-only fixtures until pilot approval. No assertion of “CRA filing integration” or “complete Canadian compliance” from this groundwork.

## 9. Open decisions before implementation

Accountant must approve initial supply categories, special-method exclusions, province-specific exemptions, recovery evidence/fractions, tax-point and FX reporting policy, rounding and report mappings. Product owner must select the pilot legal entity and filing regime. P0.1 must establish the production baseline and staging/backup evidence. These decisions block live enablement, not parallel groundwork.

P1-C implementation details and its disabled-by-default release boundary are recorded in `docs/P1C_TAX_POSTING.md`.

P1-D invoice/bill entry, server preview, printable component detail, immutable correction behavior, and bank-import safety boundary are recorded in `docs/P1D_TAX_DOCUMENT_WORKFLOW.md`.
