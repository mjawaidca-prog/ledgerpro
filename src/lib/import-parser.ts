import { format, isValid, parse } from 'date-fns';
import { inflateSync } from 'node:zlib';

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

export interface ColumnMeta {
  name: string;
  /** 'signed' = has both +/- values, 'positive-only' = all >= 0, 'negative-only' = all <= 0, 'balance' = running-balance column */
  kind: 'signed' | 'positive-only' | 'negative-only' | 'balance';
  /** Number of rows where this column has a non-zero value */
  populatedCount: number;
  /** Average absolute magnitude of values in this column */
  avgMagnitude: number;
  /** Sample values for display (up to 3) */
  samples: number[];
}

export interface ParseResult {
  rows: ParsedRow[];
  headers: string[];
  errors: string[];
  fileType: 'csv' | 'ofx' | 'pdf' | 'unknown';
  /** Per-column metadata for PDF amount columns — aids the wizard's auto-detection */
  columnMeta?: ColumnMeta[];
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return format(candidate, 'yyyy-MM-dd');
}

function expandYear(yearText: string): number {
  if (yearText.length === 2) {
    const value = Number(yearText);
    return value >= 70 ? 1900 + value : 2000 + value;
  }

  return Number(yearText);
}

function stripDateNoise(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+/i, '')
    .replace(/(\d{1,2})(st|nd|rd|th)\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMonthPeriods(value: string): string {
  return value.replace(
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\./gi,
    (match) => match.slice(0, -1)
  );
}

function parseNumericDate(value: string): string | null {
  let match = value.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:[ T].*)?$/);
  if (match) {
    return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = value.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[ T].*)?$/);
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = expandYear(match[3]);

  let month = first;
  let day = second;
  if (first > 12 && second <= 12) {
    month = second;
    day = first;
  } else if (second > 12 && first <= 12) {
    month = first;
    day = second;
  }

  return toIsoDate(year, month, day);
}

function parseNamedDate(value: string): string | null {
  const formats = [
    'MMM d yyyy',
    'MMM d, yyyy',
    'MMM d yy',
    'MMM d, yy',
    'MMMM d yyyy',
    'MMMM d, yyyy',
    'MMMM d yy',
    'MMMM d, yy',
    'd MMM yyyy',
    'd MMM, yyyy',
    'd MMM yy',
    'd MMM, yy',
    'd MMMM yyyy',
    'd MMMM, yyyy',
    'd MMMM yy',
    'd MMMM, yy',
  ];

  for (const fmt of formats) {
    const parsed = parse(value, fmt, new Date());
    if (isValid(parsed)) {
      return format(parsed, 'yyyy-MM-dd');
    }
  }

  return null;
}

/**
 * Convert common bank statement date strings into an ISO date.
 * Returns null when the input cannot be interpreted safely.
 */
export function normalizeStatementDate(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const candidates = new Set<string>([
    trimmed,
    stripDateNoise(trimmed),
    stripMonthPeriods(trimmed),
    stripMonthPeriods(stripDateNoise(trimmed)),
  ]);

  for (const candidate of candidates) {
    const compact = candidate.match(/^(\d{4})(\d{2})(\d{2})(?:\d{2,6})?$/);
    if (compact) {
      const iso = toIsoDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));
      if (iso) return iso;
    }

    const numeric = parseNumericDate(candidate);
    if (numeric) return numeric;

    const named = parseNamedDate(candidate);
    if (named) return named;
  }

  return null;
}

/**
 * Parse a money amount string that may be in US format (1,234.56) or
 * European format (1.234,56). Detects the format and returns a number.
 */
