-- Phase 1: tax treatment on Settings → Categorization rules. Additive and
-- disabled by default; existing rules keep their exact current behaviour.
ALTER TABLE "CategorizationRule"
ADD COLUMN "taxEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "taxProvince" TEXT,
ADD COLUMN "taxInclusive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "taxRecoverable" BOOLEAN NOT NULL DEFAULT true;
