DROP INDEX "TaxReturnWorkpaper_companyId_registrationId_periodStart_periodEnd_key";
CREATE UNIQUE INDEX "TaxWorkpaper_period_version_key" ON "TaxReturnWorkpaper"("companyId","registrationId","periodStart","periodEnd","version");
