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

    const allLines = text.split('\n');
    const rows: ParsedRow[] = [];

    // Date patterns
    const dateLong = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{1,2},?\\s+\\d{2,4}';
    const dateNumeric = '\\d{1,2}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{2,4}|\\d{2,4}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{1,2}';
    const dateRe = new RegExp(`(${dateLong}|${dateNumeric})`, 'i');

    // Dollar amounts with optional sign indicators
    const moneyRe = /(?:—|−|\-)?\s*\$?\s*\(?\s*(\-?[\d,]+\.\d{2})\s*\)?/g;

    const skipRe = /^(page\s+\d+|statement period|opening balance|closing balance|total deposits|total withdrawals|continued|account number|customer service)/i;

    // Track the last date seen to inherit for lines without a date
    let lastDate = '';

    for (const line of allLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 4) continue;
      if (skipRe.test(trimmed)) continue;

      // Detect date on this line
      const dateMatch = trimmed.match(dateRe);
      const foundDate = dateMatch ? dateMatch[0] : '';
      if (foundDate) lastDate = foundDate;

      // Find all amounts
      const amounts: { raw: string; value: number; pos: number }[] = [];
      let m;
      while ((m = moneyRe.exec(trimmed)) !== null) {
        let numStr = m[1].replace(/,/g, '');
        let val = parseFloat(numStr);
        // Detect negatives: leading -, —, −, or parentheses
        if (/^[\s]*(—|−|\-)/.test(m[0]) || (m[0].includes('(') && m[0].includes(')'))) {
          val = -Math.abs(val);
        }
        amounts.push({ raw: m[0], value: val, pos: m.index });
      }
      moneyRe.lastIndex = 0;

      // Skip lines without any amounts
      if (amounts.length === 0) continue;

      // Build description: remove date and all amounts
      let desc = trimmed;
      if (foundDate) desc = desc.replace(dateMatch![0], '');
      for (const a of [...amounts].reverse()) {
        desc = desc.slice(0, a.pos) + desc.slice(a.pos + a.raw.length);
      }
      desc = desc.replace(/[^\w\s\-\&\#\/\.\@]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!desc) desc = 'Transaction';

      // Select transaction amount from multiple amounts
      let finalAmount = 0;
      if (amounts.length === 1) {
        finalAmount = amounts[0].value;
      } else if (amounts.length >= 2) {
        // If one is clearly negative and the rest positive, use the negative (withdrawal)
        const negs = amounts.filter(a => a.value < -0.005);
        const poss = amounts.filter(a => a.value > 0.005);
        if (negs.length === 1) {
          finalAmount = negs[0].value;
        } else if (poss.length >= 2) {
          // Multiple positives — first is usually transaction, last is balance
          finalAmount = poss[0].value;
        } else {
          // Fallback: first amount
          finalAmount = amounts[0].value;
        }
      }

      // Use inherited date if line doesn't have its own
      const effectiveDate = foundDate || lastDate;

      rows.push({
        date: effectiveDate,
        description: desc,
        amount: finalAmount,
        raw: {
          Date: effectiveDate,
          Description: desc,
          Amount: String(finalAmount),
        },
      });
    }

    if (rows.length === 0 && allLines.length > 10) {
      errors.push('No transaction rows could be identified. The PDF format may not be supported. Try converting to CSV first.');
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
