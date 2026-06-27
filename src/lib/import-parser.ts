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
    let pdfParse: any;
    try {
      pdfParse = (await import('pdf-parse')).default;
    } catch {
      const mod = await import('pdf-parse');
      pdfParse = (mod as any).default || mod;
    }
    const data = await pdfParse(buffer);
    const text: string = data.text || '';

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

    // Date patterns: "Thu, Dec. 31, 2024", "Dec 31, 2024", "2024-12-31", "12/31/2024"
    const dateLong = '(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{2,4}';
    const dateNumeric = '\\d{1,2}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{2,4}|\\d{2,4}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{1,2}';
    const dateRe = new RegExp(`(${dateLong}|${dateNumeric})`, 'i');

    // Money amounts: signed numbers like +$1,234.56, -$500.00, $3,370.82, (1,234.56)
    const moneyRe = /[+\-]?\s*\$?\s*\(?\s*([\d,]+\.\d{2})\s*\)?/g;

    const skipRe = /^(page\s+\d+|statement period|opening|closing|total\s+(deposits|withdrawals)|continued|account number|customer service|document delivery|current balance|available balance|select account|filters|transactions|print|balance details|no holds)/i;

    // ── Multi-line row builder ──
    // Scotia/RBC/TD format: date line → description line(s) → amounts line
    interface PendingRow {
      date: string;
      descLines: string[];
    }
    let pending: PendingRow | null = null;

    function flushRow(amountLine: string, amounts: { raw: string; value: number }[]) {
      if (!pending) return null;

      // Pick transaction amount: negative = withdrawal, positive = deposit
      // If exactly one negative and one positive, negative is the transaction, positive is balance
      let finalAmount = 0;
      if (amounts.length === 1) {
        finalAmount = amounts[0].value;
      } else if (amounts.length >= 2) {
        const negs = amounts.filter(a => a.value < -0.005);
        const poss = amounts.filter(a => a.value > 0.005);
        if (negs.length === 1) {
          finalAmount = negs[0].value; // withdrawal
        } else if (poss.length >= 2) {
          // Multiple positives: first non-zero is transaction, last is balance
          finalAmount = poss[0].value;
        } else {
          finalAmount = amounts[0].value;
        }
      }

      const desc = pending.descLines.join(' ').replace(/\s+/g, ' ').trim() || 'Transaction';
      const row = {
        date: pending.date,
        description: desc,
        amount: finalAmount,
        raw: {
          Date: pending.date,
          Description: desc,
          Amount: String(finalAmount),
        },
      };

      pending = null;
      return row;
    }

    for (const line of allLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 3) continue;
      if (skipRe.test(trimmed)) continue;

      // Check for date
      const dateMatch = trimmed.match(dateRe);
      const foundDate = dateMatch ? dateMatch[0] : '';

      // Find amounts on this line
      const amounts: { raw: string; value: number }[] = [];
      let m;
      while ((m = moneyRe.exec(trimmed)) !== null) {
        let val = parseFloat(m[1].replace(/,/g, ''));
        // Detect sign from the full match (e.g., "-$20.00", "+$220.50")
        const fullMatch = m[0];
        if (/^[\s]*(—|−|\-)/.test(fullMatch) || fullMatch.includes('(')) {
          val = -Math.abs(val);
        } else if (fullMatch.includes('+')) {
          val = Math.abs(val); // explicit positive
        }
        amounts.push({ raw: m[0], value: val });
      }
      moneyRe.lastIndex = 0;

      // If this line has a date, flush previous pending row (if any amounts were pending)
      if (foundDate && pending && amounts.length > 0) {
        const row = flushRow(trimmed, amounts);
        if (row) rows.push(row);
        pending = null;
      }

      // Start new pending row when we see a date
      if (foundDate) {
        // Flush any existing pending (without amounts — might be orphan)
        pending = { date: foundDate, descLines: [] };

        // If this date line also has amounts, resolve immediately
        // Extract remaining text after the date as description
        if (amounts.length > 0) {
          let descText = trimmed.replace(dateMatch![0], '');
          for (const a of amounts) {
            descText = descText.replace(a.raw, '');
          }
          descText = descText.replace(/[^\w\s\-\&\#\/\.\@]/g, ' ').replace(/\s+/g, ' ').trim();
          if (descText) pending.descLines.push(descText);
          const row = flushRow(trimmed, amounts);
          if (row) rows.push(row);
          pending = null;
        }
        continue;
      }

      // Line without date: if it has amounts, it completes the pending row
      if (amounts.length > 0 && pending) {
        const row = flushRow(trimmed, amounts);
        if (row) rows.push(row);
        continue;
      }

      // Line without date and without amounts: collect as description
      if (amounts.length === 0 && pending && !/date|description|withdrawal|deposit|balance/i.test(trimmed)) {
        const cleaned = trimmed.replace(/[^\w\s\-\&\#\/\.\@\#]/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleaned && cleaned.length > 2) {
          pending.descLines.push(cleaned);
        }
      }
    }

    // Flush any remaining pending row
    if (pending && pending.descLines.length > 0) {
      rows.push({
        date: pending.date,
        description: pending.descLines.join(' ').trim(),
        amount: 0,
        raw: {
          Date: pending.date,
          Description: pending.descLines.join(' ').trim(),
          Amount: '0',
          lowConfidence: 'true',
        },
      });
    }

    if (rows.length === 0 && allLines.length > 10) {
      errors.push('No transactions found. The PDF format may not be supported. Try converting to CSV first.');
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
