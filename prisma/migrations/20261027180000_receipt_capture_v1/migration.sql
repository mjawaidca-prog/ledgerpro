-- Receipt Capture v1 (Phase 2, roadmap item 15; 2026-10-27): the Receipt
-- table — stored receipt file (bytes in Postgres for v1), OCR suggestion
-- fields, and the bank transaction it documents. Additive only; no
-- existing table, column, or row is touched.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor, then
-- record this file in _prisma_migrations with its SHA-256 checksum.

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('inbox', 'attached', 'discarded');

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transactionId" TEXT,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageBackend" TEXT NOT NULL DEFAULT 'db',
    "storageKey" TEXT,
    "imageData" BYTEA,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'inbox',
    "ocrStatus" TEXT NOT NULL DEFAULT 'pending',
    "ocrMerchant" TEXT,
    "ocrDate" TIMESTAMP(3),
    "ocrTotal" DECIMAL(14,2),
    "ocrSubtotal" DECIMAL(14,2),
    "ocrTaxAmount" DECIMAL(14,2),
    "ocrRawText" TEXT,
    "ocrConfidence" DECIMAL(5,2),
    "suggestedCategoryId" TEXT,
    "suggestedSource" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Receipt_companyId_status_idx" ON "Receipt"("companyId", "status");

-- CreateIndex
CREATE INDEX "Receipt_transactionId_idx" ON "Receipt"("transactionId");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_suggestedCategoryId_fkey" FOREIGN KEY ("suggestedCategoryId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
