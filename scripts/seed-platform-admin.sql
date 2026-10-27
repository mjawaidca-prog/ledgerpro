-- CC-1: Seed the first PlatformAdmin (role: owner) for the LedgerPro
-- Control Center. IDEMPOTENT — safe to run more than once.
--
-- The user is looked up BY EMAIL; no user id is hardcoded. If the user does
-- not exist yet, this inserts nothing and raises a notice.
--
-- HOW TO RUN (owner, AFTER the control-center migration has been applied to
-- production by the merged deploy — scripts/vercel-build.sh runs
-- `prisma migrate deploy` on production builds):
--   Supabase Dashboard -> SQL Editor -> paste this file -> Run.
-- Do NOT run it against production before the migration exists.

INSERT INTO "PlatformAdmin" ("id", "userId", "role", "createdAt", "updatedAt")
SELECT
  'pa_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  u."id",
  'owner'::"PlatformRole",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."email" = 'mjawaid.ca@gmail.com'
ON CONFLICT ("userId") DO NOTHING;

-- Read-back check (should return exactly one row for the owner email):
-- SELECT pa."role", u."email", u."mfaEnabled"
-- FROM "PlatformAdmin" pa JOIN "User" u ON u."id" = pa."userId";
-- NOTE: if mfaEnabled is false, the owner must enable two-factor in
-- LedgerPro Settings -> Security before the Control Center will open.
