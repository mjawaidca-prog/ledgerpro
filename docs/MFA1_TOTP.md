# MFA-1 end-user two-factor authentication

MFA-1 adds authenticator-app two-factor authentication to dashboard logins: TOTP per RFC 6238, one-time backup codes, encrypted-at-rest secrets, and a two-step login that reveals nothing about MFA status to someone with the wrong password. The stage closes the gate "RFC 6238 vectors pass, login requires codes for MFA users, backup codes recover lockouts" — verified live against the staging database.

## What shipped

- **TOTP core** (`src/lib/mfa/totp.ts`) — RFC 6238 with SHA-1 HMAC, 6-digit codes, 30-second steps, and a ±1-step tolerance window; the implementation is pinned by the RFC's official test vectors in the unit suite. Secrets are base32; QR codes are rendered **server-side** (the otpauth URI never leaves the box through a third-party service).
- **Secrets at rest** (`src/lib/mfa/secret-crypto.ts`) — AES-256-GCM with the deployment `MFA_SECRET` key; ciphertexts carry the `mfa1.` prefix, IV and tag. Tampering and wrong-key decryption fail closed.
- **Backup codes** (`src/lib/mfa/backup-codes.ts`) — ten per user, stored as SHA-256 hashes, shown exactly once at enable time, and consumed one-time with constant-time comparison.
- **Login flow** — the NextAuth credentials `authorize` now has a second step: a correct password on an MFA-enabled account returns `MFA_REQUIRED` (the login page then shows the code field), the code step accepts a TOTP code or a backup code, and a used backup code is consumed and persisted. Wrong passwords always get the same generic error — MFA status never leaks.
- **Settings → Security** — enable flow (server-rendered QR + manual key + verification), backup codes displayed exactly once with copy-all, and disable requiring the account password plus a current code (a stolen session cannot silently strip the second factor). Sidebar entry added.
- **Audit** — `mfa.setup`, `mfa.enable`, `mfa.disable` events.
- **Additive migration** `20260914100000_mfa1_totp` — four fields on `User`, all off by default.

## Automated acceptance evidence

- Unit suite (17 new tests): RFC 6238 vectors, secret generation/decoding, window tolerance, otpauth URI parameters, encryption round-trip/tamper/wrong-key, backup-code uniqueness and one-time consumption; the login flow (no MFA-status leakage, `MFA_REQUIRED`, TOTP login, backup-code login with persistence, non-MFA users unaffected); the migration's additivity. **372 unit tests** pass in the full verify pipeline.
- **2026-09-14 — live staging rehearsal passed** against the staging database with a synthetic user: the secret stored encrypted with no plaintext leak; a real TOTP code verified; wrong password → generic error; password alone → `MFA_REQUIRED`; TOTP login succeeded; backup-code login succeeded and the code was consumed (9 of 10 remaining); the synthetic user removed afterwards. The disable route's session-dependent wiring is covered by unit tests (the route requires a signed-in session, which the scripted rehearsal cannot fabricate).
- Production: migration applied with zero drift; `MFA_SECRET` set in the Vercel production environment with a verified 32-byte key.

## Rollback and release boundary

- The migration is additive and everything defaults to off — no existing user is affected until they enable MFA.
- Operational rollback: unset `MFA_SECRET` would make MFA logins fail (not silently bypass); the recovery path is the owner resetting the user's MFA fields in the database, documented for support.

## Completion decision

- **2026-09-14 — CI run 86 green** and the live staging rehearsal passed (evidence above).
- This also completes the product side of the Plaid production-application MFA question: dashboard logins now support and enforce second-factor authentication when enabled.
