-- Loan statement-capture pre-fill (LedgerPro improvement plan,
-- Phase 3 item 3): photograph the lender statement (the Ford Credit
-- case) and the loan tool drafts the schedule check for review.
--
-- One new table, LoanStatement. The document storage mirrors Receipt
-- (bytes in Postgres, 'db' backend, sha256) but a statement is NOT a
-- receipt — it never enters the receipts inbox or the expense flows.
-- Its lifecycle: stored → AI-read through the same document-
-- intelligence provider layer as receipts (extractionStatus:
-- pending → extracted | failed | unavailable; the raw read with
-- per-field confidences lives in extractionFields JSONB) → checked
-- against a loan's schedule → applied by a reviewer, which sets the
-- loan's existing statementBalance/statementBalanceDate leg and
-- records the check (and any accepted re-amortization) here.
--
-- Additive only: ONE new table. No existing table, column or row
-- changes meaning. loanId is nullable (a statement exists before the
-- reviewer picks its loan) and SetNull on loan delete — deleting a
-- loan must never destroy statement evidence.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that reads/writes this table.

-- CreateTable
CREATE TABLE "LoanStatement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "loanId" TEXT,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageBackend" TEXT NOT NULL DEFAULT 'db',
    "storageKey" TEXT,
    "imageData" BYTEA,
    "extractionStatus" TEXT NOT NULL DEFAULT 'pending',
    "extractionProvider" TEXT,
    "extractionFields" JSONB,
    "extractionError" TEXT,
    "checkStatementDate" TIMESTAMP(3),
    "checkStatementBalance" DECIMAL(14,2),
    "checkScheduleBalance" DECIMAL(14,2),
    "checkDifference" DECIMAL(14,2),
    "correctionApplied" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoanStatement_companyId_createdAt_idx" ON "LoanStatement"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "LoanStatement_loanId_idx" ON "LoanStatement"("loanId");

-- AddForeignKey
ALTER TABLE "LoanStatement" ADD CONSTRAINT "LoanStatement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanStatement" ADD CONSTRAINT "LoanStatement_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
