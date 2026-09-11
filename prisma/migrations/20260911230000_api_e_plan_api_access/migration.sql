-- API-E: plan API-access entitlement. Additive column, then enable the
-- flag for Pro and Enterprise per the launch policy (production API access
-- on Pro and Enterprise; sandbox access granted separately).

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "apiAccess" BOOLEAN NOT NULL DEFAULT false;


-- Enable production API access for Pro and Enterprise plans.
UPDATE "Plan" SET "apiAccess" = true WHERE "id" IN ('plan_pro', 'plan_enterprise');
