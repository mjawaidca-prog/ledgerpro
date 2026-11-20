-- Industry chart templates (LedgerPro improvement plan, Phase 1 item 2):
-- the onboarding Industry dropdown was a dead field — held in React
-- state, never sent, never stored. This column stores the industry the
-- owner picked (a pack key from src/lib/industry-coa.ts, e.g.
-- 'construction'); chart provisioning layers that industry's account
-- pack on top of the CORE template at company creation / onboarding.
-- NULL means no industry chosen — the company gets CORE only, exactly
-- as before this migration. Plain TEXT (not an enum) so new packs can
-- ship without a schema change; the API validates against the known
-- pack keys.
-- Additive only; every existing row keeps its meaning bit-for-bit
-- (industry NULL = today's behaviour).
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that selects this column.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "industry" TEXT;
