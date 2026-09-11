-- API-C: idempotency records for v1 write endpoints. One row per
-- (key, Idempotency-Key) so retries replay the stored response instead of
-- executing again. Additive only; existing tables are untouched.

-- CreateTable
CREATE TABLE "ApiIdempotencyRecord" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "statusCode" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiIdempotencyRecord_companyId_createdAt_idx" ON "ApiIdempotencyRecord"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiIdempotencyRecord_apiKeyId_requestKey_key" ON "ApiIdempotencyRecord"("apiKeyId", "requestKey");

-- AddForeignKey
ALTER TABLE "ApiIdempotencyRecord" ADD CONSTRAINT "ApiIdempotencyRecord_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

