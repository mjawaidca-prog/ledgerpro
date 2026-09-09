# P1-F controlled Canadian tax pilot

P1-F closes the limited-pilot gate for the reviewed Canadian tax workflow. It does not claim complete Canadian tax compliance, submit returns, initiate remittances, or enable any production company.

## Approved pilot

- Legal entity: synthetic Ontario staging company only.
- Currency: CAD.
- Registration: regular-method GST/HST, quarterly.
- Tax code: ordinary Ontario taxable supply at 13% HST, plus zero-rated, exempt, and out-of-scope classification fixtures.
- Accounts: separate HST output liability, HST recoverable asset, tax rounding expense, tax clearing liability, AR, AP, bank, revenue, and expense accounts.
- Evidence: synthetic delivery and purchase-support references; no real registration numbers or customer information.

## Defects closed during the pilot

1. Home-currency documents intentionally store a null FX rate. Payment posting previously converted that null to zero. The service now derives 1.00 only when document currency equals company currency and rejects a missing rate for foreign documents.
2. Foreign-currency paid-home tracking now records the AR/AP carrying amount relieved. Cash at the settlement-date rate remains in the journal, and the difference remains realized FX gain or loss.
3. Payment journal entries now retain the exact financial account. Invoice and bill payment reversals post equal-and-opposite entries and restore document paid amounts, statuses, payment dates, payment-account links, and bank/card balances atomically.
4. Payment creation and reversal require owner, admin, or bookkeeper membership. Viewer mutation is rejected by the route guard.

## Automated acceptance evidence

The disposable PostgreSQL lifecycle test verifies:

- reviewed taxable and exempt documents;
- independent GST/QST calculations and partial recovery evidence;
- idempotent retries and transaction rollback;
- exact CAD invoice receipt and bill disbursement with no false FX line;
- paid-document locking followed by explicit payment reversal;
- balanced original and reversing journals;
- restored AR/AP document state and financial-account balance;
- closed-period controls and exact tax-document reversal;
- source-to-workpaper-to-GL reconciliation;
- prepare, review, external-filing recording, frozen versions, and amendment creation.

The broader unit suite covers supported Canadian rates, component treatment, exclusive/inclusive rounding, recovery, tenant boundaries, manipulated totals, and foreign-currency posting plans.

## Rollback and release boundary

- Immediate operational rollback: set the pilot company's CompanyTaxConfiguration.enabled flag to false. Legacy companies remain unchanged.
- Database rollback is a forward correction. The migration is additive; populated audit fields are not dropped.
- The product owner waived backup/restore because all current records are test data.
- Production activation remains off for every company. A real company requires its own registration, effective dates, GL mappings, opening-tax reconciliation, and written approval.

## Completion decision

P1-F is complete when the migration and lifecycle tests pass in CI, the synthetic Ontario staging fixture reconciles with no blockers or drift, the staging flag is enabled only for that fixture, and production is verified to have zero enabled tax configurations.