function parseMoneyAmount(raw: string): number {
  if (!raw || !raw.trim()) return NaN;

  const trimmed = raw.trim();
  const hasComma = trimmed.includes(',');
  const hasDot = trimmed.includes('.');

  if (hasComma && hasDot) {
    // Both separators present — determine which is decimal by position
    const lastComma = trimmed.lastIndexOf(',');
    const lastDot = trimmed.lastIndexOf('.');
    if (lastDot > lastComma) {
      // US format: 1,234.56 → decimal is dot, comma is thousands
      return parseFloat(trimmed.replace(/,/g, ''));
    } else {
      // European format: 1.234,56 → comma is decimal, dot is thousands
      return parseFloat(trimmed.replace(/\./g, '').replace(',', '.'));
    }
  } else if (hasComma) {
    // Only comma: could be "1,234" (thousands) or "1234,56" (decimal)
    const afterComma = trimmed.split(',').pop() || '';
    if (afterComma.length === 3 && !trimmed.match(/,\d{3}$/)) {
      // "1,234" → thousands separator
      return parseFloat(trimmed.replace(/,/g, ''));
    } else if (afterComma.length === 2) {
      // "1234,56" → European decimal
      return parseFloat(trimmed.replace(',', '.'));
    }
    // Ambiguous: treat as US (thousands)
    return parseFloat(trimmed.replace(/,/g, ''));
  } else if (hasDot) {
    // Only dot: could be "1.234" (thousands) or "1234.56" (decimal)
    const afterDot = trimmed.split('.').pop() || '';
    if (afterDot.length === 2 && trimmed.split('.').length === 2) {
      // "1234.56" → decimal
      return parseFloat(trimmed);
    }
    // "1.234" → European thousands, remove dots
    return parseFloat(trimmed.replace(/\./g, ''));
  }

  // Plain number
  return parseFloat(trimmed);
}

function decodePdfStringLiteral(input: string): string {
  let output = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== '\\') {
      output += ch;
      continue;
    }

    if (i + 1 >= input.length) break;

    const next = input[++i];
    if (next === '\n' || next === '\r') {
      if (next === '\r' && input[i + 1] === '\n') i++;
      continue;
    }

    if (next === 'n') output += '\n';
    else if (next === 'r') output += '\r';
    else if (next === 't') output += '\t';
    else if (next === 'b') output += '\b';
    else if (next === 'f') output += '\f';
    else if (next === '(' || next === ')' || next === '\\') output += next;
    else if (/[0-7]/.test(next)) {
      let octal = next;
      for (let j = 0; j < 2 && i + 1 < input.length && /[0-7]/.test(input[i + 1]); j++) {
        octal += input[++i];
      }
      output += String.fromCharCode(Number.parseInt(octal, 8));
    } else {
      output += next;
    }
  }

  return output;
}

function decodePdfHexString(input: string): string {
  const hex = input.replace(/\s+/g, '');
  if (!hex) return '';

  const normalizedHex = hex.length % 2 === 0 ? hex : `${hex}0`;
  const bytes: number[] = [];
  for (let i = 0; i < normalizedHex.length; i += 2) {
    const byte = Number.parseInt(normalizedHex.slice(i, i + 2), 16);
    if (Number.isFinite(byte)) bytes.push(byte);
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = '';
    for (let i = 2; i < bytes.length; i += 2) {
      const high = bytes[i] ?? 0;
      const low = bytes[i + 1] ?? 0;
      text += String.fromCharCode((high << 8) | low);
    }
    return text;
  }

  return Buffer.from(bytes).toString('latin1');
}

function extractPdfTextFromLine(line: string): string {
  const fragments: string[] = [];
  const tokenRe = /(\((?:\\.|[^\\)])*\)|<[^>]*>|\[(?:\\.|[^\]])*\])\s*(?:Tj|TJ|'|")/g;

  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(line)) !== null) {
    const token = match[1];
    if (token.startsWith('(')) {
      fragments.push(decodePdfStringLiteral(token.slice(1, -1)));
      continue;
    }

    if (token.startsWith('<')) {
      fragments.push(decodePdfHexString(token.slice(1, -1)));
      continue;
    }

    const inner = token.slice(1, -1);
    const innerFragments: string[] = [];
    const innerRe = /(\((?:\\.|[^\\)])*\)|<[^>]*>)/g;

    let innerMatch: RegExpExecArray | null;
    while ((innerMatch = innerRe.exec(inner)) !== null) {
      const innerToken = innerMatch[1];
      if (innerToken.startsWith('(')) {
        innerFragments.push(decodePdfStringLiteral(innerToken.slice(1, -1)));
      } else {
        innerFragments.push(decodePdfHexString(innerToken.slice(1, -1)));
      }
    }

    if (innerFragments.length > 0) {
      fragments.push(innerFragments.join(''));
    }
  }

  return fragments.join(' ').replace(/\s+/g, ' ').trim();
}

