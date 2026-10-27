/**
 * CC-1: Seed the first PlatformAdmin (owner) — TypeScript alternative to
 * scripts/seed-platform-admin.sql. Idempotent (upsert by userId).
 * Looks the user up BY EMAIL (PLATFORM_OWNER_EMAIL, default the product
 * owner's LedgerPro login); never hardcodes a user id.
 *
 * Run locally against a dev database only, unless the owner explicitly
 * directs a production run after the migration is deployed:
 *   npx tsx scripts/seed-platform-admin.ts
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const EMAIL = process.env.PLATFORM_OWNER_EMAIL || 'mjawaid.ca@gmail.com';

async function main() {
  const user = await db.user.findUnique({ where: { email: EMAIL }, select: { id: true, email: true, mfaEnabled: true } });
  if (!user) {
    console.error(`No user found with email ${EMAIL} — nothing seeded.`);
    process.exit(1);
  }
  const admin = await (db as any).platformAdmin.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, role: 'owner' },
  });
  console.log(`PlatformAdmin ready: user=${user.email} role=${admin.role} mfaEnabled=${user.mfaEnabled}`);
  if (!user.mfaEnabled) console.log('NOTE: this admin must enable two-factor (Settings -> Security) before the Control Center will open.');
}

main().finally(() => db.$disconnect());
