-- Reconciliation assistant (LedgerPro improvement plan, Phase 3 item 1):
-- reviewer-rejected pairings for the match-proposal engine
-- (src/lib/recon/). The engine proposes matches for unreconciled bank
-- rows (open invoices/bills, existing journal entries, exact-sum
-- splits); when a reviewer says "not this match", the pairing is
-- recorded here and never proposed again for that row. Confirmed
-- matches need no table — the existing match flow already writes
-- Transaction.matchedDocs, and the engine's memory is derived from it.
--
-- Additive only: one new table. No existing table, column or row changes.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that reads or writes "ReconRejectedPairing".

-- CreateTable
CREATE TABLE "ReconRejectedPairing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetRef" TEXT,
    "reason" TEXT,
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconRejectedPairing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconRejectedPairing_companyId_transactionId_idx" ON "ReconRejectedPairing"("companyId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconRejectedPairing_transactionId_targetType_targetId_key" ON "ReconRejectedPairing"("transactionId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "ReconRejectedPairing" ADD CONSTRAINT "ReconRejectedPairing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconRejectedPairing" ADD CONSTRAINT "ReconRejectedPairing_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
