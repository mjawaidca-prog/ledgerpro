-- P1-C remains disabled by default. This migration only adds the durable
-- posting/audit link and exact home-currency component amounts.

ALTER TABLE "DocumentLineTaxSnapshot"
  ADD COLUMN "postingId" TEXT,
  ADD COLUMN "reversalOfId" TEXT;

ALTER TABLE "TaxCodeComponent"
  ADD COLUMN "treatment" "TaxTreatment" NOT NULL DEFAULT 'taxable';

ALTER TABLE "DocumentLineTaxComponent"
  ADD COLUMN "treatment" "TaxTreatment" NOT NULL DEFAULT 'legacy_unclassified',
  ADD COLUMN "taxHome" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "outputTaxHome" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "recoverableTaxHome" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "nonrecoverableTaxHome" DECIMAL(14,2) NOT NULL DEFAULT 0;

CREATE TABLE "TaxPosting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxPosting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxPosting_journalEntryId_key" ON "TaxPosting"("journalEntryId");
CREATE UNIQUE INDEX "TaxPosting_reversalOfId_key" ON "TaxPosting"("reversalOfId");
CREATE UNIQUE INDEX "TaxPosting_companyId_sourceKey_key" ON "TaxPosting"("companyId", "sourceKey");
CREATE INDEX "TaxPosting_companyId_createdAt_idx" ON "TaxPosting"("companyId", "createdAt");
CREATE INDEX "TaxPosting_createdById_idx" ON "TaxPosting"("createdById");
CREATE INDEX "DocumentLineTaxSnapshot_postingId_idx" ON "DocumentLineTaxSnapshot"("postingId");
CREATE UNIQUE INDEX "DocumentLineTaxSnapshot_reversalOfId_key" ON "DocumentLineTaxSnapshot"("reversalOfId");

ALTER TABLE "TaxPosting" ADD CONSTRAINT "TaxPosting_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxPosting" ADD CONSTRAINT "TaxPosting_journalEntryId_fkey"
  FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxPosting" ADD CONSTRAINT "TaxPosting_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "TaxPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxPosting" ADD CONSTRAINT "TaxPosting_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentLineTaxSnapshot" ADD CONSTRAINT "DocumentLineTaxSnapshot_postingId_fkey"
  FOREIGN KEY ("postingId") REFERENCES "TaxPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentLineTaxSnapshot" ADD CONSTRAINT "DocumentLineTaxSnapshot_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "DocumentLineTaxSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentLineTaxSnapshot" DROP CONSTRAINT "DocumentLineTaxSnapshot_one_source_line_check";
ALTER TABLE "DocumentLineTaxSnapshot"
  ADD CONSTRAINT "DocumentLineTaxSnapshot_source_or_reversal_check"
  CHECK (
    num_nonnulls("invoiceLineItemId", "billLineItemId") = 1 OR
    (num_nonnulls("invoiceLineItemId", "billLineItemId") = 0 AND "reversalOfId" IS NOT NULL)
  );

ALTER TABLE "DocumentLineTaxComponent"
  ADD CONSTRAINT "DocumentLineTaxComponent_home_amounts_balance_check"
  CHECK ("outputTaxHome" + "recoverableTaxHome" + "nonrecoverableTaxHome" = "taxHome");

ALTER TABLE "TaxCodeComponent"
  ADD CONSTRAINT "TaxCodeComponent_treatment_rate_check"
  CHECK (
    ("treatment" = 'taxable' AND "rate" > 0) OR
    ("treatment" IN ('zero_rated', 'exempt', 'out_of_scope') AND "rate" = 0)
  );

ALTER TABLE "DocumentLineTaxComponent"
  ADD CONSTRAINT "DocumentLineTaxComponent_treatment_rate_check"
  CHECK (
    "treatment" = 'legacy_unclassified' OR
    ("treatment" = 'taxable' AND "rate" > 0) OR
    ("treatment" IN ('zero_rated', 'exempt', 'out_of_scope') AND "rate" = 0)
  );

ALTER TABLE "TaxPosting" ENABLE ROW LEVEL SECURITY;

DO $revoke_data_api$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "TaxPosting" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "TaxPosting" FROM authenticated;
  END IF;
END
$revoke_data_api$;
