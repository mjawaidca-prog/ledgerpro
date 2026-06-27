/**
 * CSV/OFX/PDF statement parser.
 * Produces normalized rows for the import wizard's Map step.
 */

export interface ParsedRow {
  date: string;
  description: string;
  amount: number; // signed: outflow -, inflow +
  balance?: number;
  raw: Record<string, string>;
}

export interface ParseResult {
  rows: ParsedRow[];
  headers: string[];
  errors: string[];
  fileType: 'csv' | 'ofx' | 'pdf' | 'unknown';
}

/**
 * Parse CSV content into normalized rows.
 * Handles common bank formats: Chase, Amex, generic.
 */
export function parseCSV(content: string): ParseResult {
  const errors: string[] = [];
  const lines = content.split('\n').filter((l) => l.trim());

  if (lines.length < 2) {
    return { rows: [], headers: [], errors: ['File has no data rows'], fileType: 'csv' };
  }

  // Detect delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  const headers = parseCSVLine(firstLine, delimiter);
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i], delimiter);
      if (values.length === 0 || values.every((v) => !v.trim())) continue;

      const raw: Record<string, string> = {};
      headers.forEach((h, idx) => {
        raw[h] = values[idx]?.trim() ?? '';
      });

      rows.push({
        date: '',
        description: '',
        amount: 0,
        raw,
      });
    } catch {
      errors.push(`Row ${i + 1}: could not parse`);
    }
  }

  return { rows, headers, errors, fileType: 'csv' };
}

/**
 * Parse OFX/QFX content into normalized rows.
 */
export function parseOFX(content: string): ParseResult {
  const errors: string[] = [];
  const rows: ParsedRow[] = [];

  // Extract STMTTRN blocks
  const txnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
  let match;

  while ((match = txnRegex.exec(content)) !== null) {
    try {
      const block = match[1];
      const getTag = (tag: string) => {
        const m = block.match(new RegExp(`<${tag}>([^<]*)`));
        return m ? m[1].trim() : '';
      };

      const dateStr = getTag('DTPOSTED') || getTag('DTUSER');
      let amount = parseFloat(getTag('TRNAMT'));

      // OFX uses TRNTYPE: DEBIT vs CREDIT
      const type = getTag('TRNTYPE');
      if (type === 'DEBIT' && amount > 0) amount = -amount;

      rows.push({
        date: dateStr.slice(0, 8), // YYYYMMDD
        description: getTag('NAME') || getTag('MEMO'),
        amount,
        raw: {
          Date: dateStr,
          Description: getTag('NAME') || getTag('MEMO'),
          Amount: String(amount),
          Type: type,
          Reference: getTag('CHECKNUM') || getTag('REFNUM'),
        },
      });
    } catch {
      errors.push('Failed to parse one transaction block');
    }
  }

  return {
    rows,
    headers: ['Date', 'Description', 'Amount', 'Type', 'Reference'],
    errors,
    fileType: 'ofx',
  };
}

/**
 * Parse PDF statement content.
 * Uses pdf-parse for text extraction, then heuristics to identify transaction rows.
 * Handles: single-column signed amounts, debit/credit columns, balance columns.
 * This is best-effort — low-confidence rows are flagged for human review.
 */
