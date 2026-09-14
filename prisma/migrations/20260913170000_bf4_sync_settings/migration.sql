-- BF-4: per-connection sync settings. Additive only; defaults match
-- the initial scope (daily sync, rules on, failure notifications on).

-- AlterTable
ALTER TABLE "BankConnection" ADD COLUMN     "autoCategorize" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cadence" TEXT NOT NULL DEFAULT 'daily',
ADD COLUMN     "notifyOnFailure" BOOLEAN NOT NULL DEFAULT true;

