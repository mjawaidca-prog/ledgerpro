#!/bin/bash
# Vercel build entry point (see "buildCommand" in vercel.json).
#
# Production deployments apply pending Prisma migrations BEFORE building,
# so a schema change ships together with the code that needs it — nobody
# has to run `prisma migrate deploy` by hand against production.
#
# Preview/development deployments deliberately SKIP migrations: a preview
# must never mutate the production database.
set -e

if [ "$VERCEL_ENV" = "production" ]; then
  echo "[vercel-build] production: applying pending database migrations..."
  npx prisma migrate deploy
else
  echo "[vercel-build] VERCEL_ENV=${VERCEL_ENV:-unset}: skipping migrations (not a production build)."
fi

npm run build
