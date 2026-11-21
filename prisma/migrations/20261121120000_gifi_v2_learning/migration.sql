-- GIFI suggestion engine v2 learning (LedgerPro improvement plan,
-- Phase 2 item 3): suggestion events — what the account form showed
-- and what the user chose — so future suggestions can be re-ranked by
-- this company's own habits first and an anonymized cross-company
-- pattern aggregate second (src/lib/gifi-learning.ts,
-- src/lib/gifi-suggestions-v2.ts).
--
-- Additive only: ONE new table. No existing table, column or row
-- changes meaning, and nothing in bookkeeping reads this table — a
-- missing event costs ranking quality, never correctness.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that reads/writes this table.

-- CreateTable
CREATE TABLE "GifiSuggestionEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "patternExact" TEXT NOT NULL,
    "patternTokens" TEXT NOT NULL,
    "shownCodes" TEXT NOT NULL,
    "chosenCode" TEXT,
    "wasTopSuggestion" BOOLEAN NOT NULL DEFAULT false,
    "wasOverride" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'account-form',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GifiSuggestionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GifiSuggestionEvent_companyId_patternTokens_idx" ON "GifiSuggestionEvent"("companyId", "patternTokens");

-- CreateIndex
CREATE INDEX "GifiSuggestionEvent_companyId_patternExact_idx" ON "GifiSuggestionEvent"("companyId", "patternExact");

-- CreateIndex
CREATE INDEX "GifiSuggestionEvent_patternTokens_accountType_idx" ON "GifiSuggestionEvent"("patternTokens", "accountType");

-- AddForeignKey
ALTER TABLE "GifiSuggestionEvent" ADD CONSTRAINT "GifiSuggestionEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
