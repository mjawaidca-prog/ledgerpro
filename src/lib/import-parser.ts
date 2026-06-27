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

    const rawLines = text.split('\n');
    const rows: ParsedRow[] = [];

    // Date patterns: MM/DD/YYYY, MM/DD, YYYY-MM-DD, DD MMM YYYY, DD MMM YY
    const dateLong = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+\\d{1,2},?\\s+\\d{2,4}';
    const dateNumeric = '\\d{1,2}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{2,4}|\\d{2,4}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{1,2}';
    const datePattern = new RegExp(`(${dateLong}|${dateNumeric})`, 'i');

    // Find ALL dollar amounts on a line: $1,234.56, -$500.00, (1,234.56), —$12.34, 1,234.56
    const amountRe = /(?:—|−|\-)?\s*\$?\s*\(?\s*(\-?[\d,]+\.\d{2})\s*\)?/g;

    // Words that indicate non-transaction lines to skip
    const skipWords = /page|statement|opening balance|balance brought|total carried|continued|subtotal|from date|to date|period ending|account summary/i;
    // Words that suggest a number is a balance, not transaction amount
    const balanceWords = /balance|ending|closing|available/i;

    // ── Multi-pass: PDF tables split columns across lines ──
    // Pass 1: collect candidates with amounts, inheriting dates from prior lines
    interface Candidate {
      dateStr: string;
      description: string;
      amounts: { value: number; index: number; raw: string }[];
    }
    const candidates: Candidate[] = [];
    let lastDate = '';

    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (skipWords.test(trimmed)) continue;

      // Track any date found on this line
      const dateMatch = trimmed.match(datePattern);
      const thisDate = dateMatch ? dateMatch[0] : '';
      if (thisDate) lastDate = thisDate;

      // Find all amounts
      const allAmounts: { value: number; index: number; raw: string }[] = [];
      let am;
      while ((am = amountRe.exec(trimmed)) !== null) {
        const raw = am[0];
        let numStr = am[1].replace(/,/g, '');
        let num = parseFloat(numStr);
        if (raw.match(/^[\s]*(—|−|\-)/) || (raw.includes('(') && raw.includes(')'))) {
          num = -Math.abs(num);
        }
        allAmounts.push({ value: num, index: am.index, raw });
      }
      amountRe.lastIndex = 0;

      if (allAmounts.length === 0) continue;

      // Build description
      let desc = trimmed;
      if (thisDate) desc = desc.replace(dateMatch![0], '');
      for (const a of allAmounts.slice().reverse()) {
        desc = desc.slice(0, a.index) + desc.slice(a.index + a.raw.length);
      }
      desc = desc.replace(/[^\w\s\-\&\#\/\.\@\#\%\*\(\)]/g, ' ')
        .replace(/\s+/g, ' ').trim();
      if (!desc) desc = 'Transaction';

      candidates.push({
        dateStr: thisDate || lastDate,
        description: desc,
        amounts: allAmounts,
      });
    }

    // ── Pass 2: resolve amount from candidates, filter noise ──
    for (const c of candidates) {
      let amount = 0;
      let isLowConfidence = false;

      if (c.amounts.length === 1) {
        amount = c.amounts[0].value;
      } else {
        // Use position: rightmost amount is usually the running balance
        const byIndex = c.amounts.slice().sort((a, b) => b.index - a.index);
        if (byIndex.length >= 2) {
          // The rightmost amount is often the running balance
          const rightmost = byIndex[0];
          const others = byIndex.slice(1).filter(a => Math.abs(a.value - rightmost.value) > 0.05);
          if (others.length === 1) {
            amount = others[0].value;
          } else if (others.length >= 2) {
            // Pick the one that's negative (withdrawal) or first positive
            const neg = others.find(a => a.value < 0);
            amount = neg ? neg.value : others[0].value;
          } else {
            amount = byIndex[0].value;
            isLowConfidence = true;
          }
        }
      }

      // Skip $0.00 lines that look like headers
      if (Math.abs(amount) < 0.005 && /from|to|period|statement|date/i.test(c.description)) continue;

      if (!c.dateStr) isLowConfidence = true;

      rows.push({
        date: c.dateStr || '',
        description: c.description,
        amount,
        raw: {
          Date: c.dateStr || '',
          Description: c.description,
          Amount: String(amount),
          ...(isLowConfidence ? { lowConfidence: 'true' } : {}),
        },
      });
    }

    if (rows.length === 0 && rawLines.length > 10) {
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