export async function parsePDF(buffer: Buffer, fileName: string): Promise<ParseResult> {
  const errors: string[] = [];

  try {
    // Dynamic import to avoid bundling pdf-parse into client builds
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    const text = data.text;

    if (!text || text.trim().length === 0) {
      return {
        rows: [],
        headers: [],
        errors: ['PDF appears to be empty or is a scanned image — OCR not supported'],
        fileType: 'pdf',
      };
    }

    const lines = text.split('\n').filter((l: string) => l.trim());
    const rows: ParsedRow[] = [];

    // Date patterns: MM/DD/YYYY, MM/DD, YYYY-MM-DD, DD MMM YYYY, DD MMM YY
    const dateLong = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{1,2},?\\s+\\d{2,4}';
    const dateNumeric = '\\d{1,2}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{2,4}|\\d{2,4}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{1,2}';
    const datePattern = new RegExp(`(${dateLong}|${dateNumeric})`, 'i');

    // Find ALL dollar amounts on a line: $1,234.56, -$500.00, (1,234.56), —$12.34, 1,234.56
    const amountRe = /(?:—|−|\-)?\s*\$?\s*\(?\s*(\-?[\d,]+\.\d{2})\s*\)?/g;

    // Words that indicate a balance column (not the transaction amount)
    const balanceWords = /balance|ending|closing/i;

    for (const line of lines) {
      const dateMatch = line.match(datePattern);
      const dateStr = dateMatch ? dateMatch[0] : '';

      // Find ALL amounts on this line
      const allAmounts: { value: number; index: number; raw: string }[] = [];
      let am;
      while ((am = amountRe.exec(line)) !== null) {
        const raw = am[0];
        let numStr = am[1].replace(/,/g, '');
        let num = parseFloat(numStr);
        // Negative indicators: leading -, —, −, or parentheses
        if (raw.match(/^[\s]*(—|−|\-)/) || (raw.includes('(') && raw.includes(')'))) {
          num = -Math.abs(num);
        }
        allAmounts.push({ value: num, index: am.index, raw });
      }

      // Reset regex
      amountRe.lastIndex = 0;

      if (!dateMatch && allAmounts.length === 0) continue;

      // Extract description: remove date, remove amounts, clean up
      let description = line;
      if (dateMatch) description = description.replace(dateMatch[0], '');
      // Remove amount strings from description
      const amts = Array.from(line.matchAll(amountRe));
      for (const a of amts.reverse()) {
        description = description.slice(0, a.index!) + description.slice(a.index! + a[0].length);
      }
      description = description.replace(/[^\w\s\-\&\#\/\.\@\#]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!description) description = 'Unknown';

      let amount = 0;
      let isLowConfidence = false;

      if (allAmounts.length === 1) {
        // One amount — use it directly
        amount = allAmounts[0].value;
      } else if (allAmounts.length >= 2) {
        // Multiple amounts — try debit/credit pair or amount+balance
        // Strategy: find two amounts that aren't near "balance" keywords
        const nonBalance = allAmounts.filter(a => {
          const context = line.substring(Math.max(0, a.index - 20), a.index);
          return !balanceWords.test(context);
        });

        if (nonBalance.length === 2) {
          // Likely a debit+credit pair: net = credit - debit (positive = inflow)
          // The larger index (further right) is usually the running balance
          // Pick the amount that's NOT the balance
          const sorted = nonBalance.sort((a, b) => b.index - a.index);
          // The last non-balance amount is usually the balance — take the other one(s)
          if (sorted.length >= 2) {
            // If one is positive and one negative, use the first non-balance
            const positives = nonBalance.filter(a => a.value > 0);
            const negatives = nonBalance.filter(a => a.value < 0);
            if (negatives.length === 1 && positives.length >= 1) {
              amount = negatives[0].value; // withdrawal
            } else if (negatives.length === 0 && positives.length >= 2) {
              // Two positives — first is usually transaction, second is balance
              amount = positives[0].value;
            } else {
              amount = nonBalance[0].value;
            }
          }
        } else if (nonBalance.length === 1) {
          amount = nonBalance[0].value;
        } else if (allAmounts.length >= 2) {
          // Fallback: use the first amount, flag as low confidence
          amount = allAmounts[0].value;
          isLowConfidence = true;
        }
      } else if (dateMatch) {
        // Has a date but no amounts — flag for review
        isLowConfidence = true;
      }

      rows.push({
        date: dateStr,
        description,
        amount,
        raw: {
          Date: dateStr,
          Description: description,
          Amount: String(amount),
          ...(isLowConfidence ? { lowConfidence: 'true' } : {}),
        },
      });
    }

    if (rows.length === 0 && lines.length > 10) {
      errors.push(
        'No transaction rows could be identified from the PDF. The format may not be supported. Try converting to CSV.'
      );
    }

    return {
      rows,
      headers: ['Date', 'Description', 'Amount'],
      errors,
      fileType: 'pdf',
    };
  } catch (err) {
    return {
      rows: [],
      headers: [],
      errors: ['Failed to parse PDF: ' + (err instanceof Error ? err.message : 'Unknown error')],
      fileType: 'pdf',
    };
  }
}

/**
 * Parse a file buffer (for server-side parsing).
 * Detects type from content and file name.
 */
export async function parseStatementFile(
  buffer: Buffer,
  fileName: string
): Promise<ParseResult> {
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.pdf')) {
    return parsePDF(buffer, fileName);
  }

  // Try text-based parsing
  const content = buffer.toString('utf-8');

  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return parseCSV(content);
  }

  if (lower.endsWith('.ofx') || lower.endsWith('.qfx')) {
    return parseOFX(content);
  }

  // Detect OFX headers
  if (content.includes('<OFX>') || content.includes('<OFX')) {
    return parseOFX(content);
  }

  // Default: try CSV
  return parseCSV(content);
}

/**
 * Parse statement content from a string (for client-side use).
 */
export function parseStatement(content: string, fileName: string): ParseResult {
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return parseCSV(content);
  }

  if (lower.endsWith('.ofx') || lower.endsWith('.qfx')) {
    return parseOFX(content);
  }

  if (lower.endsWith('.pdf')) {
    return {
      rows: [],
      headers: [],
      errors: [
        'PDF files must be processed server-side. Please use the upload endpoint instead.',
      ],
      fileType: 'pdf',
    };
  }

  if (content.includes('<OFX>') || content.includes('<OFX')) {
    return parseOFX(content);
  }

  return parseCSV(content);
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}
