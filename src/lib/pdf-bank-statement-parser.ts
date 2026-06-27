export type StatementAccountKind = "bank" | "checking" | "savings" | "credit_card";
export type SignMode = "normal" | "inverted" | "credit-card";
export type RunningBalanceMode = "auto" | "always" | "never";

export interface PdfBankStatementParseOptions {
  accountKind?: StatementAccountKind;
  signMode?: SignMode;
  currency?: string;
  statementYear?: number;
  dateLocale?: "US" | "DMY";
  runningBalance?: RunningBalanceMode;
  minConfidence?: number;
}

export interface ParsedBankTransaction {
  date: string;
  description: string;
  merchant?: string;
  amount: number;
  currency: string;
  balance?: number;
  rawStatementText: string;
  page: number;
  source: "pdf";
  confidence: number;
  warnings: string[];
  fingerprint: string;
}

export interface RejectedStatementRow {
  rawStatementText: string;
  page: number;
  reason: string;
  warnings: string[];
}

export interface PdfBankStatementParseResult {
  transactions: ParsedBankTransaction[];
  rejectedRows: RejectedStatementRow[];
  warnings: string[];
  metadata: {
    pages: number;
    textItems: number;
    rowsSeen: number;
    rowsParsed: number;
    lowConfidenceRows: number;
  };
}

export interface ExistingTransactionForMatch {
  id: string;
  financialAccountId: string;
  date: Date | string;
  amount: number | string;
  description: string;
}

export interface DuplicateMatch {
  transaction: ParsedBankTransaction;
  duplicateOf: ExistingTransactionForMatch;
  score: number;
  reasons: string[];
}

export interface TransferCandidate {
  outflow: ExistingTransactionForMatch | ParsedBankTransaction;
  inflow: ExistingTransactionForMatch | ParsedBankTransaction;
  amount: number;
  confidence: number;
  reasons: string[];
}

interface PdfTextItem {
  page: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextSegment {
  text: string;
  start: number;
  end: number;
  x: number;
}

interface PdfLine {
  page: number;
  y: number;
  text: string;
  items: PdfTextItem[];
  segments: TextSegment[];
}

interface StatementRow {
  page: number;
  text: string;
  lines: PdfLine[];
}

interface ColumnHint {
  x: number;
  type: "debit" | "credit" | "balance";
}

interface MoneyToken {
  raw: string;
  value: number;
  x: number;
  start: number;
  end: number;
  columnType?: ColumnHint["type"];
}

const DATE_AT_START =
  /^\s*((?:\d{4}[./-]\d{1,2}[./-]\d{1,2})|(?:\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{2,4})?))/i;

