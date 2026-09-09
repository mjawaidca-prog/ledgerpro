CREATE TYPE "TaxWorkpaperStatus" AS ENUM ('draft', 'prepared', 'reviewed', 'filed_recorded');

CREATE TABLE "TaxReturnWorkpaper" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL,
  "regime" "TaxRegime" NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" "TaxWorkpaperStatus" NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "inputs" JSONB NOT NULL,
  "snapshot" JSONB NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "preparedById" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "filingConfirmation" TEXT,
  "filedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxReturnWorkpaper_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaxReturnWorkpaper_period_check" CHECK ("periodStart" <= "periodEnd"),
  CONSTRAINT "TaxReturnWorkpaper_filing_check" CHECK (("status" <> 'filed_recorded') OR ("filingConfirmation" IS NOT NULL AND "filedAt" IS NOT NULL))
);
CREATE TABLE "TaxWorkpaperRemittance" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "workpaperId" TEXT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "regime" "TaxRegime" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "reference" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxWorkpaperRemittance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxReturnWorkpaper_companyId_registrationId_periodStart_periodEnd_key" ON "TaxReturnWorkpaper"("companyId","registrationId","periodStart","periodEnd");
CREATE UNIQUE INDEX "TaxReturnWorkpaper_companyId_id_key" ON "TaxReturnWorkpaper"("companyId","id");
CREATE INDEX "TaxReturnWorkpaper_companyId_regime_periodStart_periodEnd_idx" ON "TaxReturnWorkpaper"("companyId","regime","periodStart","periodEnd");
CREATE INDEX "TaxReturnWorkpaper_registrationId_idx" ON "TaxReturnWorkpaper"("registrationId");
CREATE INDEX "TaxReturnWorkpaper_createdById_idx" ON "TaxReturnWorkpaper"("createdById");
CREATE INDEX "TaxReturnWorkpaper_preparedById_idx" ON "TaxReturnWorkpaper"("preparedById");
CREATE INDEX "TaxReturnWorkpaper_reviewedById_idx" ON "TaxReturnWorkpaper"("reviewedById");
CREATE UNIQUE INDEX "TaxWorkpaperRemittance_companyId_journalEntryId_key" ON "TaxWorkpaperRemittance"("companyId","journalEntryId");
CREATE INDEX "TaxWorkpaperRemittance_companyId_workpaperId_idx" ON "TaxWorkpaperRemittance"("companyId","workpaperId");
CREATE INDEX "TaxWorkpaperRemittance_createdById_idx" ON "TaxWorkpaperRemittance"("createdById");
ALTER TABLE "TaxReturnWorkpaper" ADD CONSTRAINT "TaxReturnWorkpaper_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxReturnWorkpaper" ADD CONSTRAINT "TaxReturnWorkpaper_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "CompanyTaxRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxReturnWorkpaper" ADD CONSTRAINT "TaxReturnWorkpaper_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxReturnWorkpaper" ADD CONSTRAINT "TaxReturnWorkpaper_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaxReturnWorkpaper" ADD CONSTRAINT "TaxReturnWorkpaper_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaxWorkpaperRemittance" ADD CONSTRAINT "TaxWorkpaperRemittance_companyId_workpaperId_fkey" FOREIGN KEY ("companyId","workpaperId") REFERENCES "TaxReturnWorkpaper"("companyId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxWorkpaperRemittance" ADD CONSTRAINT "TaxWorkpaperRemittance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxWorkpaperRemittance" ADD CONSTRAINT "TaxWorkpaperRemittance_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxWorkpaperRemittance" ADD CONSTRAINT "TaxWorkpaperRemittance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxReturnWorkpaper" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaxWorkpaperRemittance" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "TaxReturnWorkpaper", "TaxWorkpaperRemittance" FROM anon, authenticated;
