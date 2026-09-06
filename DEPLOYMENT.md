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

## One-time Prisma migration baseline

This project currently has a production schema but no checked-in Prisma
migration history. Before the first migration-based schema release:

1. Take and verify a restorable production database backup.
2. Generate an initial migration from the current `prisma/schema.prisma` in a
   clean environment.
3. Compare the generated SQL with the production schema and resolve every
   difference.
4. Mark that exact baseline migration as already applied in production with
   `prisma migrate resolve --applied <baseline-name>`; do not execute the
   create-table SQL against the existing database.
5. Test `npm run db:migrate:deploy` against a restored staging copy.
6. Only then enable migrations as a production release step.

For every later schema change, create a migration with `prisma migrate dev`,
review the SQL, test it against staging, back up production, and run
`npm run db:migrate:deploy` before deploying code that depends on it.

Never restore `prisma db push --accept-data-loss` to the build command.
