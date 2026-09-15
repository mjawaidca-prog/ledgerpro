import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.production.real.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}
async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const user = await db.user.findUnique({ where: { email: 'mjawaid.ca@gmail.com' }, include: { memberships: true } });
  if (!user) { console.log('user not found'); return; }
  for (const m of user.memberships) {
    const sub = await db.subscription.findFirst({
      where: { companyId: m.companyId },
      orderBy: { createdAt: 'desc' },
      include: { plan: { select: { name: true, apiAccess: true, bankFeeds: true } } },
    });
    const co = await db.company.findUnique({ where: { id: m.companyId }, select: { name: true, apiAccessEnabled: true } });
    console.log('company=' + co?.name + ' apiAccessEnabled=' + co?.apiAccessEnabled);
    console.log('  subscription=' + (sub ? sub.status + ' plan=' + sub.plan.name + ' apiAccess=' + sub.plan.apiAccess : 'NONE'));
  }
  await db.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
