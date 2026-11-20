-- GIFI-at-creation (LedgerPro improvement plan, Phase 1 item 1):
-- no account saves without a GIFI *decision*. A code is one decision;
-- this column records the other one — a deliberate "leave unmapped"
-- choice made with eyes open in the account form. It separates
-- "unmapped on purpose" (exports unmapped, excluded from the
-- readiness worklist because the decision is made) from "not yet
-- decided" (gifiCode NULL + this false), which is what the worklist
-- exists to clear.
-- Additive only; DEFAULT false preserves every existing row's meaning
-- bit-for-bit (all pre-existing uncoded accounts stay "undecided").
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that selects this column.

-- AlterTable
ALTER TABLE "ChartOfAccount" ADD COLUMN "gifiUnmappedByChoice" BOOLEAN NOT NULL DEFAULT false;
