-- CCA write-back (LedgerPro improvement plan, Phase 3 item 5;
-- design DESIGN-TAX-DOMAIN.md §3.4): the receiving side of the
-- write-back loop. One new table holds each imported
-- `cca-writeback/1` payload — the CCA claimed and closing UCC by
-- class AS FILED in Nexvar Tax, the full payload as the audit
-- record, and the proposed Schedule 1 year-end journal built from
-- its adjustment lines (proposed only; a preparer approves before
-- anything posts). One new JournalSource value ('cca_writeback')
-- stamps that journal when it is approved. Contract:
-- src/lib/cca-writeback.CONTRACT.md. Receiver:
-- src/lib/cca-writeback.ts + src/lib/cca/writeback-server.ts.
--
-- Additive only: one new table and one new enum value. No existing
-- table, column or row changes meaning.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that reads the new table or posts
-- with sourceType 'cca_writeback'.

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'cca_writeback';

-- CreateTable
CREATE TABLE "CcaWriteback" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "businessNumber" TEXT NOT NULL,
    "fiscalYearStart" TIMESTAMP(3) NOT NULL,
    "fiscalYearEnd" TIMESTAMP(3) NOT NULL,
    "returnId" TEXT NOT NULL,
    "filedAt" TIMESTAMP(3) NOT NULL,
    "confirmationNumber" TEXT,
    "payload" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "journalStatus" TEXT NOT NULL DEFAULT 'none',
    "proposedLines" JSONB,
    "journalEntryId" TEXT,
    "importedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CcaWriteback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CcaWriteback_companyId_fiscalYearEnd_idx" ON "CcaWriteback"("companyId", "fiscalYearEnd");

-- CreateIndex
CREATE INDEX "CcaWriteback_companyId_isLatest_idx" ON "CcaWriteback"("companyId", "isLatest");

-- AddForeignKey
ALTER TABLE "CcaWriteback" ADD CONSTRAINT "CcaWriteback_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
