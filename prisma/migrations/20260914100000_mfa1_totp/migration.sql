-- MFA-1: TOTP fields on users. The secret is stored encrypted; backup
-- codes are stored as hashes. Off by default for every user. Additive.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN     "mfaSecretEncrypted" TEXT;

