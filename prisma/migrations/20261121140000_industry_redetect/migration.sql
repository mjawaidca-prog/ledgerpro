-- Industry re-detection (LedgerPro improvement plan, Phase 2 item 5):
-- after a company's first bank imports, LedgerPro scores the company's
-- real activity against the industry packs (src/lib/industry-detect.ts)
-- and may SUGGEST a different pack on the dashboard — offered, never
-- auto-applied. This column remembers the pack key of a suggestion the
-- user dismissed, so the same suggestion never nags twice; a different
-- detected industry still surfaces. NULL = nothing dismissed, which is
-- every existing row's meaning, unchanged.
-- Plain TEXT (not an enum), matching Company.industry; the service
-- validates values against the known pack keys.
-- Additive only; every existing row keeps its meaning bit-for-bit.
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that selects this column.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "industrySuggestionDismissedKey" TEXT;
