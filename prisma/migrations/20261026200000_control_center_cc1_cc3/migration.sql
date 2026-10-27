-- CC-1/CC-3: LedgerPro Control Center foundation. Adds PlatformAdmin,
-- PlatformAuditEvent and SubscriberFollowUp plus two enums. Purely additive:
-- no existing table, column or row is changed. Production applies this via
-- `prisma migrate deploy` in scripts/vercel-build.sh (production builds only).

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('owner');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('new', 'reviewing', 'contacted', 'follow_up_due', 'converted', 'closed');

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL DEFAULT 'owner',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditEvent" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "companyId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriberFollowUp" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'new',
    "assignedAdminId" TEXT,
    "note" TEXT,
    "history" JSONB,
    "nextFollowUpAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "contactOptOut" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriberFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_userId_key" ON "PlatformAdmin"("userId");

-- CreateIndex
CREATE INDEX "PlatformAdmin_role_idx" ON "PlatformAdmin"("role");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_adminUserId_createdAt_idx" ON "PlatformAuditEvent"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_companyId_createdAt_idx" ON "PlatformAuditEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_action_createdAt_idx" ON "PlatformAuditEvent"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriberFollowUp_companyId_key" ON "SubscriberFollowUp"("companyId");

-- CreateIndex
CREATE INDEX "SubscriberFollowUp_status_nextFollowUpAt_idx" ON "SubscriberFollowUp"("status", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "SubscriberFollowUp_assignedAdminId_idx" ON "SubscriberFollowUp"("assignedAdminId");

-- AddForeignKey
ALTER TABLE "PlatformAdmin" ADD CONSTRAINT "PlatformAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAdmin" ADD CONSTRAINT "PlatformAdmin_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriberFollowUp" ADD CONSTRAINT "SubscriberFollowUp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriberFollowUp" ADD CONSTRAINT "SubscriberFollowUp_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriberFollowUp" ADD CONSTRAINT "SubscriberFollowUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
