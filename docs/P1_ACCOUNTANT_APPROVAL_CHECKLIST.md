# P1 Canadian tax accountant approval checklist

Purpose: obtain written accounting approval before LedgerPro changes live tax
calculation, posting, or filing workpapers. Completing this checklist does not
represent legal or tax advice and does not enable the feature by itself.

Reviewer name: Muhammad Jawaid

Professional designation / firm: Accountant, A Jays Accounting and Tax Corp

Review date: 2026-09-07

Pilot company and province: Synthetic Ontario pilot company (staging)

## 1. Initial release scope

Please approve or amend each proposed boundary.

- [x] Support ordinary Canadian goods and services under the regular GST/HST
      method first.
- [x] Keep Quick Method, charity/special methods, real property special cases,
      self-assessment, temporary relief programs, direct CRA/Revenu Quebec
      filing, and automated PST/RST filing outside the first release.
- [x] Require manual review when LedgerPro cannot determine the correct tax
      treatment from the supported rules.

Required amendments or additional exclusions:

________________________________________________________________________

## 2. Tax classifications and components

- [x] Keep `taxable`, `zero-rated`, `exempt`, and `out-of-scope` as separate
      classifications in storage and reports.
- [x] Store GST, HST, PST, Manitoba RST, and QST as distinct components.
- [x] Treat HST as one combined tax, never HST plus GST.
- [x] Calculate Quebec GST and QST on the price before either tax; do not
      compound QST on GST.
- [x] Permit different federal and provincial treatment on the same line when
      supported by the reviewed tax code.

Required amendments:

________________________________________________________________________

## 3. Purchase-tax recovery

- [x] Do not assume tax on a bill is recoverable merely because it was charged.
- [x] Record an explicit GST/HST ITC and QST ITR recovery percentage, reason,
      evidence, and reviewer.
- [x] Treat PST and RST as nonrecoverable cost in the initial engine; process an
      approved refund or special credit as a separate adjustment.
- [x] Post nonrecoverable tax to the related expense or asset, not the GST/HST
      recoverable control account.

Approved evidence requirements and restricted ITC/ITR categories:

________________________________________________________________________

## 4. Calculation and rounding

Proposed policy: use exact decimal/integer arithmetic, calculate and round each
tax component to the nearest cent with half cents rounded away from zero, and
apply the exact opposite amounts on a credit note.

- [x] Approve the proposed component-level rounding policy.
- [x] For tax-inclusive prices, calculate each component from gross using
      `gross x rate / (100% + total applicable rate)` and assign the remaining
      cents to net so gross always reconciles exactly.
- [x] Freeze the selected tax code version, rates, amounts, jurisdiction, and
      recovery decisions when a document posts.
- [x] Credit notes reverse the original frozen tax components rather than using
      current rates.

Required alternative rounding or supplier-invoice adjustment policy:

________________________________________________________________________

## 5. Jurisdiction and tax-point evidence

- [x] Company province is only a default, not the final place-of-supply rule.
- [x] Store delivery/recipient address and other relevant supply-location
      evidence, selected jurisdiction, rule reference, and override reason.
- [x] Unsupported supply categories and historical dates must stop for review;
      LedgerPro must not silently use today's rate.
- [x] Nova Scotia transitional cases must consider when consideration became
      due or was paid and allow reviewed split treatment for partial prepayments.

Supply categories approved for automated treatment in the first pilot:

________________________________________________________________________

## 6. General-ledger mappings

Enter the pilot company's approved accounts. Do not approve generic account
numbers without checking its chart of accounts.

| Purpose | Approved account |
| --- | --- |
| GST/HST output tax payable | Synthetic pilot 2300 — HST Output Payable |
| GST/HST ITC recoverable | Synthetic pilot 1300 — HST Recoverable |
| QST output tax payable | Not applicable to Ontario pilot |
| QST ITR recoverable | Not applicable to Ontario pilot |
| PST/RST payable | Not applicable to Ontario pilot |
| Tax rounding adjustments | Synthetic pilot 5999 — Tax Rounding |
| Tax remittances / clearing, if separate | Synthetic pilot 2305 — Tax Clearing |

- [x] After P1-C posting is implemented, sales, purchases, credits, payments, foreign-currency documents, and
      import-tax examples balance to the cent using these mappings.
- [x] Existing historical entries will not be rewritten automatically.

## 7. Filing workpapers — approved design, not yet implemented

- [x] GST/HST workpapers will be prepared per legal registrant and reconcile source
      documents, component snapshots, GL entries, adjustments, and remittances.
- [x] QST will have separate output-tax and ITR schedules.
- [x] PST/RST schedules will remain province-specific and will not be presented as GST
      ITC reports.
- [x] Workpapers will be labelled `not filed` until a user records external filing
      confirmation.
- [x] Consolidated reports will not be represented as consolidated tax returns.

- [x] P1-E automated PostgreSQL evidence confirms source-to-return-to-GL reconciliation,
      review and external-filing recording controls, frozen exports, and amendment versions.
      Company-specific staging acceptance remains part of P1-F.

Required filing frequency, method, period rules, and adjustment handling:

________________________________________________________________________

## 8. Pilot and release approval

- [x] The pilot legal entity, registrations, filing method, and effective dates
      have been verified.
- [x] P0.1 schema was rehearsed in an isolated staging project and safely
      adopted in production. The product owner confirmed all existing records
      are test data and explicitly waived the production backup/restore gate.
- [x] Synthetic staging cases cover every approved province, treatment, rate
      boundary, credit, recovery scenario, and account mapping.
- [x] Legacy invoices, bills, PDFs, GL balances, FX, and reports remain unchanged
      while the P1 feature flag is off.
- [x] P1-F CI run 24 passed the additive migration, 183 unit tests, the real PostgreSQL
      tax lifecycle, payment reversals, filing workpapers, and optimized build.
- [x] Staging contains one enabled synthetic Ontario pilot; production contains zero enabled
      tax configurations, verified September 9, 2026.
- [x] Production enablement requires a separate written approval after staging
      reconciliation; approval of this design alone does not enable production.

Decision:

- [x] Approved as written for P1 implementation
- [ ] Approved with the amendments recorded above
- [ ] Not approved; further review required

Reviewer signature: Muhammad Jawaid (approval recorded electronically)

Product owner approval: Muhammad Jawaid (approval recorded electronically)
