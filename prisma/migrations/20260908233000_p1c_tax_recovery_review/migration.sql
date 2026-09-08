-- Recovery evidence and an identified same-company reviewer make ITC/ITR
-- decisions auditable.

ALTER TABLE "DocumentLineTaxComponent"
  ADD COLUMN "recoveryEvidence" JSONB,
  ADD COLUMN "recoveryReviewedById" TEXT,
  ADD COLUMN "recoveryReviewedAt" TIMESTAMP(3);

CREATE INDEX "DocumentLineTaxComponent_recoveryReviewedById_idx"
  ON "DocumentLineTaxComponent"("recoveryReviewedById");

ALTER TABLE "DocumentLineTaxComponent"
  ADD CONSTRAINT "DocumentLineTaxComponent_recoveryReviewedById_fkey"
  FOREIGN KEY ("recoveryReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "DocumentLineTaxComponent_recovery_review_check"
  CHECK (
    "recoveryBasisPoints" = 0 OR (
      "recoveryReason" IS NOT NULL AND
      "recoveryEvidence" IS NOT NULL AND jsonb_typeof("recoveryEvidence") = 'object' AND
      "recoveryReviewedById" IS NOT NULL AND "recoveryReviewedAt" IS NOT NULL
    )
  );
