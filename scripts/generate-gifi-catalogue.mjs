/**
 * Regenerate src/lib/gifi-catalogue.ts from Nexvar Tax's verified GIFI
 * catalogue CSV (T1-gifi-hierarchy.verified.csv — 769 codes verified
 * against CRA guide RC4088 Rev. 23, Appendix A).
 *
 * Usage:
 *   node scripts/generate-gifi-catalogue.mjs [path-to-csv]
 *
 * The CSV lives outside this repo (it is Nexvar Tax's catalogue
 * deliverable); pass its path explicitly. The generated file is the
 * committed artifact — this script is only needed when CRA's list or
 * the verified catalogue changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/generate-gifi-catalogue.mjs <path-to-T1-gifi-hierarchy.verified.csv>');
  process.exit(1);
}

// Minimal CSV reader — the catalogue uses quoted fields with embedded
// commas but no embedded newlines or escaped quotes beyond doubling.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const [header, ...data] = parseCsv(readFileSync(csvPath, 'utf8'));
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const entries = data
  .filter((r) => r[col.gifi_code])
  .map((r) => ({
    code: r[col.gifi_code],
    description: r[col.description],
    statement: r[col.statement],
    section: r[col.section],
    subsection: r[col.subsection] || null,
    codeType: r[col.code_type],
    parentCode: r[col.parent_code] || null,
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

if (entries.length !== 769) {
  console.error(`Expected 769 catalogue entries, got ${entries.length} — refusing to write.`);
  process.exit(1);
}

const headerComment = `/**
 * CRA GIFI catalogue — static data for the chart-of-accounts GIFI picker
 * and API validation.
 *
 * GENERATED FILE — do not hand-edit. Source of truth: Nexvar Tax's
 * verified catalogue \`T1-gifi-hierarchy.verified.csv\` (769 codes),
 * verified line-by-line against CRA guide RC4088 (Rev. 23, Appendix A).
 * Regenerate with: node scripts/generate-gifi-catalogue.mjs <path-to-csv>
 *
 * Fields per entry: code, description (official CRA wording), statement
 * ("Balance sheet" | "Income statement"), section, subsection,
 * codeType ("detail" | "generic" | "total" | "header"), parentCode.
 * Only detail/generic codes are assignable to an account — see
 * \`isPickableGifiCode\` in src/lib/gifi.ts (total/header codes are
 * computed by the tax software, and the retained-earnings continuity
 * codes 3600/3680/3849 are computed there too).
 */

export interface GifiCatalogueEntry {
  code: string;
  description: string;
  statement: 'Balance sheet' | 'Income statement';
  section: string;
  subsection: string | null;
  codeType: 'detail' | 'generic' | 'total' | 'header';
  parentCode: string | null;
}

export const GIFI_CATALOGUE: readonly GifiCatalogueEntry[] = [
`;

const body = entries.map((e) => `  ${JSON.stringify(e)},`).join('\n');
const out = `${headerComment}${body}\n];\n`;

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'gifi-catalogue.ts');
writeFileSync(dest, out);
console.log(`Wrote ${entries.length} entries to ${dest}`);
