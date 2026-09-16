-- Payload-aware API idempotency. Existing records remain nullable and are
-- rejected for automatic replay because their original payload is unknown.
ALTER TABLE "ApiIdempotencyRecord"
ADD COLUMN "requestHash" TEXT;
