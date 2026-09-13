-- BF-2: feed transaction linkage and the Plaid sync cursor. Provider ids
-- are the dedupe authority; the link survives settlement and corrections.
-- Additive only.

-- AlterTable
ALTER TABLE "BankConnection" ADD COLUMN     "transactionsCursor" TEXT;

-- CreateTable
CREATE TABLE "BankFeedTransaction" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "providerTransactionId" TEXT NOT NULL,
    "pendingTransactionId" TEXT,
    "transactionId" TEXT,
    "settledAt" TIMESTAMP(3),
    "removedByProviderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankFeedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankFeedTransaction_transactionId_key" ON "BankFeedTransaction"("transactionId");

-- CreateIndex
CREATE INDEX "BankFeedTransaction_connectionId_createdAt_idx" ON "BankFeedTransaction"("connectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankFeedTransaction_providerAccountId_providerTransactionId_key" ON "BankFeedTransaction"("providerAccountId", "providerTransactionId");

-- AddForeignKey
ALTER TABLE "BankFeedTransaction" ADD CONSTRAINT "BankFeedTransaction_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankFeedTransaction" ADD CONSTRAINT "BankFeedTransaction_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

