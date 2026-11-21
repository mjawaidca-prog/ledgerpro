-- Books health radar (LedgerPro improvement plan, Phase 2 item 4):
-- reviewer dismissals for the deterministic anomaly & duplicate radar
-- (src/lib/health/). The radar computes flags from the books on every
-- page load and stores nothing; a dismissal is the only persisted
-- state, keyed to the flag's stable fingerprint so it silences exactly
-- the flagged item — when the underlying item changes, its fingerprint
-- changes and the flag returns for a fresh look.
--
-- Additive only: one new table. No existing table, column or row
-- changes meaning.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that reads this table.

-- CreateTable
CREATE TABLE "HealthFlagDismissal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "dismissedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthFlagDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthFlagDismissal_companyId_idx" ON "HealthFlagDismissal"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthFlagDismissal_companyId_fingerprint_key" ON "HealthFlagDismissal"("companyId", "fingerprint");

-- AddForeignKey
ALTER TABLE "HealthFlagDismissal" ADD CONSTRAINT "HealthFlagDismissal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