function extractPdfTextFromStream(streamContent: string): string {
  const normalized = streamContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const output: string[] = [];

  for (const line of lines) {
    const extracted = extractPdfTextFromLine(line);
    if (extracted) output.push(extracted);
  }

  return output.join('\n').trim();
}

function extractPdfTextFallback(buffer: Buffer): string {
  const source = buffer.toString('latin1');

  // Find streams: look for "stream\n...content...\nendstream" or "stream\r\n...content...\r\nendstream"
  const streamRe = /(?:^|\r?\n)stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const output: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(source)) !== null) {
    let streamContent = match[1];

    // Check for ASCII85Decode before trying inflate
    // ASCII85 starts with "<~" and ends with "~>"
    if (streamContent.startsWith('<~') && streamContent.endsWith('~>')) {
      try {
        streamContent = decodeAscii85(streamContent.slice(2, -2));
      } catch {
        // Use raw content if ASCII85 decode fails
      }
    }

    // Try decompressing with inflate (handles both raw deflate and zlib-wrapped)
    try {
      const rawBytes = Buffer.from(streamContent, 'latin1');
      const decompressed = inflateSync(rawBytes).toString('latin1');
      if (decompressed) streamContent = decompressed;
    } catch {
      // Try skipping a possible header byte (PDFs sometimes have a leading whitespace/newline)
      try {
        const trimmed = streamContent.replace(/^[\s\r\n]+/, '');
        const rawBytes = Buffer.from(trimmed, 'latin1');
        const decompressed = inflateSync(rawBytes).toString('latin1');
        if (decompressed) streamContent = decompressed;
      } catch {
        // Not compressed or unsupported compression — use raw content
      }
    }

    const extracted = extractPdfTextFromStream(streamContent);
    if (extracted) output.push(extracted);
  }

  if (output.length > 0) {
    return output.join('\n').trim();
  }

  // Last resort: extract text from BT...ET text blocks anywhere in the PDF
  const textBlocks = source.match(/BT\s*([\s\S]*?)\s*ET/g);
  if (textBlocks) {
    const textFragments: string[] = [];
    for (const block of textBlocks) {
      const tj = block.match(/\(([^)]*)\)\s*Tj/g);
      if (tj) {
        for (const t of tj) {
          const inner = t.match(/\(([^)]*)\)/)?.[1];
          if (inner) textFragments.push(decodePdfStringLiteral(inner));
        }
      }
      const tj2 = block.match(/\[([\s\S]*?)\]\s*TJ/g);
      if (tj2) {
        for (const t of tj2) {
          const inner = t.match(/\[([\s\S]*?)\]/)?.[1];
          if (inner) {
            const innerFrags: string[] = [];
            const innerRe = /\(([^)]*)\)/g;
            let im;
            while ((im = innerRe.exec(inner)) !== null) {
              innerFrags.push(decodePdfStringLiteral(im[1]));
            }
            textFragments.push(innerFrags.join(''));
          }
        }
      }
    }
    if (textFragments.length > 0) {
      return textFragments.join('\n').trim();
    }
  }

  // Ultra-fallback: grab any text-like sequences
  const looseText = source.match(/[A-Za-z0-9][A-Za-z0-9 ,./\-()$%:+#@&']{7,}/g) ?? [];
  return looseText.join('\n').trim();
}

/** Decode ASCII85-encoded data commonly used in PDF streams. */
function decodeAscii85(input: string): string {
  // Strip whitespace and the required '~>' end marker
  const data = input.replace(/\s/g, '').replace(/~>$/, '');
  const bytes: number[] = [];
  let group = 0;
  let count = 0;

  for (let i = 0; i < data.length; i++) {
    const ch = data.charCodeAt(i);
    if (ch < 33 || ch > 117) continue; // skip invalid
    group = group * 85 + (ch - 33);
    count++;
    if (count === 5) {
      bytes.push((group >> 24) & 0xff, (group >> 16) & 0xff, (group >> 8) & 0xff, group & 0xff);
      group = 0;
      count = 0;
    }
  }

  // Flush remaining bytes
  if (count > 0) {
    for (let j = count; j < 5; j++) group = group * 85 + 84; // pad with maximum ASCII85 value
    const remaining = count - 1;
    const b = [(group >> 24) & 0xff, (group >> 16) & 0xff, (group >> 8) & 0xff, group & 0xff];
    for (let j = 0; j < remaining; j++) bytes.push(b[j]);
  }

  return Buffer.from(bytes).toString('latin1');
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
      const normalizedDate =
        normalizeStatementDate(dateStr) ??
        (dateStr.match(/^(\d{4})(\d{2})(\d{2})/) ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}` : dateStr);

      // OFX uses TRNTYPE: DEBIT vs CREDIT
      const type = getTag('TRNTYPE');
      if (type === 'DEBIT' && amount > 0) amount = -amount;

      rows.push({
        date: normalizedDate,
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
  let pdfParseError: string | null = null;
  let usedFallback = false;
  let text = '';

  try {
    // Robust import: pdf-parse is CJS; ESM import wraps it in { default }
    let pdfParse: any = null;
    try {
      const mod = await import('pdf-parse');
      pdfParse = (mod as any).default || mod;
      // Verify the import actually gives us a callable function
      if (typeof pdfParse !== 'function') {
        throw new Error('pdf-parse did not resolve to a function');
      }
    } catch (importErr) {
      // Can't load pdf-parse at all — try raw extraction
      pdfParseError = importErr instanceof Error ? importErr.message : String(importErr);
      text = extractPdfTextFallback(buffer);
      usedFallback = true;
      if (!text) {
        errors.push(`Could not load PDF parser: ${pdfParseError}`);
        return {
          rows: [],
          headers: [],
          errors: [
            'Could not read this PDF. The file may be encrypted, password-protected, ' +
            'or uses an unsupported format. Try converting your bank statement to CSV first, ' +
            'or download it as a text-based PDF instead of a scanned image.',
          ],
          fileType: 'pdf',
        };
      }
    }

    if (!usedFallback && pdfParse) {
      try {
        const data = await pdfParse(buffer);
        text = data.text || '';
        if (!text || text.trim().length === 0) {
          // pdf-parse succeeded but returned no text — try fallback
          pdfParseError = 'pdf-parse returned no text content';
          text = extractPdfTextFallback(buffer);
          usedFallback = true;
        }
      } catch (parseErr) {
        pdfParseError = parseErr instanceof Error ? parseErr.message : String(parseErr);
        // Detect password-protected PDFs
        if (/password|encrypt|cannot decrypt|bad decrypt/i.test(pdfParseError)) {
          return {
            rows: [],
            headers: [],
            errors: [
              'This PDF is password-protected or encrypted. ' +
              'Please remove the password and try again, or download an unprotected copy of your statement.',
            ],
            fileType: 'pdf',
          };
        }
        text = extractPdfTextFallback(buffer);
        usedFallback = true;
      }
    }

    if (!text || text.trim().length === 0) {
      const detail = pdfParseError ? ` (reason: ${pdfParseError})` : '';
      errors.push(
        'This PDF contains no extractable text. It may be a scanned image or use ' +
        'an unsupported encoding.' + detail
      );
      return {
        rows: [],
        headers: [],
        errors: [
          'PDF appears to be empty or is a scanned image — OCR not supported. ' +
          'Please download your bank statement as a CSV or text-based PDF instead.',
        ],
        fileType: 'pdf',
      };
    }

    // Log how much text was extracted for debugging
    console.log(`[parsePDF] Extracted ${text.length} chars from PDF${usedFallback ? ' (via fallback)' : ''}`);

    const allLines = text.split('\n');
    const rows: ParsedRow[] = [];

    // Date patterns: "Thu, Dec. 31, 2024", "Dec 31, 2024", "2024-12-31", "12/31/2024",
    // "31/12/2024" (DD/MM/YYYY), "2024年12月31日", "31-Dec-2024", "Dec.31.2024"
    const monthAbbr = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
    const monthFull = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
    const dateLong = `(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+)?(?:${monthAbbr}|${monthFull})[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{2,4}`;
    const dateNumeric = [
      '\\d{1,2}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{2,4}',
      '\\d{2,4}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{1,2}',
      '\\d{2,4}[\\/\\-\\.]\\d{1,2}[\\/\\-\\.]\\d{1,2}',
    ].join('|');
    // Also: "31-Dec-2024" or "31 Dec 2024"
    const dateAbbreviated = `\\d{1,2}[\\s\\-]${monthAbbr}[a-z]*[\\s\\-]\\d{2,4}`;
    const dateRe = new RegExp(`(${dateLong}|${dateAbbreviated}|${dateNumeric})`, 'i');

    // Money amounts: handles $1,234.56, -$500.00, +$220.50, (1,234.56), 1,234.56, 1.234,56
    // Also: $1,234 (no cents), -500.00, 1,234.56CR, 500.00DR, €1.234,56 (European)
    const moneyRe = /[+\-−–—]?\s*[\$£€¥]?\s*\(?\s*([\d,.]+)\s*\)?\s*(?:CR|DR)?\b/gi;

    // Lines that are definitely NOT transactions — skip them unconditionally
    const skipRe = /(?:page\s+\d+|page\s+created\s+on|statement\s+period|opening\s+balance|closing\s+balance|total\s+(deposits|withdrawals|credits|debits)|continued\s+on\s+next\s+page|account\s+(number|summary)|customer\s+service|document\s+delivery|current\s+balance|available\s+balance|select\s+account|filters|print|balance\s+details|no\s+holds|beginning\s+balance|ending\s+balance|posted\s+date|transaction\s+history|activity\s+summary|deposits\s+and\s+credits|withdrawals\s+and\s+debits|this\s+page\s+intentionally|please\s+detach|questions?\?\s+call|from\s+date\s*=|to\s+date\s*=|account\s+for\s+business\s+plan)/i;

    // Also skip lines that match any of these anywhere in the text
    const skipAnywhereRe = /(?:balance\s+\$[\d,.]+.*available\s+balance|document\s+delivery|print\s+balance\s+details|page\s+created\s+on|from\s+date\s*=|to\s+date\s*=|filter|transactions?\s*$|deposits?\s*$|withdrawals?\s*$|\*\*\*\*|business\s+plan|account\s+for\s+business)/i;

    // Boilerplate description patterns — pending rows with these descriptions are discarded
    const boilerplateDescRe = /^(?:select\s+account|page\s+created|current\s+balance|available\s+balance|document\s+delivery|print|filter|transactions?|deposits?\s+and|withdrawals?\s+and|account\s+for\s+business|statement\s+period|opening\s+balance|closing\s+balance)/i;

    // ── Multi-line row builder ──
    // Scotia/RBC/TD format: date line → description line(s) → amounts line
    interface PendingRow {
      date: string;
      rawDate: string;
      descLines: string[];
    }
    let pending: PendingRow | null = null;

    function flushRow(amounts: { raw: string; value: number }[]) {
      if (!pending) return null;

      const desc = pending.descLines.join(' ').replace(/\s+/g, ' ').trim() || 'Transaction';

      // Discard rows with boilerplate descriptions (headers/footers misidentified as transactions)
      if (boilerplateDescRe.test(desc) || boilerplateDescRe.test(pending.rawDate)) {
        pending = null;
        return null;
      }

      // Store ALL detected amounts as separate columns so the user can map them
      // in the wizard: Amount_1, Amount_2, Amount_3, Amount_4 — up to 6 columns
      const raw: Record<string, string> = {
        Date: pending.rawDate,
        Description: desc,
      };

      for (let i = 0; i < Math.min(amounts.length, 6); i++) {
        const colNum = i + 1;
        raw[`Amount_${colNum}`] = String(amounts[i].value);
        // Also store the raw display text for preview
        raw[`Amount_${colNum}_display`] = amounts[i].raw.trim();
      }

      const row: ParsedRow = {
        date: pending.date,
        description: desc,
        amount: 0, // Set to 0 — user maps columns in wizard
        raw,
      };

      pending = null;
      return row;
    }

    // Track max amount columns across all rows for header generation
    let maxAmountCols = 0;

    for (const line of allLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 3) continue;
      if (skipRe.test(trimmed)) continue;
      if (skipAnywhereRe.test(trimmed)) continue;

      // Check for date
      const dateMatch = trimmed.match(dateRe);
      const foundDate = dateMatch ? dateMatch[0] : '';

      // Strip the date from the line before finding amounts, so date components
      // like "01", "03", "2025" aren't misidentified as transaction amounts
      const lineWithoutDate = foundDate ? trimmed.replace(foundDate, ' ') : trimmed;

      // Find amounts on this line (in the date-stripped version)
      const amounts: { raw: string; value: number }[] = [];
      let m;
      while ((m = moneyRe.exec(lineWithoutDate)) !== null) {
        const rawAmount = m[1] || '';
        let val = parseMoneyAmount(rawAmount);
        if (!Number.isFinite(val)) continue;
        // Skip very small numbers that are likely date artifacts (1-31)
        if (val > 0 && val <= 31 && /^\d{1,2}$/.test(rawAmount.trim())) continue;
        const fullMatch = m[0];
        // Detect sign:
        // 1. Leading minus/dash: "-$20.00", "−$20.00" (unicode minus), "—$20.00" (em dash)
        // 2. Parentheses: "(1,234.56)" = negative
        // 3. CR suffix = positive, DR suffix = negative
        // 4. Explicit "+" = positive
        if (/^[\s]*(—|−|\-|–)/.test(fullMatch) || fullMatch.includes('(')) {
          val = -Math.abs(val);
        } else if (/\bDR\b/i.test(fullMatch)) {
          val = -Math.abs(val);  // Debit = outflow
        } else if (/\bCR\b/i.test(fullMatch)) {
          val = Math.abs(val);   // Credit = inflow
        } else if (fullMatch.includes('+')) {
          val = Math.abs(val);   // Explicit positive
        }
        amounts.push({ raw: m[0], value: val });
      }
      moneyRe.lastIndex = 0;

      // If this line has a date, flush previous pending row (if any amounts were pending)
      if (foundDate && pending && amounts.length > 0) {
        const row = flushRow(amounts);
        if (row) rows.push(row);
        pending = null;
      }

      // Start new pending row when we see a date
      if (foundDate) {
        // Flush any existing pending (without amounts — might be orphan)
        pending = {
          date: normalizeStatementDate(foundDate) ?? foundDate,
          rawDate: foundDate,
          descLines: [],
        };

        // If this date line also has amounts, resolve immediately
        // Extract remaining text after the date as description
        if (amounts.length > 0) {
          let descText = trimmed.replace(dateMatch![0], '');
          for (const a of amounts) {
            descText = descText.replace(a.raw, '');
          }
          descText = descText.replace(/[^\w\s\-\&\#\/\.\@]/g, ' ').replace(/\s+/g, ' ').trim();
          if (descText) pending.descLines.push(descText);
          const row = flushRow(amounts);
          if (row) rows.push(row);
          pending = null;
        }
        continue;
      }

      // Line without date: if it has amounts, it completes the pending row
      if (amounts.length > 0 && pending) {
        const row = flushRow(amounts);
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
      const raw: Record<string, string> = {
        Date: pending.rawDate,
        Description: pending.descLines.join(' ').trim(),
      };
      rows.push({
        date: pending.date,
        description: pending.descLines.join(' ').trim(),
        amount: 0,
        raw,
      });
    }

    if (rows.length === 0 && allLines.length > 10) {
      // Provide diagnostics: show a sample of what text was found
      const sampleLines = allLines.filter(l => l.trim().length > 3).slice(0, 5).map(l => l.trim().substring(0, 80));
      const sampleInfo = sampleLines.length > 0
        ? ` First 5 text lines found: [${sampleLines.join(' | ')}]`
        : '';
      errors.push(
        'No transactions could be identified in the extracted text. ' +
        'The statement format may not be supported.' + sampleInfo +
        ' Try downloading your statement as CSV or OFX instead.'
      );
    }

    if (pdfParseError) {
      errors.unshift(`Note: The primary PDF parser had an issue (${pdfParseError}). Results below are from a best-effort fallback parser.`);
    }

    // Build dynamic headers based on detected amount columns.
    // Bank statements commonly have 3+ financial columns (e.g. Withdrawals,
    // Deposits, Balance). Ensure we show enough columns so the user can map
    // each one independently in the import wizard.
    for (const row of rows) {
      const colCount = Object.keys(row.raw).filter(k => k.startsWith('Amount_') && !k.endsWith('_display')).length;
      if (colCount > maxAmountCols) maxAmountCols = colCount;
    }
    // Minimum 4 amount columns: covers withdrawal, deposit, balance + one spare.
    // The import wizard lets the user ignore extras, but missing columns cannot
    // be mapped later.
    const minAmountCols = 4;
    const shownAmountCols = Math.max(maxAmountCols, minAmountCols);
    const headers = ['Date', 'Description'];
    for (let i = 1; i <= shownAmountCols; i++) {
      headers.push(`Amount_${i}`);
    }

    // ── Column type auto-detection ──
    // Analyze each Amount_N column to determine its likely type: signed (mixed
    // +/- values), positive-only (dedicated debit or credit column), negative-only,
    // or a running balance column. This metadata helps the import wizard make
    // smarter auto-mapping decisions.
    const amountCols = Array.from({ length: Math.max(maxAmountCols, 0) }, (_, i) => `Amount_${i + 1}`);
    const columnMeta: ColumnMeta[] = [];

    if (rows.length > 0 && amountCols.length > 0) {
      // Gather statistics per column
      const colStats = amountCols.map((colName) => {
        let populatedCount = 0;
        let totalMagnitude = 0;
        let negCount = 0;
        let posCount = 0;
        const samples: number[] = [];

        for (const row of rows) {
          const raw = row.raw[colName];
          if (raw === undefined || raw === null || raw === '') continue;
          const val = Number(raw);
          if (!Number.isFinite(val)) continue;
          if (Math.abs(val) < 0.001) continue;

          populatedCount++;
          totalMagnitude += Math.abs(val);
          if (val < -0.001) negCount++;
          else posCount++;

          if (samples.length < 3) samples.push(Math.round(val * 100) / 100);
        }

        const avgMagnitude = populatedCount > 0 ? totalMagnitude / populatedCount : 0;

        return { colName, populatedCount, avgMagnitude, negCount, posCount, samples };
      });

      // Detect balance columns: heavily populated (>90% of rows) AND
      // magnitude much larger than other columns (running balance accumulates)
      const totalRows = rows.length;
      const stronglyPopulated = colStats.filter((s) => s.populatedCount / totalRows > 0.9);

      for (const stat of colStats) {
        let kind: ColumnMeta['kind'] = 'signed';

        // Balance detection: high population rate + significantly larger magnitude
        if (stat.populatedCount / totalRows > 0.9 && amountCols.length >= 2) {
          const others = colStats.filter((o) => o.colName !== stat.colName);
          const maxOtherAvg = Math.max(0, ...others.map((o) => o.avgMagnitude));
          if (maxOtherAvg === 0 || stat.avgMagnitude > maxOtherAvg * 2) {
            kind = 'balance';
          }
        }

        // For non-balance columns, detect sign pattern
        if (kind !== 'balance') {
          if (stat.negCount === 0 && stat.posCount > 0) {
            kind = 'positive-only';
          } else if (stat.posCount === 0 && stat.negCount > 0) {
            kind = 'negative-only';
          } else {
            kind = 'signed'; // has both positive and negative values
          }
        }

        columnMeta.push({
          name: stat.colName,
          kind,
          populatedCount: stat.populatedCount,
          avgMagnitude: Math.round(stat.avgMagnitude * 100) / 100,
          samples: stat.samples,
        });
      }
    }

    return {
      rows,
      headers,
      errors,
      fileType: 'pdf',
      columnMeta: columnMeta.length > 0 ? columnMeta : undefined,
    };
  } catch (err) {
    return {
      rows: [],
      headers: [],
      errors: [
        'Unexpected error while reading PDF: ' + (err instanceof Error ? err.message : 'Unknown error') +
        '. The file may be corrupted, encrypted, or in an unsupported format.'
      ],
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
