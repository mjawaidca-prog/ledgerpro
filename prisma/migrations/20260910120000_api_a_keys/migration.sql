-- API-A: public API security foundation. Adds the ApiKey and ApiRateCounter
-- tables, the key permission enum, and the company-level apiAccessEnabled
-- switch. Additive only; existing tables are untouched.

-- CreateEnum
CREATE TYPE "ApiKeyPermission" AS ENUM ('read', 'write_draft', 'write_posting');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "apiAccessEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "permissions" "ApiKeyPermission"[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiRateCounter" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApiRateCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_companyId_idx" ON "ApiKey"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiRateCounter_apiKeyId_scope_windowStart_key" ON "ApiRateCounter"("apiKeyId", "scope", "windowStart");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiRateCounter" ADD CONSTRAINT "ApiRateCounter_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

