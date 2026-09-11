import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const envRaw = readFileSync('.env.staging.local', 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}
const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient();
const mode = process.argv[2];
if (mode === 'create-write-key') {
  const secret = randomBytes(16).toString('hex');
  const token = 'lp_live_' + secret;
  await db.apiKey.create({
    data: {
      companyId: 'p1f-staging-ontario',
      name: 'API-C staging rehearsal (write)',
      keyPrefix: 'lp_live_' + secret.slice(0, 8),
      keyHash: createHash('sha256').update(token).digest('hex'),
      permissions: ['read', 'write_draft', 'write_posting'],
    },
  });
  const p = join(tmpdir(), 'lp-api-c-write-key.txt');
  writeFileSync(p, token);
  console.log('WRITE_KEY_FILE=' + p);
} else if (mode === 'list-tax-versions') {
  const codes = await db.taxCode.findMany({
    where: { companyId: 'p1f-staging-ontario', active: true },
    include: { versions: { where: { reviewStatus: 'approved' }, orderBy: { version: 'asc' }, include: { components: true } } },
  });
  for (const tc of codes) {
    for (const v of tc.versions) {
      console.log(`code=${tc.code} versionId=${v.id} v=${v.version} treatment=${v.treatment} jurisdiction=${v.jurisdiction} components=${v.components.map(c => `${c.type}@${c.rate}`).join('|')}`);
    }
  }
} else if (mode === 'list-accounts') {
  const accts = await db.chartOfAccount.findMany({ where: { companyId: 'p1f-staging-ontario', active: true }, select: { id: true, code: true, name: true, type: true }, orderBy: { code: 'asc' } });
  console.log(JSON.stringify(accts));
} else if (mode === 'list-customers') {
  const cs = await db.contact.findMany({ where: { companyId: 'p1f-staging-ontario', type: 'customer' }, select: { id: true, name: true, currency: true }, take: 5 });
  console.log(JSON.stringify(cs));
}
await db.$disconnect();

const { PrismaClient: P2 } = await import('@prisma/client');
