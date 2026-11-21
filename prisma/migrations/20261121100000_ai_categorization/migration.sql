-- AI categorization (LedgerPro improvement plan, Phase 2 item 1):
-- the propose–confirm–learn audit trail for bank-import categorization.
-- One row per engine suggestion (source layer, confidence, plain-language
-- reason) plus the reviewer's recorded decision (accepted / overridden,
-- final category, bulk or individual). Engine: src/lib/ai/.
--
-- Additive only: one new table. No existing table, column or row changes.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that reads or writes "AiSuggestion".

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "payeeKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "suggestedCategoryId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "model" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "finalCategoryId" TEXT,
    "viaBulk" BOOLEAN NOT NULL DEFAULT false,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSuggestion_companyId_transactionId_idx" ON "AiSuggestion"("companyId", "transactionId");

-- CreateIndex
CREATE INDEX "AiSuggestion_companyId_payeeKey_outcome_idx" ON "AiSuggestion"("companyId", "payeeKey", "outcome");

-- CreateIndex
CREATE INDEX "AiSuggestion_companyId_outcome_idx" ON "AiSuggestion"("companyId", "outcome");

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_suggestedCategoryId_fkey" FOREIGN KEY ("suggestedCategoryId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
