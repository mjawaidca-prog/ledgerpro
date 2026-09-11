# API-D event webhooks

API-D delivers signed, retried, visible and replayable event notifications to connected applications — `invoice.created`, `invoice.posted`, `bill.created`, `bill.updated`, `payment.recorded`, `journal.posted`. These are LedgerPro integration notifications, separate from Stripe payment webhooks. The stage closes the gate "retries and duplicate deliveries work safely", verified live against a real delivery endpoint.

## What shipped

- **WebhookEndpoint** — owner-managed in Settings → Developer / API Access: destination URL, subscribed events, enabled flag, and a per-endpoint HMAC signing secret shown exactly once (`whsec_…`, 256-bit).
- **WebhookDelivery** — one durable record per (endpoint, event): full payload, attempt count, status (`pending`/`success`/`failed`/`dead`), last error, backoff state and delivery history. Replay resets the ladder from the history UI.
- **Delivery** — every attempt signs `timestamp.payload` with HMAC-SHA256 and sends `x-ledgerpro-event`, `x-ledgerpro-event-id`, `x-ledgerpro-timestamp`, `x-ledgerpro-signature` headers. Consumers verify and dedupe on the stable event id.
- **Retry ladder** — fixed 1m → 5m → 30m → 2h → 6h between attempts, then `dead`. A delivery is sent at most once per attempt; successes are never re-delivered.
- **SSRF protection** — destinations must be http/https without embedded credentials; DNS is re-resolved and every resolved IP must be public (private/loopback/link-local/CGNAT/unspecified rejected) **before every attempt**, and each redirect hop is re-validated (max 3).
- **Emission** — events are emitted from both the v1 write endpoints and the dashboard write routes. Emission is best-effort: it can never fail or roll back the mutation that produced the event. Duplicate queueing is impossible (`(endpointId, eventId)` unique, re-emission swallowed).
- **Delivery scheduling** — Vercel's Hobby plan limits crons to one run per day, so a per-minute cron cannot deploy. Instead, every emission runs an **awaited, bounded piggyback sweep** of that company's due deliveries (5 max, 5s per-attempt timeout), and a daily cron (`/api/webhooks/deliver-cron`, CRON_SECRET-guarded) is the catch-all for dormant queues. Retries therefore ride along with real activity.

## Defects found and fixed during the stage

- The first sweep implementation was fire-and-forget — on Vercel serverless the promise froze the moment the request response returned, so deliveries queued but never went out. The sweep is now awaited inside the emission path with hard bounds; the daily cron covers anything dormant.

## Automated acceptance evidence

- Unit suite: signature correctness against an independent HMAC computation; secret entropy; the backoff ladder and its cap; SSRF address classification and destination validation (bad schemes, embedded credentials, private/link-local/unresolvable hosts); delivery success/failure/dead transitions; SSRF-blocked destinations never fetch; successes never re-deliver; emission subscribes-only queueing, P2002 swallowing and never-throw semantics; piggyback sweep wiring. **283 unit tests** pass in the full verify pipeline (secret scan, migration safety, schema validation, typecheck, build).
- Migration `20260911210000_api_d_webhooks` is additive only, applied to staging with zero drift.

## Live staging evidence

- Two rehearsal endpoints on the synthetic staging company: a public catcher (webhook.site) and a failing endpoint (`httpstat.us/500`).
- Three `invoice.created` events emitted through the deployed v1 API: **all three arrived at the catcher with valid signatures** (HMAC recomputed from the received `timestamp.payload` equals the received `x-ledgerpro-signature`).
- The failing endpoint's delivery advanced the ladder live: attempt 1 → 5-minute backoff, attempt 2 → 30-minute backoff (retried by the next event's piggyback sweep after a manual reset).
- The catcher received each event exactly once — no duplicate deliveries.
- Rehearsal endpoints removed from staging after the evidence was captured.

## Rollback and release boundary

- The migration is additive. Operational rollback: disable or delete endpoints in the dashboard; disabling API access for a company does not disable webhooks (they are an independent subscription).
- Production has zero endpoints — no event leaves production until an owner creates one.

## Completion decision

- **2026-09-11 — CI run 49 passed all gates:** secret scan (GitGuardian + local), migration safety, schema validation, migration deploy/status/drift on PostgreSQL 16, typecheck, the full unit suite (292 tests, 283 run) and the production build.
- **2026-09-11 — staging rehearsal passed** (evidence above).
