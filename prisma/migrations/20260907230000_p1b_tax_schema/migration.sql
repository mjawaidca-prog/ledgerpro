-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('gst_hst', 'qst', 'pst', 'rst');

-- CreateEnum
CREATE TYPE "TaxFilingMethod" AS ENUM ('regular');

-- CreateEnum
CREATE TYPE "TaxFilingFrequency" AS ENUM ('monthly', 'quarterly', 'annual', 'other');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('taxable', 'zero_rated', 'exempt', 'out_of_scope', 'legacy_unclassified');

-- CreateEnum
CREATE TYPE "TaxPriceMode" AS ENUM ('exclusive', 'inclusive');

-- CreateEnum
CREATE TYPE "TaxReviewStatus" AS ENUM ('draft', 'approved', 'retired');

-- CreateEnum
CREATE TYPE "TaxDirection" AS ENUM ('sale', 'purchase');

-- CreateEnum
CREATE TYPE "TaxComponentType" AS ENUM ('gst', 'hst', 'pst', 'rst', 'qst');

-- CreateEnum
CREATE TYPE "TaxAuthority" AS ENUM ('cra', 'revenu_quebec', 'british_columbia', 'manitoba', 'saskatchewan');

-- CreateTable
CREATE TABLE "CompanyTaxConfiguration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "engineVersion" TEXT NOT NULL DEFAULT 'p1',
    "defaultPriceMode" "TaxPriceMode" NOT NULL DEFAULT 'exclusive',
    "requireJurisdictionEvidence" BOOLEAN NOT NULL DEFAULT true,
    "gstHstOutputAccountId" TEXT,
    "gstHstRecoverableAccountId" TEXT,
    "qstOutputAccountId" TEXT,
    "qstRecoverableAccountId" TEXT,
    "pstRstPayableAccountId" TEXT,
    "taxRoundingAccountId" TEXT,
    "taxClearingAccountId" TEXT,
    "configuredById" TEXT,
    "configuredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTaxConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyTaxRegistration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "province" "CanadianProvince",
    "method" "TaxFilingMethod" NOT NULL DEFAULT 'regular',
    "filingFrequency" "TaxFilingFrequency" NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTaxRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCode" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCodeVersion" (
    "id" TEXT NOT NULL,
    "taxCodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "treatment" "TaxTreatment" NOT NULL,
    "jurisdiction" "CanadianProvince" NOT NULL,
    "priceMode" "TaxPriceMode" NOT NULL DEFAULT 'exclusive',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceReference" TEXT NOT NULL,
    "reviewStatus" "TaxReviewStatus" NOT NULL DEFAULT 'draft',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxCodeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCodeComponent" (
    "id" TEXT NOT NULL,
    "taxCodeVersionId" TEXT NOT NULL,
    "type" "TaxComponentType" NOT NULL,
    "authority" "TaxAuthority" NOT NULL,
    "rate" DECIMAL(7,3) NOT NULL,
    "recoveryAllowed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TaxCodeComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLineTaxSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taxCodeVersionId" TEXT NOT NULL,
    "invoiceLineItemId" TEXT,
    "billLineItemId" TEXT,
    "direction" "TaxDirection" NOT NULL,
    "treatment" "TaxTreatment" NOT NULL,
    "priceMode" "TaxPriceMode" NOT NULL,
    "taxPointDate" TIMESTAMP(3) NOT NULL,
    "jurisdiction" "CanadianProvince" NOT NULL,
    "jurisdictionEvidence" JSONB NOT NULL,
    "jurisdictionOverrideReason" TEXT,
    "documentCurrency" TEXT NOT NULL,
    "homeCurrency" TEXT NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "netHome" DECIMAL(14,2) NOT NULL,
    "taxHome" DECIMAL(14,2) NOT NULL,
    "grossHome" DECIMAL(14,2) NOT NULL,
    "fxRate" DECIMAL(18,8),
    "fxRateSource" "RateSource",
    "fxRateDate" TIMESTAMP(3),
    "engineVersion" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentLineTaxSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLineTaxComponent" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "type" "TaxComponentType" NOT NULL,
    "authority" "TaxAuthority" NOT NULL,
    "rate" DECIMAL(7,3) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "outputTax" DECIMAL(14,2) NOT NULL,
    "recoverableTax" DECIMAL(14,2) NOT NULL,
    "nonrecoverableTax" DECIMAL(14,2) NOT NULL,
    "recoveryBasisPoints" INTEGER NOT NULL,
    "recoveryReason" TEXT,

    CONSTRAINT "DocumentLineTaxComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTaxConfiguration_companyId_key" ON "CompanyTaxConfiguration"("companyId");

-- CreateIndex
CREATE INDEX "CompanyTaxConfiguration_enabled_idx" ON "CompanyTaxConfiguration"("enabled");

-- CreateIndex
CREATE INDEX "CompanyTaxConfiguration_companyId_gstHstOutputAccountId_idx" ON "CompanyTaxConfiguration"("companyId", "gstHstOutputAccountId");

-- CreateIndex
CREATE INDEX "CompanyTaxConfiguration_companyId_gstHstRecoverableAccountI_idx" ON "CompanyTaxConfiguration"("companyId", "gstHstRecoverableAccountId");

-- CreateIndex
CREATE INDEX "CompanyTaxConfiguration_companyId_qstOutputAccountId_idx" ON "CompanyTaxConfiguration"("companyId", "qstOutputAccountId");

-- CreateIndex
CREATE INDEX "CompanyTaxConfiguration_companyId_qstRecoverableAccountId_idx" ON "CompanyTaxConfiguration"("companyId", "qstRecoverableAccountId");

-- CreateIndex
CREATE INDEX "CompanyTaxConfiguration_companyId_pstRstPayableAccountId_idx" ON "CompanyTaxConfiguration"("companyId", "pstRstPayableAccountId");

-- CreateIndex
CREATE INDEX "CompanyTaxConfiguration_companyId_taxRoundingAccountId_idx" ON "CompanyTaxConfiguration"("companyId", "taxRoundingAccountId");

-- CreateIndex
CREATE INDEX "CompanyTaxConfiguration_companyId_taxClearingAccountId_idx" ON "CompanyTaxConfiguration"("companyId", "taxClearingAccountId");

-- CreateIndex
CREATE INDEX "CompanyTaxConfiguration_configuredById_idx" ON "CompanyTaxConfiguration"("configuredById");

-- CreateIndex
CREATE INDEX "CompanyTaxRegistration_companyId_regime_active_idx" ON "CompanyTaxRegistration"("companyId", "regime", "active");

-- CreateIndex
CREATE INDEX "CompanyTaxRegistration_companyId_validFrom_validTo_idx" ON "CompanyTaxRegistration"("companyId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "CompanyTaxRegistration_reviewedById_idx" ON "CompanyTaxRegistration"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTaxRegistration_companyId_regime_registrationNumber__key" ON "CompanyTaxRegistration"("companyId", "regime", "registrationNumber", "validFrom");

-- CreateIndex
CREATE INDEX "TaxCode_companyId_active_idx" ON "TaxCode"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCode_companyId_code_key" ON "TaxCode"("companyId", "code");

-- CreateIndex
CREATE INDEX "TaxCodeVersion_taxCodeId_effectiveFrom_effectiveTo_idx" ON "TaxCodeVersion"("taxCodeId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "TaxCodeVersion_jurisdiction_reviewStatus_idx" ON "TaxCodeVersion"("jurisdiction", "reviewStatus");

-- CreateIndex
CREATE INDEX "TaxCodeVersion_reviewedById_idx" ON "TaxCodeVersion"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCodeVersion_taxCodeId_version_key" ON "TaxCodeVersion"("taxCodeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCodeComponent_taxCodeVersionId_type_key" ON "TaxCodeComponent"("taxCodeVersionId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLineTaxSnapshot_invoiceLineItemId_key" ON "DocumentLineTaxSnapshot"("invoiceLineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLineTaxSnapshot_billLineItemId_key" ON "DocumentLineTaxSnapshot"("billLineItemId");

-- CreateIndex
CREATE INDEX "DocumentLineTaxSnapshot_companyId_taxPointDate_idx" ON "DocumentLineTaxSnapshot"("companyId", "taxPointDate");

-- CreateIndex
CREATE INDEX "DocumentLineTaxSnapshot_taxCodeVersionId_idx" ON "DocumentLineTaxSnapshot"("taxCodeVersionId");

-- CreateIndex
CREATE INDEX "DocumentLineTaxSnapshot_createdById_idx" ON "DocumentLineTaxSnapshot"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLineTaxSnapshot_companyId_sourceKey_key" ON "DocumentLineTaxSnapshot"("companyId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLineTaxComponent_snapshotId_type_key" ON "DocumentLineTaxComponent"("snapshotId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccount_companyId_id_key" ON "ChartOfAccount"("companyId", "id");

-- AddForeignKey
ALTER TABLE "CompanyTaxConfiguration" ADD CONSTRAINT "CompanyTaxConfiguration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxConfiguration" ADD CONSTRAINT "CompanyTaxConfiguration_companyId_gstHstOutputAccountId_fkey" FOREIGN KEY ("companyId", "gstHstOutputAccountId") REFERENCES "ChartOfAccount"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxConfiguration" ADD CONSTRAINT "CompanyTaxConfiguration_companyId_gstHstRecoverableAccount_fkey" FOREIGN KEY ("companyId", "gstHstRecoverableAccountId") REFERENCES "ChartOfAccount"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxConfiguration" ADD CONSTRAINT "CompanyTaxConfiguration_companyId_qstOutputAccountId_fkey" FOREIGN KEY ("companyId", "qstOutputAccountId") REFERENCES "ChartOfAccount"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxConfiguration" ADD CONSTRAINT "CompanyTaxConfiguration_companyId_qstRecoverableAccountId_fkey" FOREIGN KEY ("companyId", "qstRecoverableAccountId") REFERENCES "ChartOfAccount"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxConfiguration" ADD CONSTRAINT "CompanyTaxConfiguration_companyId_pstRstPayableAccountId_fkey" FOREIGN KEY ("companyId", "pstRstPayableAccountId") REFERENCES "ChartOfAccount"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxConfiguration" ADD CONSTRAINT "CompanyTaxConfiguration_companyId_taxRoundingAccountId_fkey" FOREIGN KEY ("companyId", "taxRoundingAccountId") REFERENCES "ChartOfAccount"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxConfiguration" ADD CONSTRAINT "CompanyTaxConfiguration_companyId_taxClearingAccountId_fkey" FOREIGN KEY ("companyId", "taxClearingAccountId") REFERENCES "ChartOfAccount"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxConfiguration" ADD CONSTRAINT "CompanyTaxConfiguration_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxRegistration" ADD CONSTRAINT "CompanyTaxRegistration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxRegistration" ADD CONSTRAINT "CompanyTaxRegistration_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCodeVersion" ADD CONSTRAINT "TaxCodeVersion_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCodeVersion" ADD CONSTRAINT "TaxCodeVersion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCodeComponent" ADD CONSTRAINT "TaxCodeComponent_taxCodeVersionId_fkey" FOREIGN KEY ("taxCodeVersionId") REFERENCES "TaxCodeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLineTaxSnapshot" ADD CONSTRAINT "DocumentLineTaxSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLineTaxSnapshot" ADD CONSTRAINT "DocumentLineTaxSnapshot_taxCodeVersionId_fkey" FOREIGN KEY ("taxCodeVersionId") REFERENCES "TaxCodeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLineTaxSnapshot" ADD CONSTRAINT "DocumentLineTaxSnapshot_invoiceLineItemId_fkey" FOREIGN KEY ("invoiceLineItemId") REFERENCES "InvoiceLineItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLineTaxSnapshot" ADD CONSTRAINT "DocumentLineTaxSnapshot_billLineItemId_fkey" FOREIGN KEY ("billLineItemId") REFERENCES "BillLineItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLineTaxSnapshot" ADD CONSTRAINT "DocumentLineTaxSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLineTaxComponent" ADD CONSTRAINT "DocumentLineTaxComponent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DocumentLineTaxSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Accounting and activation invariants that Prisma cannot express.
ALTER TABLE "CompanyTaxConfiguration"
  ADD CONSTRAINT "CompanyTaxConfiguration_enabled_reviewed_check"
  CHECK (
    NOT "enabled" OR (
      "requireJurisdictionEvidence" = true
      AND "configuredById" IS NOT NULL
      AND "configuredAt" IS NOT NULL
      AND "taxRoundingAccountId" IS NOT NULL
    )
  );

ALTER TABLE "CompanyTaxRegistration"
  ADD CONSTRAINT "CompanyTaxRegistration_valid_range_check"
  CHECK ("validTo" IS NULL OR "validTo" > "validFrom");

ALTER TABLE "TaxCodeVersion"
  ADD CONSTRAINT "TaxCodeVersion_valid_range_check"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  ADD CONSTRAINT "TaxCodeVersion_approved_review_check"
  CHECK ("reviewStatus" <> 'approved' OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL));

ALTER TABLE "TaxCodeComponent"
  ADD CONSTRAINT "TaxCodeComponent_rate_check"
  CHECK ("rate" >= 0 AND "rate" <= 100.000),
  ADD CONSTRAINT "TaxCodeComponent_provincial_recovery_check"
  CHECK ("type" NOT IN ('pst', 'rst') OR "recoveryAllowed" = false);

ALTER TABLE "DocumentLineTaxSnapshot"
  ADD CONSTRAINT "DocumentLineTaxSnapshot_one_source_line_check"
  CHECK (num_nonnulls("invoiceLineItemId", "billLineItemId") = 1),
  ADD CONSTRAINT "DocumentLineTaxSnapshot_amounts_balance_check"
  CHECK ("netAmount" + "taxAmount" = "grossAmount"),
  ADD CONSTRAINT "DocumentLineTaxSnapshot_home_amounts_balance_check"
  CHECK ("netHome" + "taxHome" = "grossHome"),
  ADD CONSTRAINT "DocumentLineTaxSnapshot_evidence_object_check"
  CHECK (jsonb_typeof("jurisdictionEvidence") = 'object'),
  ADD CONSTRAINT "DocumentLineTaxSnapshot_currency_check"
  CHECK (length(btrim("documentCurrency")) = 3 AND length(btrim("homeCurrency")) = 3),
  ADD CONSTRAINT "DocumentLineTaxSnapshot_fx_check"
  CHECK (
    ("documentCurrency" = "homeCurrency" AND ("fxRate" IS NULL OR "fxRate" = 1)) OR
    ("documentCurrency" <> "homeCurrency" AND "fxRate" > 0 AND "fxRateSource" IS NOT NULL AND "fxRateDate" IS NOT NULL)
  );

ALTER TABLE "DocumentLineTaxComponent"
  ADD CONSTRAINT "DocumentLineTaxComponent_rate_check"
  CHECK ("rate" >= 0 AND "rate" <= 100.000),
  ADD CONSTRAINT "DocumentLineTaxComponent_recovery_check"
  CHECK ("recoveryBasisPoints" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "DocumentLineTaxComponent_amounts_balance_check"
  CHECK ("outputTax" + "recoverableTax" + "nonrecoverableTax" = "taxAmount"),
  ADD CONSTRAINT "DocumentLineTaxComponent_provincial_recovery_check"
  CHECK ("type" NOT IN ('pst', 'rst') OR ("recoveryBasisPoints" = 0 AND "recoverableTax" = 0));

-- These public-schema tables are server-only. RLS is defense in depth and the
-- Supabase Data API roles receive no privileges or permissive policies.
ALTER TABLE "CompanyTaxConfiguration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyTaxRegistration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaxCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaxCodeVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaxCodeComponent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentLineTaxSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentLineTaxComponent" ENABLE ROW LEVEL SECURITY;

DO $revoke_data_api$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE
      "CompanyTaxConfiguration", "CompanyTaxRegistration", "TaxCode",
      "TaxCodeVersion", "TaxCodeComponent", "DocumentLineTaxSnapshot",
      "DocumentLineTaxComponent"
    FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE
      "CompanyTaxConfiguration", "CompanyTaxRegistration", "TaxCode",
      "TaxCodeVersion", "TaxCodeComponent", "DocumentLineTaxSnapshot",
      "DocumentLineTaxComponent"
    FROM authenticated;
  END IF;
END
$revoke_data_api$;