const MONEY_RE =
  /(?:[$]?\s*)[+-]?\(?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?\s*(?:CR|DR)?|(?:[$]?\s*)[+-]?\(?\d+\.\d{2}\)?\s*(?:CR|DR)?/gi;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

export async function parsePdfBankStatement(
  input: Buffer | Uint8Array | ArrayBuffer,
  options: PdfBankStatementParseOptions = {}
): Promise<PdfBankStatementParseResult> {
  const normalizedOptions = normalizeOptions(options);
  const items = await extractPdfTextItems(input);
  const warnings: string[] = [];

  if (items.length < 20) {
    warnings.push(
      "Very little text was found. This may be a scanned PDF; send it through OCR before parsing."
    );
  }

  const lines = groupItemsIntoLines(items);
  const columnHints = detectColumnHints(lines);
  const rows = buildTransactionRows(lines);
  const parsed: ParsedBankTransaction[] = [];
  const rejectedRows: RejectedStatementRow[] = [];
  const seenFingerprints = new Set<string>();

  for (const row of rows) {
    const result = parseStatementRow(row, columnHints, normalizedOptions);

    if (!result.transaction) {
      rejectedRows.push({
        rawStatementText: row.text,
        page: row.page,
        reason: result.reason ?? "Could not parse row",
        warnings: result.warnings
      });
      continue;
    }

    if (seenFingerprints.has(result.transaction.fingerprint)) {
      result.transaction.warnings.push("Duplicate row inside this PDF import.");
      result.transaction.confidence = Math.min(result.transaction.confidence, 0.72);
    }

    seenFingerprints.add(result.transaction.fingerprint);
    parsed.push(result.transaction);
  }

  const minConfidence = normalizedOptions.minConfidence ?? 0.55;
  const transactions = parsed.filter((tx) => tx.confidence >= minConfidence);
  const lowConfidence = parsed.filter((tx) => tx.confidence < minConfidence);

  for (const tx of lowConfidence) {
    rejectedRows.push({
      rawStatementText: tx.rawStatementText,
      page: tx.page,
      reason: "Confidence below threshold",
      warnings: tx.warnings
    });
  }

  transactions.sort((a, b) => a.date.localeCompare(b.date));

  return {
    transactions,
    rejectedRows,
    warnings,
    metadata: {
      pages: Math.max(0, ...items.map((item) => item.page)),
      textItems: items.length,
      rowsSeen: rows.length,
      rowsParsed: transactions.length,
      lowConfidenceRows: lowConfidence.length
    }
  };
}

export function detectPdfImportDuplicates(
  transactions: ParsedBankTransaction[],
  existingTransactions: ExistingTransactionForMatch[],
  financialAccountId: string,
  options: { dateWindowDays?: number; descriptionThreshold?: number } = {}
): DuplicateMatch[] {
  const dateWindowDays = options.dateWindowDays ?? 2;
  const descriptionThreshold = options.descriptionThreshold ?? 0.62;
  const matches: DuplicateMatch[] = [];

  for (const tx of transactions) {
    for (const existing of existingTransactions) {
      if (existing.financialAccountId !== financialAccountId) continue;
      if (toCents(existing.amount) !== toCents(tx.amount)) continue;

      const dayDelta = Math.abs(daysBetween(existing.date, tx.date));
      if (dayDelta > dateWindowDays) continue;

      const descriptionScore = descriptionSimilarity(existing.description, tx.description);
      if (descriptionScore < descriptionThreshold) continue;

      matches.push({
        transaction: tx,
        duplicateOf: existing,
        score: round2(0.55 + descriptionScore * 0.35 + (dateWindowDays - dayDelta) * 0.05),
        reasons: [
          "same account",
          "same signed amount",
          `date within ${dayDelta} day(s)`,
          "similar description"
        ]
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

export function suggestTransferMatches(
  importedTransactions: ParsedBankTransaction[],
  importedAccountId: string,
  otherAccountTransactions: ExistingTransactionForMatch[],
  options: { dateWindowDays?: number } = {}
): TransferCandidate[] {
  const dateWindowDays = options.dateWindowDays ?? 5;
  const candidates: TransferCandidate[] = [];

  for (const imported of importedTransactions) {
    for (const other of otherAccountTransactions) {
      if (other.financialAccountId === importedAccountId) continue;
      if (toCents(imported.amount) + toCents(other.amount) !== 0) continue;

      const dayDelta = Math.abs(daysBetween(imported.date, other.date));
      if (dayDelta > dateWindowDays) continue;

      const importedLooksTransfer = looksLikeTransfer(imported.description);
      const otherLooksTransfer = looksLikeTransfer(other.description);
      const confidence = round2(
        0.7 +
          (dateWindowDays - dayDelta) * 0.03 +
          (importedLooksTransfer ? 0.08 : 0) +
          (otherLooksTransfer ? 0.08 : 0)
      );

      const outflow = imported.amount < 0 ? imported : other;
      const inflow = imported.amount > 0 ? imported : other;

      candidates.push({
        outflow,
        inflow,
        amount: Math.abs(imported.amount),
        confidence: Math.min(confidence, 0.98),
        reasons: [
          "opposite signs on different internal accounts",
          "same absolute amount",
          `dates within ${dayDelta} day(s)`
        ]
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

async function extractPdfTextItems(input: Buffer | Uint8Array | ArrayBuffer): Promise<PdfTextItem[]> {
  let pdfjs: any;

  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    throw new Error(
      "Install pdfjs-dist and run this parser in the Node.js runtime. pdf-parse alone flattens tables too aggressively for bank statements."
    );
  }

  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false
  });
  const pdf = await loadingTask.promise;
  const items: PdfTextItem[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent({ disableCombineTextItems: false });

    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;

      items.push({
        page: pageNumber,
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width ?? 0,
        height: Math.abs(item.transform[3] ?? 0)
      });
    }
  }

  return items;
}

function groupItemsIntoLines(items: PdfTextItem[]): PdfLine[] {
  const byPage = new Map<number, PdfTextItem[]>();

  for (const item of items) {
    const pageItems = byPage.get(item.page) ?? [];
    pageItems.push(item);
    byPage.set(item.page, pageItems);
  }

  const lines: PdfLine[] = [];

  for (const [page, pageItems] of byPage) {
    const sorted = [...pageItems].sort((a, b) => b.y - a.y || a.x - b.x);
    const grouped: PdfTextItem[][] = [];

    for (const item of sorted) {
      const tolerance = Math.max(2.5, item.height * 0.45);
      const existing = grouped.find((line) => Math.abs(line[0].y - item.y) <= tolerance);

      if (existing) {
        existing.push(item);
      } else {
        grouped.push([item]);
      }
    }

    for (const group of grouped) {
      const orderedItems = group.sort((a, b) => a.x - b.x);
      const { text, segments } = buildLineText(orderedItems);

      if (text.trim()) {
        lines.push({
          page,
          y: average(orderedItems.map((item) => item.y)),
          text,
          items: orderedItems,
          segments
        });
      }
    }
  }

  return lines.sort((a, b) => a.page - b.page || b.y - a.y);
}

function buildLineText(items: PdfTextItem[]): { text: string; segments: TextSegment[] } {
  let text = "";
  const segments: TextSegment[] = [];

  for (const item of items) {
    if (text) text += " ";
    const start = text.length;
    text += item.text.trim();
    segments.push({ text: item.text.trim(), start, end: text.length, x: item.x });
  }

  return { text: normalizeWhitespace(text), segments };
}

function detectColumnHints(lines: PdfLine[]): ColumnHint[] {
  const hints: ColumnHint[] = [];

  for (const line of lines) {
    const text = line.text.toLowerCase();
    const looksLikeHeader =
      /(date|transaction|description|details|amount|balance|debit|credit|withdrawal|deposit|paid in|paid out|charge|payment)/.test(
        text
      ) && !DATE_AT_START.test(line.text);

    if (!looksLikeHeader) continue;

    for (const item of line.items) {
      addColumnHint(hints, item, /\b(debit|withdrawals?|paid out|charges?)\b/i, "debit");
      addColumnHint(hints, item, /\b(credit|deposits?|paid in)\b/i, "credit");
      addColumnHint(hints, item, /\bbalance\b/i, "balance");
    }
  }

  return dedupeHints(hints);
}

function buildTransactionRows(lines: PdfLine[]): StatementRow[] {
  const rows: StatementRow[] = [];
  let current: StatementRow | undefined;

  for (const line of lines) {
    if (isNoiseLine(line.text)) continue;

    if (DATE_AT_START.test(line.text)) {
      if (current) rows.push(current);
      current = {
        page: line.page,
        text: line.text,
        lines: [line]
      };
      continue;
    }

    if (current && shouldAppendContinuation(line.text)) {
      current.text = normalizeWhitespace(`${current.text} ${line.text}`);
      current.lines.push(line);
    }
  }

  if (current) rows.push(current);
  return rows;
}

function parseStatementRow(
  row: StatementRow,
  columnHints: ColumnHint[],
  options: Required<PdfBankStatementParseOptions>
): { transaction?: ParsedBankTransaction; reason?: string; warnings: string[] } {
  const warnings: string[] = [];
  const dateMatch = row.text.match(DATE_AT_START);

  if (!dateMatch) {
    return { reason: "Missing transaction date", warnings };
  }

  const dateResult = parseDate(dateMatch[1], options);
  if (!dateResult.date) {
    return { reason: `Invalid date: ${dateMatch[1]}`, warnings: dateResult.warnings };
  }
  warnings.push(...dateResult.warnings);

  const moneyTokens = row.lines.flatMap((line) => findMoneyTokens(line, columnHints));
  if (!moneyTokens.length) {
    return { reason: "Missing amount", warnings };
  }

  const selected = selectTransactionAmount(moneyTokens, options);
  if (!selected.transactionAmount) {
    return { reason: "Could not identify transaction amount", warnings };
  }

  warnings.push(...selected.warnings);
  const amount = applyStatementSign(
    selected.transactionAmount,
    row.text,
    options.signMode,
    options.accountKind
  );
  const description = buildDescription(row.text, dateMatch[1], moneyTokens);

  if (!description || description.length < 3) {
    warnings.push("Description is very short after cleanup.");
  }

  const confidence = calculateConfidence({
    description,
    amount,
    warnings,
    moneyTokens,
    selectedAmount: selected.transactionAmount
  });

  const transaction: ParsedBankTransaction = {
    date: dateResult.date,
    description,
    merchant: extractMerchant(description),
    amount,
    currency: options.currency,
    balance: selected.balance?.value,
    rawStatementText: row.text,
    page: row.page,
    source: "pdf",
    confidence,
    warnings,
    fingerprint: buildFingerprint(dateResult.date, amount, description)
  };

  return { transaction, warnings };
}

function findMoneyTokens(line: PdfLine, columnHints: ColumnHint[]): MoneyToken[] {
  const tokens: MoneyToken[] = [];

  for (const match of line.text.matchAll(MONEY_RE)) {
    if (match.index === undefined) continue;

    const raw = match[0].trim();
    const value = parseMoney(raw);
    if (Number.isNaN(value)) continue;

    const x = xForMatch(line, match.index, match.index + match[0].length);
    const columnType = nearestColumnType(x, columnHints);

    tokens.push({
      raw,
      value,
      x,
      start: match.index,
      end: match.index + match[0].length,
      columnType
    });
  }

  return tokens;
}

function selectTransactionAmount(
  moneyTokens: MoneyToken[],
  options: Required<PdfBankStatementParseOptions>
): { transactionAmount?: MoneyToken; balance?: MoneyToken; warnings: string[] } {
  const warnings: string[] = [];
  const nonBalance = moneyTokens.filter((token) => token.columnType !== "balance");
  const debitCredit = nonBalance.filter(
    (token) => token.columnType === "debit" || token.columnType === "credit"
  );

  if (debitCredit.length) {
    const transactionAmount = debitCredit[debitCredit.length - 1];
    const balance = moneyTokens.find((token) => token.columnType === "balance");
    return { transactionAmount, balance, warnings };
  }

  if (moneyTokens.length === 1) {
    return { transactionAmount: moneyTokens[0], warnings };
  }

  if (options.runningBalance !== "never") {
    warnings.push("Multiple amounts found; treating the rightmost amount as running balance.");
    const ordered = [...moneyTokens].sort((a, b) => a.x - b.x);
    return {
      transactionAmount: ordered[ordered.length - 2],
      balance: ordered[ordered.length - 1],
      warnings
    };
  }

  warnings.push("Multiple amounts found; using the rightmost amount as the transaction amount.");
  return { transactionAmount: moneyTokens[moneyTokens.length - 1], warnings };
}

function applyStatementSign(
  token: MoneyToken,
  rowText: string,
  signMode: SignMode,
  accountKind: StatementAccountKind
): number {
  const absolute = Math.abs(token.value);
  const rawUpper = token.raw.toUpperCase();
  const explicitNegative = token.value < 0 || rawUpper.includes("DR");
  const explicitPositive = rawUpper.includes("CR");

  if (token.columnType === "debit") return -absolute;
  if (token.columnType === "credit") return absolute;

  if (signMode === "credit-card" || accountKind === "credit_card") {
    if (explicitPositive) return absolute;
    if (looksLikeCreditCardPayment(rowText)) return absolute;
    if (explicitNegative && !looksLikeCharge(rowText)) return absolute;
    return -absolute;
  }

  let signed = explicitNegative ? -absolute : absolute;
  if (explicitPositive) signed = absolute;
  if (signMode === "inverted") signed *= -1;

  return round2(signed);
}

function buildDescription(rowText: string, dateText: string, moneyTokens: MoneyToken[]): string {
  let description = rowText.replace(dateText, " ");
  const tokensByLength = [...moneyTokens].sort((a, b) => b.raw.length - a.raw.length);

  for (const token of tokensByLength) {
    description = description.replace(token.raw, " ");
  }

  return normalizeWhitespace(
    description
      .replace(/\b(posted|transaction|description|amount|balance|debit|credit)\b/gi, " ")
      .replace(/\s{2,}/g, " ")
  ).trim();
}

function parseDate(
  value: string,
  options: Required<PdfBankStatementParseOptions>
): { date?: string; warnings: string[] } {
  const warnings: string[] = [];
  const cleaned = value.replace(",", "").replace(/\./g, "").trim();
  const monthNameMatch = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2})(?:\s+(\d{2,4}))?$/);

  if (monthNameMatch) {
    const month = MONTHS[monthNameMatch[1].toLowerCase()];
    const day = Number(monthNameMatch[2]);
    const year = normalizeYear(monthNameMatch[3] ? Number(monthNameMatch[3]) : options.statementYear);
    if (!monthNameMatch[3]) warnings.push("Date had no year; statementYear was used.");
    return buildIsoDate(year, month, day, warnings);
  }

  const parts = cleaned.split(/[/-]/).map((part) => Number(part));

  if (parts.length === 3 && String(parts[0]).length === 4) {
    return buildIsoDate(parts[0], parts[1], parts[2], warnings);
  }

  if (parts.length === 2 || parts.length === 3) {
    const year = normalizeYear(parts.length === 3 ? parts[2] : options.statementYear);
    if (parts.length === 2) warnings.push("Date had no year; statementYear was used.");

    const first = parts[0];
    const second = parts[1];
    const month = options.dateLocale === "DMY" ? second : first;
    const day = options.dateLocale === "DMY" ? first : second;

    return buildIsoDate(year, month, day, warnings);
  }

  return { warnings };
}

function buildIsoDate(
  year: number,
  month: number,
  day: number,
  warnings: string[]
): { date?: string; warnings: string[] } {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!valid) return { warnings };

  return {
    date: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
      .toString()
      .padStart(2, "0")}`,
    warnings
  };
}

function parseMoney(value: string): number {
  const upper = value.toUpperCase();
  const negative = upper.includes("DR") || value.includes("(") || value.includes("-");
  const cleaned = value.replace(/[,$()\sA-Za-z+-]/g, "");
  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) return Number.NaN;
  return round2(negative ? -parsed : parsed);
}

function addColumnHint(
  hints: ColumnHint[],
  item: PdfTextItem,
  pattern: RegExp,
  type: ColumnHint["type"]
): void {
  const match = item.text.match(pattern);
  if (!match || match.index === undefined) return;

  const x = item.x + item.width * (match.index / Math.max(item.text.length, 1));
  hints.push({ x, type });
}

function calculateConfidence(input: {
  description: string;
  amount: number;
  warnings: string[];
  moneyTokens: MoneyToken[];
  selectedAmount: MoneyToken;
}): number {
  let confidence = 0.96;

  if (!input.description || input.description.length < 3) confidence -= 0.25;
  if (!Number.isFinite(input.amount) || input.amount === 0) confidence -= 0.25;
  if (input.moneyTokens.length > 1 && !input.selectedAmount.columnType) confidence -= 0.12;
  confidence -= Math.min(0.35, input.warnings.length * 0.07);

  return Math.max(0, round2(confidence));
}

function normalizeOptions(
  options: PdfBankStatementParseOptions
): Required<PdfBankStatementParseOptions> {
  const accountKind = options.accountKind ?? "bank";

  return {
    accountKind,
    signMode: options.signMode ?? (accountKind === "credit_card" ? "credit-card" : "normal"),
    currency: options.currency ?? "USD",
    statementYear: options.statementYear ?? new Date().getFullYear(),
    dateLocale: options.dateLocale ?? "US",
    runningBalance: options.runningBalance ?? "auto",
    minConfidence: options.minConfidence ?? 0.55
  };
}

function nearestColumnType(x: number, hints: ColumnHint[]): ColumnHint["type"] | undefined {
  if (!hints.length) return undefined;
  const nearest = hints
    .map((hint) => ({ hint, distance: Math.abs(hint.x - x) }))
    .sort((a, b) => a.distance - b.distance)[0];

  return nearest.distance <= 55 ? nearest.hint.type : undefined;
}

function xForMatch(line: PdfLine, start: number, end: number): number {
  const overlapping = line.segments.find(
    (segment) => Math.max(segment.start, start) < Math.min(segment.end, end)
  );

  if (overlapping) return overlapping.x;

  const minX = Math.min(...line.items.map((item) => item.x));
  const maxX = Math.max(...line.items.map((item) => item.x + item.width));
  const ratio = start / Math.max(line.text.length, 1);
  return minX + (maxX - minX) * ratio;
}

function isNoiseLine(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.length < 4 ||
    /^(page\s+\d+|statement period|opening balance|closing balance|total deposits|total withdrawals)/i.test(
      lower
    ) ||
    /(account number|customer service|www\.|\.com|important information)/i.test(lower)
  );
}

function shouldAppendContinuation(text: string): boolean {
  if (isNoiseLine(text)) return false;
  if (/^(date|description|transaction|balance|amount|debit|credit)\b/i.test(text)) return false;
  return true;
}

function dedupeHints(hints: ColumnHint[]): ColumnHint[] {
  const output: ColumnHint[] = [];

  for (const hint of hints.sort((a, b) => a.x - b.x)) {
    const existing = output.find(
      (item) => item.type === hint.type && Math.abs(item.x - hint.x) < 18
    );
    if (!existing) output.push(hint);
  }

  return output;
}

function extractMerchant(description: string): string {
  return normalizeWhitespace(
    description
      .replace(/\b(pos|debit card|card purchase|online transfer|ach|eft|visa|mastercard)\b/gi, " ")
      .replace(/\b\d{4,}\b/g, " ")
      .replace(/\s[-*#]\s.*$/g, " ")
  )
    .trim()
    .slice(0, 80);
}

function buildFingerprint(date: string, amount: number, description: string): string {
  return `${date}|${toCents(amount)}|${normalizeDescription(description).slice(0, 80)}`;
}

function normalizeDescription(value: string): string {
  return normalizeWhitespace(value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")).trim();
}

function descriptionSimilarity(a: string, b: string): number {
  const aTokens = new Set(normalizeDescription(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeDescription(b).split(" ").filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;

  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection / union;
}

function looksLikeTransfer(value: string): boolean {
  return /(transfer|payment|autopay|ach|e-transfer|online banking|card payment|thank you|xfer)/i.test(
    value
  );
}

function looksLikeCreditCardPayment(value: string): boolean {
  return /(payment|autopay|thank you|credit received|refund|reversal|cashback|adjustment)/i.test(
    value
  );
}

function looksLikeCharge(value: string): boolean {
  return /(purchase|charge|fee|interest|restaurant|store|pos|card)/i.test(value);
}

function normalizeYear(year: number): number {
  if (year < 100) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function daysBetween(a: Date | string, b: Date | string): number {
  const first = new Date(a);
  const second = new Date(b);
  const ms = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  const other = Date.UTC(second.getUTCFullYear(), second.getUTCMonth(), second.getUTCDate());
  return Math.round((ms - other) / 86_400_000);
}

function toCents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
