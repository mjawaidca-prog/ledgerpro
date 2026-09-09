DROP INDEX "TaxReturnWorkpaper_companyId_registrationId_periodStart_periodEnd_key";
CREATE UNIQUE INDEX "TaxReturnWorkpaper_companyId_registrationId_periodStart_periodEnd_version_key" ON "TaxReturnWorkpaper"("companyId","registrationId","periodStart","periodEnd","version");
