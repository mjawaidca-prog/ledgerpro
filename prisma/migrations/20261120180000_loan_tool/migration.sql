-- Loan & interest tool (LedgerPro improvement plan, Phase 1 item 3):
-- a loan register with generated amortization schedules, approval-gated
-- principal/interest split journals, fiscal-year interest totals, and
-- first-class shareholder loans (per-advance s.15(2) deadlines, series
-- flagging, s.80.4 benefit estimate). Design: improvement-plan
-- DESIGN-TAX-DOMAIN.md §4. Engine: src/lib/loans/.
--
-- Additive only: three new tables, six new enum types, and one new
-- JournalSource value ('loan') so loan split journals are stamped with
-- their true source instead of 'manual'. No existing table, column or
-- row changes meaning.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that reads these tables or posts with
-- sourceType 'loan'.

-- CreateEnum
CREATE TYPE "LoanKind" AS ENUM ('term', 'shareholder_advance', 'shareholder_funding');

-- CreateEnum
CREATE TYPE "LoanRateType" AS ENUM ('fixed', 'variable');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('active', 'paid_off', 'closed');

-- CreateEnum
CREATE TYPE "LoanPaymentFrequency" AS ENUM ('monthly', 'biweekly', 'weekly');

-- CreateEnum
CREATE TYPE "LoanPaymentStatus" AS ENUM ('scheduled', 'posted', 'skipped');

-- CreateEnum
CREATE TYPE "LoanAdvanceKind" AS ENUM ('advance', 'repayment');

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'loan';

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "LoanKind" NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'active',
    "lenderName" TEXT NOT NULL,
    "purpose" TEXT,
    "assetAccountCode" TEXT,
    "principal" DECIMAL(14,2) NOT NULL,
    "annualRatePct" DECIMAL(10,4) NOT NULL,
    "rateType" "LoanRateType" NOT NULL DEFAULT 'fixed',
    "compoundingPerYear" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "firstPaymentDate" TIMESTAMP(3),
    "paymentFrequency" "LoanPaymentFrequency" NOT NULL DEFAULT 'monthly',
    "paymentAmount" DECIMAL(14,2),
    "numberOfPayments" INTEGER,
    "balloonAmount" DECIMAL(14,2),
    "loanAccountCode" TEXT NOT NULL,
    "interestAccountCode" TEXT,
    "paymentAccountCode" TEXT,
    "statementBalance" DECIMAL(14,2),
    "statementBalanceDate" TIMESTAMP(3),
    "prescribedRatePct" DECIMAL(10,4),
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanPayment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL,
    "paymentAmount" DECIMAL(14,2) NOT NULL,
    "interestPortion" DECIMAL(14,2) NOT NULL,
    "principalPortion" DECIMAL(14,2) NOT NULL,
    "closingBalance" DECIMAL(14,2) NOT NULL,
    "status" "LoanPaymentStatus" NOT NULL DEFAULT 'scheduled',
    "actualAmount" DECIMAL(14,2),
    "actualDate" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanAdvance" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "kind" "LoanAdvanceKind" NOT NULL,
    "advanceDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Loan_companyId_kind_idx" ON "Loan"("companyId", "kind");

-- CreateIndex
CREATE INDEX "Loan_companyId_status_idx" ON "Loan"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LoanPayment_loanId_periodNumber_key" ON "LoanPayment"("loanId", "periodNumber");

-- CreateIndex
CREATE INDEX "LoanPayment_loanId_status_idx" ON "LoanPayment"("loanId", "status");

-- CreateIndex
CREATE INDEX "LoanPayment_loanId_dueDate_idx" ON "LoanPayment"("loanId", "dueDate");

-- CreateIndex
CREATE INDEX "LoanAdvance_loanId_advanceDate_idx" ON "LoanAdvance"("loanId", "advanceDate");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAdvance" ADD CONSTRAINT "LoanAdvance_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
