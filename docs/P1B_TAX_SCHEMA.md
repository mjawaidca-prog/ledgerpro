# P1-B Canadian tax data foundation

Status: additive database and configuration groundwork, successfully rehearsed against the empty Canadian staging project. The live tax engine remains disabled and unwired.

## Delivered structures

- `CompanyTaxConfiguration`: one disabled-by-default configuration per company, with reviewed per-company GL account mappings.
- `CompanyTaxRegistration`: legal registration, regime, regular filing method, frequency, validity and reviewer evidence.
- `TaxCode` / `TaxCodeVersion` / `TaxCodeComponent`: tenant-owned, versioned and reviewed tax decisions with effective dates and sources.
- `DocumentLineTaxSnapshot` / `DocumentLineTaxComponent`: append-only-shaped line evidence for the P1-C posting service, including jurisdiction, FX, component recovery and exact document/home amounts.
- `assessCompanyTaxReadiness`: a pure activation gate that rejects incomplete governance, unreviewed registrations, missing approved codes, inactive accounts, wrong account types and cross-company mappings.

## Database protections

- The migration is additive: it creates tables, enums, indexes, foreign keys and checks; it does not rewrite legacy documents or ledger balances.
- New configurations default to `enabled = false`.
- Account mappings have database-enforced same-company foreign keys.
- Snapshot totals must balance in document and home currency.
- Exactly one invoice or bill line must own each snapshot.
- PST/RST recovery is blocked in both catalog and snapshot components.
- Foreign-currency snapshots require a positive frozen rate, source and date.
- Approved code versions require an identified reviewer and review timestamp.
- All new public-schema tables have RLS enabled and no Data API privileges for `anon` or `authenticated`.

## Still intentionally excluded

P1-B does not create default tax codes, choose a company's GL accounts, change invoice/bill APIs or screens, create journal entries, build filing workpapers, or enable the feature. Those changes remain gated in P1-C through P1-F.

## Activation rule

No company may enter the new tax path until its configuration passes `assessCompanyTaxReadiness`. P1-C must call that gate inside the authorized server-side posting transaction and must add atomic posting, reversal, locked-period and idempotency tests.
