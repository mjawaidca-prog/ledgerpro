-- Receipt phone links: a short-lived, upload-only link ("Add from
-- phone") that lets a phone add receipts to one company's inbox
-- without signing in. Only the SHA-256 hash of the token is stored.
-- Additive only; no existing table, column, or row is touched.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.

-- CreateTable
CREATE TABLE "ReceiptUploadLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "uploadsUsed" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptUploadLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptUploadLink_tokenHash_key" ON "ReceiptUploadLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ReceiptUploadLink_companyId_idx" ON "ReceiptUploadLink"("companyId");

-- AddForeignKey
ALTER TABLE "ReceiptUploadLink" ADD CONSTRAINT "ReceiptUploadLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptUploadLink" ADD CONSTRAINT "ReceiptUploadLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
