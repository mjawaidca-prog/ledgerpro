# P1-C server tax posting

P1-C adds the server-only calculation and persistence path that P1-B prepared. It does **not** enable the feature for any company, change the existing invoice/bill screens, or alter legacy posting routes. P1-D will supply the reviewed UI and document adapters.

## Posting boundary

`postTaxDocument` accepts identifiers and tax decisions, then reloads the source invoice or bill, line amounts, categories, document date, currency, and frozen FX rate inside one Prisma transaction. Browser-supplied tax totals are never accepted.

Before any write, the service verifies:

- the actor has an owner, admin, or bookkeeper membership in the same company;
- the tax feature is enabled and the P1-B readiness gate still passes;
- the document tax point is not in a closed period;
- every persisted document line has exactly one selection;
- every category and approved/effective tax-code version belongs to the company;
- jurisdiction evidence is present, and each recoverable purchase component has an explicit fraction, reason, evidence, and same-company owner/admin reviewer; and
- all required output/recoverable accounts come from the company's reviewed mappings.

## Atomic ledger behavior

One database transaction creates the balanced journal, its GL balance effects, the `TaxPosting` idempotency/audit link, immutable line snapshots, component snapshots, and audit log. A failure at any point rolls back all of them.

Sales debit receivables and credit line revenue plus each mapped output-tax account. Purchases debit the line expense/asset for net plus nonrecoverable tax, debit reviewed GST/HST/QST recovery accounts, and credit payables. PST/RST is not treated as an input tax credit.

Home-currency component amounts are frozen independently. The control amount is built from the sum of rounded line/component conversions, so both CAD and foreign-currency entries balance to the cent.

## Retries and reversals

`TaxPosting(companyId, sourceKey)` is unique. A retry returns the existing same-company posting; a concurrent duplicate loses the database uniqueness race and reloads the winner instead of creating a second ledger entry.

`reverseTaxPosting` requires a new open-period date and reason. It posts an equal-and-opposite journal and new negative snapshots linked to the original posting/snapshots. It copies the original frozen rates, treatments, recovery fractions, evidence, and FX facts; it does not look up today's tax or exchange rates.

## Release state

All `CompanyTaxConfiguration.enabled` values remain unchanged. No new route or UI calls this service in P1-C. P1-D must add server-owned adapters and previews, and P1-F still requires a separately approved pilot company before production activation.
