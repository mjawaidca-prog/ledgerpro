# API-E documentation and launch

API-E closes the public API program: the OpenAPI endpoint reference, in-app developer documentation, the plan entitlement and pricing reconciliation, and the launch policy. The program gate — "an external developer completes an integration using the documentation" — is prepared by this stage: everything a developer needs is published, and the pilot path is defined. The external integration itself is the launch checkpoint.

## What shipped

- **OpenAPI 3.0 document** served at `https://ledger.nexvarlab.com/api/v1/openapi.json` — public (it grants nothing), cached 5 minutes. Covers all 24 v1 paths, the bearer-key security scheme, pagination, money and error schemas, idempotency parameters on every POST, and the webhook signature contract.
- **Help → Developer API** — seven articles: overview, authentication and permissions, pagination and change sync, error codes, tax and FX restrictions, webhook verification and dedupe, and the sandbox/pilot guide.
- **Plan entitlement** — `Plan.apiAccess` on Pro and Enterprise (additive migration + seed). Production API access follows the plan; sandbox access is granted separately to approved developers on any plan; no per-call billing initially.
- **Pricing reconciliation** — the marketing page had been underpricing every plan relative to billing (Basic $19 vs $29, Pro $49 vs $79, Enterprise $129 vs $199). It now matches the database seed and Stripe configuration: Basic $29/$290, Pro $79/$790, Enterprise $199/$1,990 — and "API access" is advertised only on Pro and Enterprise, where the entitlement actually exists. This resolves the audit's open issue before any launch advertising.

## Launch policy

- Sandbox: approved developers receive separate credentials against an isolated environment with synthetic companies (P1-F Synthetic Ontario Pilot) and synthetic charts of accounts. Sandbox keys never authenticate against production data.
- Pilot: test company and one accountant pilot first, then broader access.
- Entitlement: production API access on Pro and Enterprise; published usage allowances with stricter limits for reports and writes; owner visibility into usage, failures and revoked keys.

## Versioning and deprecation policy

- `v1` is stable: additive fields and new endpoints may arrive without notice; breaking changes ship as a new major version.
- Deprecations are announced with a documented sunset period; the version prefix (`/api/v1`) is never silently changed.

## Automated acceptance evidence

- Unit suite: the OpenAPI document covers every v1 path with idempotency parameters on every POST; the help center carries the Developer API category with unique slugs; the pricing page matches the billing seeds and advertises API access only on Pro/Enterprise; the plan migration adds the entitlement and enables Pro/Enterprise only. **289 unit tests** pass in the full verify pipeline (secret scan, migration safety, schema validation, typecheck, build).
- Migration `20260911230000_api_e_plan_api_access` is additive, applied to staging with zero drift; staging plan rows now mirror production entitlement (Pro + Enterprise `apiAccess = true`).

## Live staging evidence

- Preview deployment (`ledgerpro-h5x527xvq`, branch-scoped env on `ledgerpro-staging`): `/api/v1/openapi.json` returns the complete document **without authentication**; `/pricing` renders the reconciled prices ($29/$79/$199) with API access on Pro and Enterprise; `/help` and `/settings/developer` render (auth-gated as designed).

## Rollback and release boundary

- The migration is additive; reverting the entitlement is a value flip, not a schema change.
- Production ships with zero API keys and `apiAccessEnabled = false` everywhere — nothing external is reachable until an owner opts in, regardless of plan flags.
- Marketing now matches billing, so the entitlement cannot be over-advertised.

## Completion decision

- **2026-09-11 — CI run 53 passed all gates:** secret scan (GitGuardian + local), migration safety, schema validation, migration deploy/status/drift on PostgreSQL 16, typecheck, the full unit suite (298 tests, 289 run) and the production build.
- **2026-09-11 — staging rehearsal passed** (evidence above).
- Launch checkpoint (external): an approved developer completes one integration against the sandbox using only these documents — the program-level acceptance test.
