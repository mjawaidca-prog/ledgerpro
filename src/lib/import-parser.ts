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

    // Common date patterns: MM/DD/YYYY, MM/DD, YYYY-MM-DD, DD MMM YYYY
    const datePattern =
      /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{2,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i;

    // Amount pattern: $1,234.56, -$500.00, (1,234.56)
    const amountPattern = /[\$]?\s*\(?(\-?[\d,]+\.\d{2})\)?/;

    for (const line of lines) {
      const dateMatch = line.match(datePattern);
      const amountMatches = line.match(amountPattern);

      if (dateMatch && amountMatches) {
        const dateStr = dateMatch[0];
        let amountStr = amountMatches[1].replace(/,/g, '');
        let amount = parseFloat(amountStr);

        // Handle parentheses notation: (1,234.56) = -1,234.56
        if (amountMatches[0].startsWith('(') && amountMatches[0].endsWith(')')) {
          amount = -amount;
        }

        // Remove date and amount to extract description
        let description = line
          .replace(dateMatch[0], '')
          .replace(amountMatches[0], '')
          .replace(/[^\w\s\-\&\#\/\.\@]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        rows.push({
          date: dateStr,
          description: description || 'Unknown',
          amount,
          raw: {
            Date: dateStr,
            Description: description,
            Amount: String(amount),
          },
        });
      } else if (dateMatch || amountMatches) {
        // Partial match — flag as low confidence
        const dateStr = dateMatch?.[0] ?? '';
        let amount = 0;
        if (amountMatches) {
          const cleaned = amountMatches[1].replace(/,/g, '');
          amount = parseFloat(cleaned);
        }
        rows.push({
          date: dateStr,
          description: line.substring(0, 200).trim(),
          amount,
          raw: {
            Date: dateStr,
            Description: line.substring(0, 200).trim(),
            Amount: String(amount),
            lowConfidence: 'true',
          },
        });
      }
    }

    if (rows.length === 0 && lines.length > 10) {
      errors.push(
        'No transaction rows could be identified from the PDF. The format may not be supported. Try converting to CSV.'
      );
    }

    return {
      rows,
      headers: ['Date', 'Description', 'Amount', 'lowConfidence'],
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
