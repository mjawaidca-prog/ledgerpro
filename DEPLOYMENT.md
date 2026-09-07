# Production deployment safety

Application builds must never modify the production database. `npm run build`
only generates the Prisma client and builds Next.js. Database changes are a
separate, reviewed release step.

## Immediate credential response

The repository previously tracked `vercel-env.txt`. Treat every non-placeholder
value that appeared in that file as exposed, even after the file is deleted.

1. Rotate `NEXTAUTH_SECRET`, Stripe secret keys, and Stripe webhook secrets in
   their source systems.
2. Update the encrypted values in Vercel.
3. Redeploy and verify authentication, checkout, and webhook delivery.
4. Purge the file from Git history in a coordinated maintenance window. History
   rewriting is disruptive and does not replace credential rotation.

## Checked-in Prisma migration baseline

The repository now contains the generated baseline migration
`20260907000000_baseline`. CI executes it against an empty PostgreSQL 16
database and fails if the resulting database differs from
`prisma/schema.prisma`.

The baseline SQL represents the current application schema. It is intended to
create a new, empty database. **Never execute its create-table SQL against the
existing production database.**

## One-time adoption for an existing database

Before the first schema-changing release, adopt the baseline separately in a
backup-gated maintenance window:

1. Take and verify a restorable production database backup.
2. Restore that backup to an isolated staging database.
3. Point `DATABASE_URL` and `DIRECT_URL` only at staging and run this read-only
   comparison:

   ```bash
   npm run db:migrate:drift
   ```

   Exit code 0 means the database matches the checked-in schema. Exit code 2
   means drift exists and must be investigated; do not mark the baseline.
4. When staging matches exactly, record the baseline without executing its SQL:

   ```bash
   npx prisma migrate resolve --applied 20260907000000_baseline
   npm run db:migrate:status
   npm run db:migrate:deploy
   npm run db:migrate:drift
   ```

5. Rehearse backup restoration and the complete release procedure on staging.
6. Repeat the drift check against production. Only after it reports no drift,
   mark `20260907000000_baseline` as applied in production and verify migration
   status. Keep the command transcript with the release record.
7. Only then enable `npm run db:migrate:deploy` as a production release step.

Stop immediately if any command targets an unexpected database, reports drift,
or proposes destructive SQL.

For every later schema change, create a migration with `prisma migrate dev`,
review the SQL, run `npm run db:migrate:safety`, test it against staging, back
up production, and run `npm run db:migrate:deploy` before deploying code that
depends on it. The safety check rejects `DROP`, `TRUNCATE`, and `DELETE FROM`
statements; destructive maintenance requires a separate reviewed plan.

Never restore `prisma db push --accept-data-loss` to the build command.
