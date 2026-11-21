-- Ask your books (LedgerPro improvement plan, Phase 3 item 4):
-- the audit trail for the grounded question box (src/lib/ask/).
-- One row per question asked: the question text, the library intent
-- chosen (NULL when the question was refused as outside the library),
-- the validated parameters as JSON (periods, day thresholds, limits,
-- a category phrase — an answer's figures are NEVER stored), which
-- selector chose it ('matcher' | 'llm' | 'none'), and the timestamp.
--
-- Additive only: one new table. No existing table, column or row
-- changes meaning, and nothing in bookkeeping reads this table — it
-- is a log, kept with the records like every other audit trail.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that reads or writes "AskBooksQuery".

-- CreateTable
CREATE TABLE "AskBooksQuery" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "question" TEXT NOT NULL,
    "intentId" TEXT,
    "params" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskBooksQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AskBooksQuery_companyId_createdAt_idx" ON "AskBooksQuery"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "AskBooksQuery" ADD CONSTRAINT "AskBooksQuery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
