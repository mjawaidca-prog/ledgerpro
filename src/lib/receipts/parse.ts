/**
 * Receipt OCR-text parser — pure, engine-agnostic.
 *
 * Takes the raw text produced by any extractor (pdf-parse for text PDFs,
 * tesseract.js for photos) and pulls out the fields a bookkeeper needs:
 * merchant, date, subtotal, tax, total. Canadian receipts are the target:
 * GST/HST/PST/QST/RST/TPS/TVQ tax lines, MM/DD/YYYY POS dates, $ amounts.
 *
 * Everything is a SUGGESTION. The user confirms or edits every field in the
 * Receipts inbox before anything touches a transaction, so the parser
 * favours precision over recall: a wrong total is worse than a missing one.
 */

export interface ParsedReceipt {
  merchant: string | null;
  /** ISO date (yyyy-mm-dd), or null. */
  date: string | null;
  total: number | null;
  subtotal: number | null;
  /** All receipt taxes summed (GST/HST + PST/QST/...), or total − subtotal. */
  taxAmount: number | null;
  /** Only the GST/HST portion, when an explicit GST/HST line was found. */
  gstHstAmount: number | null;
  /** 0–1 weighted share of the key fields found (merchant/date/total/tax). */
  confidence: number;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

const MONEY = /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/g;

function amountsIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(MONEY)) {
    const v = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function lastAmount(line: string): number | null {
  const amounts = amountsIn(line);
  return amounts.length ? amounts[amounts.length - 1] : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseReceiptDate(text: string): string | null {
  let m = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  // Month name, both orders: "Oct 27, 2026" / "27 Oct 2026".
  m = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (m) return iso(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
  m = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+(\d{4})\b/i);
  if (m) return iso(Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]));

  // Numeric POS dates are MM/DD/YYYY in Canada (US-style POS firmware);
  // a first component > 12 flips the reading to DD/MM.
  m = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a > 12 ? iso(Number(m[3]), b, a) : iso(Number(m[3]), a, b);
  }
  m = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2})\b/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a > 12 ? iso(2000 + Number(m[3]), b, a) : iso(2000 + Number(m[3]), a, b);
  }
  return null;
}

const MERCHANT_SKIP = /^(receipt|invoice|tax invoice|sales receipt|customer copy|merchant copy|order|welcome|thank)/i;

export function parseReceiptMerchant(lines: string[]): string | null {
  for (const raw of lines.slice(0, 6)) {
    const line = raw.trim();
    if (line.length < 2 || line.length > 60) continue;
    if (!/[A-Za-z]{2,}/.test(line)) continue;
    if (MERCHANT_SKIP.test(line)) continue;
    if (parseReceiptDate(line)) continue;
    if (amountsIn(line).length && !/[A-Za-z]{3,}/.test(line)) continue;
    return line.replace(/\s+/g, ' ');
  }
  return null;
}

const SUBTOTAL_RE = /sub\s*-?\s*total/i;
const TOTAL_RE = /(grand\s*total|total\s*due|amount\s*due|balance\s*due|^total\b|\btotal\s*:)/i;
const TAX_LABEL_RE = /\b(GST|HST|PST|QST|RST|TPS|TVQ)\b/i;
const GST_HST_RE = /\b(GST|HST|TPS)\b/i;

export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let subtotal: number | null = null;
  let total: number | null = null;
  let taxSum = 0;
  let taxLines = 0;
  let gstHst = 0;
  let gstHstLines = 0;
  let largest: number | null = null;

  for (const line of lines) {
    const amount = lastAmount(line);
    if (amount !== null && (largest === null || amount > largest)) largest = amount;

    if (SUBTOTAL_RE.test(line)) {
      if (amount !== null) subtotal = amount;
      continue;
    }
    if (TAX_LABEL_RE.test(line) && amount !== null && !/#/.test(line)) {
      taxSum += amount;
      taxLines += 1;
      if (GST_HST_RE.test(line)) {
        gstHst += amount;
        gstHstLines += 1;
      }
      continue;
    }
    if (TOTAL_RE.test(line) && !SUBTOTAL_RE.test(line) && amount !== null) {
      total = amount; // last TOTAL line wins — it is the footer figure
    }
  }

  if (total === null) total = largest;

  let taxAmount: number | null = null;
  if (taxLines > 0) taxAmount = round2(taxSum);
  else if (subtotal !== null && total !== null && total > subtotal) taxAmount = round2(total - subtotal);

  const merchant = parseReceiptMerchant(lines);
  const date = parseReceiptDate(text);

  const confidence =
    (merchant ? 0.25 : 0) + (date ? 0.25 : 0) + (total !== null ? 0.35 : 0) + (taxAmount !== null ? 0.15 : 0);

  return {
    merchant,
    date,
    total,
    subtotal,
    taxAmount,
    gstHstAmount: gstHstLines > 0 ? round2(gstHst) : null,
    confidence: round2(confidence),
  };
}
