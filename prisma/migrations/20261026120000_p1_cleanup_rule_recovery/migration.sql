-- Phase 1 cleanup (partial recovery): fractional tax recovery on
-- Settings → Categorization rules. Additive and nullable; existing rules
-- keep their exact current behaviour (null = boolean taxRecoverable
-- semantics). When set (0–100), the percent wins over the boolean and is
-- stamped into the split JSON as taxRecoveryPercent on rule apply.
ALTER TABLE "CategorizationRule"
ADD COLUMN "taxRecoveryPercent" DECIMAL(5,2);
