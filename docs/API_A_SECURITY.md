# API-A security foundation

API-A builds the security layer every later API stage stands on: API keys, per-company permissions, PostgreSQL-backed rate limits, audit records, emergency disable switches and the versioned `/api/v1` route boundary. It closes the gate "unauthorized and cross-company requests are blocked" and ships one proof endpoint, `GET /api/v1/company`, so the whole pipeline is exercised end-to-end.

## What shipped

- **ApiKey model** — tenant-scoped to a company, with a name, display prefix, SHA-256 hash of the secret, a permission list, optional expiry, last-use tracking, a request counter and a soft `revokedAt` flag. The secret itself is shown exactly once at creation and stored nowhere.
- **ApiRateCounter model** — PostgreSQL-backed fixed-window counters (minute and day) per key. Vercel serverless instances share no memory, so in-memory counters would be trivially bypassable; counters are atomic upserts shared across all instances.
- **`/api/v1` auth pipeline** (`src/lib/api/auth.ts`) — resolves the company from the key itself on every request. It never reads the dashboard session or the `lp-active-company-id` cookie, and middleware now routes `/api/v1` outside `withAuth` and outside the dashboard's header injection entirely.
- **Two emergency disable switches** — company-level (`Company.apiAccessEnabled`, off by default) and platform-level (`LEDGERPRO_API_DISABLED=1`). Revocation, expiry and both switches take effect on the next request, not on a cache.
- **Settings → Developer / API Access** — owner-only page to create named keys (read permission; write scopes arrive with API-C), set expiry, see last use and request counts, and revoke immediately. The secret is shown once with a copy affordance and a "never shown again" warning.
- **Audit trail** — `api_key.create`, `api_key.revoke`, `api_access.enable` and `api_access.disable` go through the existing `AuditLog`; key lookups store nothing sensitive.

## Security properties

- Keys are 128-bit random tokens (`lp_live_` + 32 hex); storage holds only `sha256(token)`, so a database read cannot replay credentials. Lookup is by hash — safe because tokens are unguessable (unlike passwords, which use bcrypt).
- Unknown, revoked and malformed keys receive the same generic 401 code; responses never reveal whether a key exists.
- The active-company cookie grants nothing on `/api/v1`: requests with a valid-looking cookie but no key are rejected, and a key resolves to its own company regardless of any cookie.
- Rate limits: 120 req/min and 5000 req/day per key by default (env-overridable); a stricter `report` class (10/min, 500/day) is reserved for API-B report endpoints. Over-limit responses carry `retry_after` seconds.
- Responses exclude registration numbers, secrets and internal identifiers. `GET /api/v1/company` returns profile fields only.

## Automated acceptance evidence

The unit suite covers:

- Token generation format, entropy and hash correctness; strict Bearer parsing; UTC-aligned window math.
- No header, malformed token, unknown key, revoked key, expired key, company switch off, platform switch on, missing permission and rate-limit-exceeded each produce their distinct `error.code`.
- A dashboard cookie alone is never accepted; a key always wins over the cookie for tenant scoping.
- Key management stores only the hash, returns the secret exactly once, and rejects permissions outside the server whitelist.
- The migration is purely additive (no `DROP`, `TRUNCATE`, `DELETE FROM`) and adds the switch off by default.

## Rollback and release boundary

- **Operational rollback:** set `Company.apiAccessEnabled` to false (dashboard toggle) or set `LEDGERPRO_API_DISABLED=1` at the platform. No code rollback needed to stop API traffic.
- **Database rollback is a forward correction.** The migration is additive; reverting is a later reviewed migration, not a destructive one.
- Production ships with `apiAccessEnabled = false` for every company, so no external party can authenticate until an owner opts in. No production keys are created as part of this stage.

## Completion decision

- **2026-09-10 — CI run 31 passed all gates:** secret scan (GitGuardian + local), migration safety, schema validation, migration deploy/status/drift against PostgreSQL 16, typecheck, the full unit suite (228 tests, 219 run) and the production build.
- **2026-09-11 — staging rehearsal passed against a live preview deployment** (`ledgerpro-c1vq7i6ml`, branch-scoped Preview env pointing at the isolated `ledgerpro-staging` Supabase project):
  - Migration `20260910120000_api_a_keys` applied to staging with zero drift (7 prior migrations adopted per `DEPLOYMENT.md`, migration history now complete).
  - Staging has exactly one API key, `read` permission, on `p1f-staging-ontario`.
  - Positive: `GET /api/v1/company` with the key → 200, returns the key's own company.
  - Negative suite: no key → 401 `invalid_api_key`; bogus key → 401 `invalid_api_key`; revoked key → 401 `api_key_revoked`; dashboard cookie alone → 401; key + a different company's cookie → 200 with the **key's** company (cookie ignored); company kill switch off → 403 `api_access_disabled`, restored → 200.
- **Platform fixes made during this stage:** the Vercel build command no longer runs `prisma db push --accept-data-loss` (it is now `prisma generate && next build`); builds can no longer modify any database. A branch-scoped Preview env override routes `codex/api-a-security` deployments to the staging database.
- Production has zero API keys and `apiAccessEnabled = false` everywhere (the column default). No external party can authenticate until an owner opts in.
- Rollback: set `LEDGERPRO_API_DISABLED=1` (platform) or toggle the company switch; no code rollback required to stop traffic.
