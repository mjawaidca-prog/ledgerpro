# LedgerPro sample company

## Creation evidence

Created on 15 September 2026 for the owner selected by the user. The SQL was
first rehearsed inside a transaction and rolled back, then executed and queried.
Verified: 10 GL accounts, 2 contacts, 1 draft invoice, 1 draft bill, 3 review
transactions, a zero journal debit/credit difference, API disabled and no bank
connections. This verifies the fixture, not a live bank-feed pilot.

The operator seed `scripts/create-sample-company.sql` creates **LedgerPro Sample — Maple Practice Ltd.** for one verified existing owner. It is a separate fictional training company available through the normal company selector, not a copy of customer data.

## Operator execution

1. Verify the intended existing owner's `User.id`; names alone are not unique.
2. Review the target database. Replace the single `REPLACE_WITH_VERIFIED_EXISTING_OWNER_ID` assignment with that ID (SQL-escape any quote). Run the entire script through the administrative database connection. Do not run the broad development or production seeds.
3. Run the checks below; switch companies in the app and confirm the SAMPLE title before exercising workflows.

The script is atomic and serialized per owner. On repeat it returns without editing data or extending the trial. A conflicting ID or missing owner/zero-price trial plan fails before changes. It follows the existing `createCompanyForUser` semantics: a new company gets its own ordinary Free Trial, without changing other companies' subscriptions or imposing a new cross-company entitlement policy. It neither deletes nor modifies other companies. All created IDs are deterministic with a `sample_v1_` prefix; this marker is operational, not an authorization boundary.

## Included exercises

| Area | Initial state |
| --- | --- |
| Canadian company | Alberta, CAD, current calendar fiscal year; no business/tax registration numbers |
| Opening trial balance | Bank debit $10,000; equipment debit $2,000; share capital credit $12,000 |
| Contacts | One fictional customer and one fictional supplier, no email/phone |
| Invoice | Unsent draft: $1,000 + illustrative $50 GST |
| Bill | Unpaid draft: $200 + illustrative $10 GST |
| Manual banking | Three unposted review rows: +$1,050, −$210 and −$15 |

The initial bank/GL balance remains $10,000: review rows have not been posted. Initial AR, AP, income, expenses and tax controls are zero. Draft tax arithmetic is not a P1 tax snapshot, return workpaper or claim; company tax configuration remains unactivated. Start with reviewing drafts, posting using the normal reviewed workflow and categorizing the bank fee. Do not match against drafts before posting them.

The normal 30-day Free Trial applies. The seed does not create paid entitlements, payment details, API keys or bank connections, and does not send emails. API and direct bank-feed testing require the normal entitlement and activation process. Keep this fictional company separate from a real-bank production pilot: a sample dataset does not establish production provider approval or prove real banking reconciliation. There is no reset button; rerunning preserves exercises already performed.

## Initial verification

Use the same verified owner ID in the following query. Expected immediately after creation: 1 membership, 10 GL accounts, 2 contacts, 1 draft invoice, 1 draft bill, 3 review rows, 1 journal, debit/credit $12,000, API false, zero tax configurations and bank connections.

```sql
WITH target AS (
 SELECT 'sample_v1_' || md5('VERIFIED_OWNER_ID') || '_company' AS id
)
SELECT c.id, c.name, c."apiAccessEnabled",
 (SELECT count(*) FROM "Membership" WHERE "companyId" = c.id) AS memberships,
 (SELECT count(*) FROM "ChartOfAccount" WHERE "companyId" = c.id) AS gl_accounts,
 (SELECT count(*) FROM "Contact" WHERE "companyId" = c.id) AS contacts,
 (SELECT count(*) FROM "Invoice" WHERE "companyId" = c.id AND status = 'draft') AS draft_invoices,
 (SELECT count(*) FROM "Bill" WHERE "companyId" = c.id AND status = 'draft') AS draft_bills,
 (SELECT count(*) FROM "Transaction" WHERE "companyId" = c.id AND status = 'toreview') AS review_rows,
 (SELECT count(*) FROM "JournalEntry" WHERE "companyId" = c.id) AS journals,
 (SELECT sum(l.debit) FROM "JournalLine" l JOIN "JournalEntry" j ON j.id = l."journalEntryId" WHERE j."companyId" = c.id) AS debit,
 (SELECT sum(l.credit) FROM "JournalLine" l JOIN "JournalEntry" j ON j.id = l."journalEntryId" WHERE j."companyId" = c.id) AS credit,
 (SELECT count(*) FROM "CompanyTaxConfiguration" WHERE "companyId" = c.id) AS tax_configurations,
 (SELECT count(*) FROM "BankConnection" WHERE "companyId" = c.id) AS bank_connections
FROM "Company" c JOIN target t ON c.id = t.id;
```

After practising, balances and counts will naturally change. Validate each posted journal separately rather than assuming the initial fixture totals still apply.
