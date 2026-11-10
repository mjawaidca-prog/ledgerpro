-- Manual first fiscal year-end: a corporation's first fiscal year is
-- often shorter or longer than 12 months (e.g. incorporated Jul 28, 2026
-- with a chosen Jul 31 year-end → first year ends Jul 31, 2027). Until
-- now the year-end was always derived as fiscalYearStart + 1 year − 1 day
-- and could not be chosen.
-- The new nullable column stores the explicit last day of the FIRST
-- fiscal year. NULL (every existing row) keeps the derived behaviour
-- bit-for-bit; later years anchor on the day after this date.
-- Additive only; no existing table, column, or row is touched.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that selects this column.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "firstFiscalYearEnd" TIMESTAMP(3);
