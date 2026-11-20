-- CCA register (LedgerPro improvement plan, Phase 1 item 4):
-- a per-asset fixed-asset register holding the tax facts Nexvar Tax's
-- Schedule 8 needs (capital cost net of ITCs, CCA class, available-
-- for-use date, AIIP flag, would-be-Class-53 flag, disposals), book
-- depreciation policy per asset, and one new JournalSource value
-- ('fixed_asset') so the approval-gated annual book-depreciation
-- journal is stamped with its true source. Design: improvement-plan
-- DESIGN-TAX-DOMAIN.md §3. Engine: src/lib/cca/. Export contract:
-- src/lib/cca-register.ts (`cca-register/1`).
--
-- Additive only: two new tables, three new enum types, and one new
-- JournalSource value. No existing table, column or row changes
-- meaning.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that reads these tables or posts with
-- sourceType 'fixed_asset'.

-- CreateEnum
CREATE TYPE "BookDepreciationMethod" AS ENUM ('mirror_tax', 'straight_line', 'declining_balance', 'none');

-- CreateEnum
CREATE TYPE "DisposalReason" AS ENUM ('sold', 'scrapped', 'shareholder_taken', 'traded_in', 'other');

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'fixed_asset';

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "serialNumber" TEXT,
    "vendor" TEXT,
    "invoiceRef" TEXT,
    "location" TEXT,
    "ccaClass" TEXT NOT NULL,
    "grossCost" DECIMAL(14,2) NOT NULL,
    "itcClaimed" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "governmentAssistance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "capitalCost" DECIMAL(14,2) NOT NULL,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "availableForUseDate" TIMESTAMP(3) NOT NULL,
    "aiip" BOOLEAN NOT NULL DEFAULT false,
    "wouldBeClass53" BOOLEAN NOT NULL DEFAULT false,
    "luxuryVehicle" BOOLEAN NOT NULL DEFAULT false,
    "assetAccountCode" TEXT,
    "accumDepAccountCode" TEXT,
    "depExpenseAccountCode" TEXT,
    "bookMethod" "BookDepreciationMethod" NOT NULL DEFAULT 'mirror_tax',
    "bookRatePct" DECIMAL(10,4),
    "bookLifeYears" INTEGER,
    "openingAccumDep" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingAccumThrough" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAssetDisposal" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "disposalDate" TIMESTAMP(3) NOT NULL,
    "proceeds" DECIMAL(14,2) NOT NULL,
    "reason" "DisposalReason" NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedAssetDisposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixedAsset_companyId_ccaClass_idx" ON "FixedAsset"("companyId", "ccaClass");

-- CreateIndex
CREATE INDEX "FixedAsset_companyId_availableForUseDate_idx" ON "FixedAsset"("companyId", "availableForUseDate");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAssetDisposal_assetId_key" ON "FixedAssetDisposal"("assetId");

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAssetDisposal" ADD CONSTRAINT "FixedAssetDisposal_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
