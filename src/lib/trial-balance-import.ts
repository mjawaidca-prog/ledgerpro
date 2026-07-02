/**
 * Opening trial balance import — for migrating a company's books from QBO
 * or another accounting system. Distinct from the bank-transaction CSV/OFX
 * import pipeline: this parses a trial balance (one row per GL account,
 * with a debit and/or credit balance) rather than transaction line items.
 *
 * Expected columns (case-insensitive, order-independent): an account code
 * column ("Account Number" / "Code" / "Account"), a name column
 * ("Description" / "Account Name" / "Name"), and either a Debit/Credit pair
 * or a single signed Amount column.
 */

export interface ParsedTBRow {
  code: string;
  name: string;
  debit: number;
  credit: number;
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((c) => c.trim());
}

function detectDelimiter(headerLine: string): string {
  return (headerLine.match(/;/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0) ? ';' : ',';
}

function parseAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function parseTrialBalanceCSV(content: string): ParsedTBRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('File must have a header row and at least one data row');
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCSVLine(lines[0], delimiter).map((h) => h.toLowerCase().trim());

  const findCol = (candidates: string[]) => headers.findIndex((h) => candidates.some((c) => h === c || h.includes(c)));

  const codeIdx = findCol(['account number', 'account code', 'code', 'account #', 'acct #', 'account']);
  const nameIdx = findCol(['description', 'account name', 'account description', 'name']);
  const debitIdx = findCol(['debit']);
  const creditIdx = findCol(['credit']);
  const amountIdx = findCol(['amount', 'balance']);

  if (codeIdx === -1) throw new Error('Could not find an account number/code column');
  if (nameIdx === -1) throw new Error('Could not find an account name/description column');
  if (debitIdx === -1 && creditIdx === -1 && amountIdx === -1) {
    throw new Error('Could not find Debit/Credit columns or an Amount column');
  }

  const rows: ParsedTBRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i], delimiter);
    const code = cols[codeIdx]?.trim();
    const name = cols[nameIdx]?.trim();
    if (!code || !name) continue;

    let debit = 0;
    let credit = 0;
    if (debitIdx !== -1 || creditIdx !== -1) {
      debit = parseAmount(cols[debitIdx]);
      credit = parseAmount(cols[creditIdx]);
    } else {
      const amount = parseAmount(cols[amountIdx]);
      if (amount >= 0) debit = amount;
      else credit = Math.abs(amount);
    }

    if (debit === 0 && credit === 0) continue; // skip zero-balance rows
    rows.push({ code, name, debit, credit });
  }

  return rows;
}
