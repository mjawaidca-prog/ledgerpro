# API accounting review — 15 September 2026

## Corrections prepared

- API posting, voiding, payments and payment reversals now pass the idempotency transaction into the accounting services. Previously those services committed separately, so a failed replay-record insert could leave an unrecorded successful payment.
- A PostgreSQL transaction-scoped advisory lock serializes the same API key/idempotency key before accounting executes. The response record and mutation commit or roll back together.
- Reusing a key for another company, method or path returns 409.
- Document row locks serialize API document posting/voiding and shared payment/reversal services. Journal reversal locks the journal row. Payment services recheck draft/void status after locking.
- Generic API journal void is restricted to original manual journals. Source-managed entries must use their document/payment workflows to preserve subledgers.
- API journal void and payment reversal now check the reversal date against closed-period controls.

## Reliability follow-up — 16 September 2026

- Added a nullable canonical request-body SHA-256 fingerprint. Exact retries replay; reuse for another payload, company, method or path returns `409 idempotency_key_conflict`; legacy null-fingerprint rows return `409 idempotency_legacy_record`.
- Moved mutable document, account, currency and closed-period validation behind the idempotency replay lookup and into the protected database transaction.
- API audit rows and webhook delivery intent now use a transactional outbox: accounting, audit, event intent and replay response commit or roll back together. Delivery remains post-commit and retryable.
- Webhook attempts now serialize across cron and request-triggered sweeps with a PostgreSQL advisory lock, preventing concurrent duplicate sends of the same attempt.
- PostgreSQL integration coverage now verifies concurrent same-key execution, distinct-key payments, forced rollback, outbox/audit atomicity, exact replay without duplicate effects, and changed-payload conflict behavior.

## Remaining external acceptance work

- Add explicit PostgreSQL cases for payment-versus-void, simultaneous reversals and lock-timeout recovery.
- Exercise the shared services against dashboard write flows as well: row locking is effective only when competing writers participate in the same locking protocol.
- Complete an external developer/pilot acceptance test before unrestricted public write access.

This review is not a completed external-developer acceptance test or a declaration that all API release criteria are met.
