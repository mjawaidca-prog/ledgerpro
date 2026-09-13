Yes—we can add direct bank feeds alongside statement imports. I recommend a staged Plaid integration, with transactions entering LedgerPro’s existing review queue and requiring approval before posting.

I reviewed the handoff and the existing banking code. No changes have been made for this request.

The handoff is a useful design specification, but several details need correction before implementation:



| Handoff item                                  | Recommended adjustment                                                                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “Data held in Canada”                         | Do not promise this for the entire feed service without written confirmation from Plaid. LedgerPro’s database location does not establish Plaid’s processing location. |
| “Credentials never stored by Plaid”           | Use wording appropriate to the actual connection method. Promise that **LedgerPro does not receive bank login credentials**.                                           |
| Consent always lasts twelve months            | Display provider-reported expiry and renewal requirements; do not invent an expiry date.                                                                               |
| “3,400+ Canadian institutions”                | Remove the unverified count. Show actual Canadian Transactions coverage.                                                                                               |
| “Beta—balances only” institutions can connect | Exclude these from transaction-feed activation so users are not charged for an unusable feed.                                                                          |
| Hourly sync means fresh bank data hourly      | Distinguish checking available updates from requesting a bank refresh. Plaid typically checks institutions one to four times daily; refresh is separate.               |
| Disconnect deletes every unreviewed row       | Recommend retaining review work by default, with a separate explicit option to remove eligible, untouched feed rows.                                                   |
| Add a new `dedupe_hash` column                | LedgerPro already has `dedupeHash`; extend the existing mechanism.                                                                                                     |

Proposed implementation phases

Phase	Work	Completion requirement
BF-0: Provider and commercial setup	Confirm Canadian bank/business-account coverage, production access, pricing, data handling, and who pays for each connection. Configure isolated Sandbox credentials.	Provider assumptions and customer-facing wording verified.
BF-1: Secure connection foundation	Add connection records, encrypted tokens, account mappings, sync history, consent records, permissions, and audit events. Integrate real Plaid Link and reconnection.	A Sandbox bank connects safely and maps to the correct company accounts.
BF-2: Transaction synchronization	Build cursor-based sync, verified webhooks, durable background jobs, retries, and connection locking. Reuse banking rules and the review queue.	New transactions arrive reliably without creating journal entries.
BF-3: Duplicate and accounting controls	Handle statement overlap, pending-to-posted changes, provider corrections/removals, CAD/USD signs, closed periods, and reconciled transactions.	Accounting acceptance tests pass without duplicate posting or lost legitimate transactions.
BF-4: Screens and connection billing	Build the five requested screen states, settings, reconnect/disconnect, review links, billing ownership, and operational monitoring.	Complete customer workflow passes in staging.
BF-5: Controlled production pilot	Connect an approved real account, compare feed results against statements, verify billing and disconnect, then enable wider access. Update Help and the manual.	Real-bank reconciliation and operational ch



How this will fit LedgerPro

Add Bank feeds within Banking at /banking/feeds, following the application’s existing route structure.
Map provider accounts to LedgerPro’s existing FinancialAccount, which already links to the GL. Validate company, currency, and asset/liability classification.
Store provider metadata separately while using the existing Transaction records for review, matching, and reconciliation.
Keep feed balances separate from LedgerPro’s accounting balances.
Reuse rule suggestions, but explicitly disable the import service’s optional automatic-posting behavior for feeds.
Preserve P1 tax evidence requirements and existing FX settlement logic.
Keep statement imports available throughout.

The most important engineering work is duplicate handling. Plaid and statement files may describe the same payment differently or use different dates. A simple date/amount/description hash cannot guarantee detection.

I would use provider transaction IDs for repeat syncs, pending-to-posted references for settlement changes, and account-scoped comparison for statement overlap. Ambiguous matches would be held for review. Two legitimate identical purchases must remain possible.

Provider modifications must also respect accounting history: an already-posted or reconciled transaction should generate a correction alert, not silently change the ledger. Sync pagination and cursor updates must recover safely from partial failures, following Plaid’s synchronization requirements.

Billing needs one clear distinction: Plaid bills your integration; LedgerPro must separately charge the designated customer if you want to pass on the cost. A Plaid connection can contain multiple accounts. Charges may continue while a connection is broken, and stopping sync alone does not end them. Disconnect must successfully remove the provider Item before discarding its token. Plaid billing documentation

My recommended initial scope is Canadian CAD/USD bank and credit-card accounts, webhook updates plus a daily scheduled check, manual approval for posting, and an owner-approved connection add-on. Leave hourly refresh and balances-only connections for later.
