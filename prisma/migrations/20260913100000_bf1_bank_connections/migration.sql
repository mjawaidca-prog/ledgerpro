-- BF-1: direct bank feed connection foundation. Connections hold the
-- envelope-encrypted provider token; accounts map to existing GL-linked
-- FinancialAccounts; sync runs are durable history. Additive only.

-- CreateEnum
CREATE TYPE "BankConnectionStatus" AS ENUM ('active', 'login_required', 'pending_expiration', 'revoked', 'error');

-- CreateEnum
CREATE TYPE "BankSyncTrigger" AS ENUM ('webhook', 'manual', 'cron');

-- CreateEnum
CREATE TYPE "BankSyncStatus" AS ENUM ('running', 'success', 'failed');

-- CreateTable
CREATE TABLE "BankConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'plaid',
    "itemId" TEXT NOT NULL,
    "institutionId" TEXT,
    "institutionName" TEXT NOT NULL,
    "status" "BankConnectionStatus" NOT NULL DEFAULT 'active',
    "accessTokenEncrypted" TEXT NOT NULL,
    "consentExpiresAt" TIMESTAMP(3),
    "billableOwnerId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankFeedAccount" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mask" TEXT,
    "subtype" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "currentBalance" DECIMAL(14,2),
    "availableBalance" DECIMAL(14,2),
    "financialAccountId" TEXT,
    "isFeeding" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankFeedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankSyncRun" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "trigger" "BankSyncTrigger" NOT NULL,
    "status" "BankSyncStatus" NOT NULL,
    "addedCount" INTEGER NOT NULL DEFAULT 0,
    "dedupedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BankSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankConnection_itemId_key" ON "BankConnection"("itemId");

-- CreateIndex
CREATE INDEX "BankConnection_companyId_status_idx" ON "BankConnection"("companyId", "status");

-- CreateIndex
CREATE INDEX "BankConnection_billableOwnerId_idx" ON "BankConnection"("billableOwnerId");

-- CreateIndex
CREATE INDEX "BankFeedAccount_financialAccountId_idx" ON "BankFeedAccount"("financialAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BankFeedAccount_connectionId_providerAccountId_key" ON "BankFeedAccount"("connectionId", "providerAccountId");

-- CreateIndex
CREATE INDEX "BankSyncRun_connectionId_startedAt_idx" ON "BankSyncRun"("connectionId", "startedAt");

-- AddForeignKey
ALTER TABLE "BankConnection" ADD CONSTRAINT "BankConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankFeedAccount" ADD CONSTRAINT "BankFeedAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankFeedAccount" ADD CONSTRAINT "BankFeedAccount_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankSyncRun" ADD CONSTRAINT "BankSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

