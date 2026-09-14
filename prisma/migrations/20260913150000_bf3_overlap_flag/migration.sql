-- BF-3: overlap flag on feed links. Ambiguous statement-overlap matches
-- are created but held for review; high-confidence matches dedupe. Additive.

-- AlterTable
ALTER TABLE "BankFeedTransaction" ADD COLUMN     "overlapCandidate" BOOLEAN NOT NULL DEFAULT false;

