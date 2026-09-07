import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const migrationsDir = path.resolve('prisma/migrations');
const baselineName = '20260907000000_baseline';

const destructivePatterns = [
  { label: 'DROP TABLE', pattern: /\bDROP\s+TABLE\b/i },
  { label: 'DROP COLUMN', pattern: /\bDROP\s+COLUMN\b/i },
  { label: 'DROP SCHEMA', pattern: /\bDROP\s+SCHEMA\b/i },
  { label: 'DROP DATABASE', pattern: /\bDROP\s+DATABASE\b/i },
  { label: 'TRUNCATE', pattern: /\bTRUNCATE\b/i },
  { label: 'DELETE FROM', pattern: /\bDELETE\s+FROM\b/i },
];

let entries;
try {
  entries = await readdir(migrationsDir, { withFileTypes: true });
} catch (error) {
  console.error(`Migration directory is missing: ${migrationsDir}`);
  process.exit(1);
}

const migrationNames = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (!migrationNames.includes(baselineName)) {
  console.error(`Required Prisma baseline is missing: ${baselineName}`);
  process.exit(1);
}

const violations = [];
for (const migrationName of migrationNames) {
  const sqlPath = path.join(migrationsDir, migrationName, 'migration.sql');
  let sql;
  try {
    sql = await readFile(sqlPath, 'utf8');
  } catch {
    violations.push(`${migrationName}: migration.sql is missing or unreadable`);
    continue;
  }

  if (!sql.trim()) {
    violations.push(`${migrationName}: migration.sql is empty`);
    continue;
  }

  for (const { label, pattern } of destructivePatterns) {
    if (pattern.test(sql)) violations.push(`${migrationName}: contains ${label}`);
  }
}

if (violations.length > 0) {
  console.error('Potentially destructive migration SQL detected:');
  for (const violation of violations) console.error(`- ${violation}`);
  console.error('Use an additive migration, or complete a separately reviewed maintenance plan before changing this guard.');
  process.exit(1);
}

console.log(`Migration safety check passed (${migrationNames.length} migration${migrationNames.length === 1 ? '' : 's'}).`);
