-- Inter-company transaction idempotency: the transfer form could be
-- submitted twice (double-click / retry) and the API posted a
-- duplicate pair (seen live 2026-11-03: IC-0003 + IC-0004, $3,200).
-- The client now sends an idempotency key with each submission; it is
-- stored on the transaction and the unique index below makes a second
-- post with the same key impossible — the API returns the original
-- transaction instead. NULL keys (older rows, keyless callers) are
-- unaffected: Postgres treats NULLs as distinct in a unique index.
-- Additive only; no existing table, column, or row is touched.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.

-- AlterTable
ALTER TABLE "InterCompanyTransaction" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "InterCompanyTransaction_idempotencyKey_key" ON "InterCompanyTransaction"("idempotencyKey");
