# API accounting review — 15 September 2026

## Corrections prepared

- API posting, voiding, payments and payment reversals now pass the idempotency transaction into the accounting services. Previously those services committed separately, so a failed replay-record insert could leave an unrecorded successful payment.
- A PostgreSQL transaction-scoped advisory lock serializes the same API key/idempotency key before accounting executes. The response record and mutation commit or roll back together.
- Reusing a key for another company, method or path returns 409.
- Document row locks serialize API document posting/voiding and shared payment/reversal services. Journal reversal locks the journal row. Payment services recheck draft/void status after locking.
- Generic API journal void is restricted to original manual journals. Source-managed entries must use their document/payment workflows to preserve subledgers.
- API journal void and payment reversal now check the reversal date against closed-period controls.

## Validation and remaining acceptance work

TypeScript passes. The three focused API write/idempotency suites pass (25 tests), including checking that reviewed posting uses one transaction and mismatched endpoint keys are rejected. These mock tests do not establish real PostgreSQL concurrency/rollback behavior.

Before unrestricted write access, run PostgreSQL integration cases for concurrent identical payments, differing keys on the same document, payment-versus-void, simultaneous reversals, lock timeout and forced replay-record failure. Assert one committed outcome, balanced journals, correct subledger/bank balances, and a retry returning the original response.

Remaining contract gaps:

1. Idempotency records do not store a request-body fingerprint. Same key/path with different payload currently replays the first outcome rather than rejecting a mismatch. Add a nullable fingerprint migration and define behavior for older records before claiming payload-aware idempotency.
2. Some endpoint validation precedes replay lookup. Subsequent document/account changes or period closure can therefore make an otherwise valid retry fail validation rather than replay. Move mutable validation inside the protected execution callback while retaining authentication/authorization before replay.
3. Audit/event dispatch after the accounting transaction is not a transactional outbox. A process failure can commit accounting without reliably delivering its integration event; retries may also repeat side effects. Persist event intent in the accounting transaction and dispatch with deduplication/retry before promising reliable delivery.
4. Exercise the shared services against dashboard write flows as well: row locking is effective only when competing writers participate in the same locking protocol.

This review is not a completed external-developer acceptance test or a declaration that all API release criteria are met.
