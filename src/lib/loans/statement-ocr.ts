/**
 * Loan statement OCR (improvement plan Phase 3, item 3) — photograph
 * the lender statement (the Ford Credit case) and the loan tool
 * drafts the schedule check for review.
 *
 * This is NOT a second OCR stack. It reuses the receipt capture
 * provider layer end to end:
 *   - the same env configuration (AZURE_DOCUMENT_INTELLIGENCE_*),
 *   - the same Azure submit→poll transport
 *     (`analyzeDocumentWithAzure` in the receipts provider file),
 *   - the same ExtractedField / confidence conventions — a field the
 *     model did not find is { value: null, confidence: null }, never
 *     invented,
 *   - the same pipeline status lifecycle (pending → extracted |
 *     failed | unavailable) in statement-pipeline.ts.
 *
 * What differs is only the mapping: a loan statement is read with
 * Azure's prebuilt-layout model, whose key-value pairs ("Current
 * Balance", "Regular Payment Amount", "Next Payment Due Date", …)
 * are mapped onto loan fields by the pure mapper below. Lender
 * statements print labels, not a fixed schema — the synonym sets are
 * the mapping, and every unmapped field simply stays null for the
 * reviewer to type.
 */
import {
  analyzeDocumentWithAzure,
  azureConfigFromEnv,
  AZURE_DI_MIME_TYPES,
  AZURE_DI_PROVIDER_ID,
  type AzureProviderConfig,
} from '@/lib/receipts/azure-document-intelligence';
import {
  emptyField,
  type ExtractedField,
} from '@/lib/receipts/ocr-provider';
import { parseReceiptDate, round2 } from '@/lib/receipts/parse';

export const AZURE_DI_LAYOUT_MODEL = 'prebuilt-layout';

export interface LoanStatementExtraction {
  lenderName: ExtractedField<string>;
  /** ISO date (yyyy-mm-dd) the statement was cut at. */
  statementDate: ExtractedField<string>;
  /** Balance owing at the statement date, dollars. */
  currentBalance: ExtractedField<number>;
  /** The regular payment the statement states, dollars. */
  paymentAmount: ExtractedField<number>;
  /** Nominal annual rate, percent (6.99 = 6.99%), when printed. */
  annualRatePct: ExtractedField<number>;
  /** ISO date (yyyy-mm-dd) of the next payment due. */
  nextPaymentDate: ExtractedField<string>;
  /** Account / reference number as printed. Serializers mask it. */
  accountNumber: ExtractedField<string>;
}

export function emptyLoanStatementExtraction(): LoanStatementExtraction {
  return {
    lenderName: emptyField<string>(),
    statementDate: emptyField<string>(),
    currentBalance: emptyField<number>(),
    paymentAmount: emptyField<number>(),
    annualRatePct: emptyField<number>(),
    nextPaymentDate: emptyField<string>(),
    accountNumber: emptyField<string>(),
  };
}

export interface LoanStatementOcrProvider {
  /** Same provider id as the receipt reader — one service, two mappings. */
  id: string;
  isConfigured(): boolean;
  extract(input: { buffer: Buffer; mimeType: string }): Promise<LoanStatementExtraction>;
}

export function createAzureLoanStatementProvider(config: AzureProviderConfig): LoanStatementOcrProvider {
  return {
    id: AZURE_DI_PROVIDER_ID,
    isConfigured: () => Boolean(config.endpoint?.trim() && config.key),
    async extract({ buffer, mimeType }) {
      if (!(AZURE_DI_MIME_TYPES as readonly string[]).includes(mimeType)) {
        throw new Error(`Azure Document Intelligence cannot read ${mimeType} documents.`);
      }
      const result = await analyzeDocumentWithAzure(config, AZURE_DI_LAYOUT_MODEL, { buffer, mimeType });
      return mapLoanStatementResult(result);
    },
  };
}

/** Build the provider from env, or null when either variable is absent. */
export function createAzureLoanStatementProviderFromEnv(
  env: NodeJS.ProcessEnv,
): LoanStatementOcrProvider | null {
  const config = azureConfigFromEnv(env);
  if (!config) return null;
  return createAzureLoanStatementProvider(config);
}

/**
 * The configured provider, or null when none is configured — the
 * statement pipeline's 'unavailable' state (document stored, manual
 * path unchanged, nothing fabricated) depends on this returning null.
 */
export function resolveLoanStatementProvider(
  env: NodeJS.ProcessEnv = process.env,
): LoanStatementOcrProvider | null {
  return createAzureLoanStatementProviderFromEnv(env);
}

// ─── Account-number masking ─────────────────────────────────────────
// The full number stays in the stored read (the reviewer verifies it
// against the paper); everything that crosses the API is masked to
// the last four, the card-statement convention.

export function accountNumberLast4(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/[\s-]/g, '');
  if (compact.length < 4) return null;
  return compact.slice(-4);
}

export function maskAccountNumber(value: string | null | undefined): string | null {
  const last4 = accountNumberLast4(value);
  return last4 ? `••••${last4}` : null;
}

// ─── Key-value mapping (pure) ───────────────────────────────────────

const clampConfidence = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;

/** "Account Number:" / "Annual Percentage Rate (APR)" → comparable label. */
function normalizeKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface KeyValuePair {
  key: string;
  value: string;
  confidence: number | null;
}

function keyValuePairsOf(result: any): KeyValuePair[] {
  const pairs = result?.analyzeResult?.keyValuePairs;
  if (!Array.isArray(pairs)) return [];
  const out: KeyValuePair[] = [];
  for (const pair of pairs) {
    const key = normalizeKey(pair?.key?.content);
    const value = typeof pair?.value?.content === 'string' ? pair.value.content.trim() : '';
    if (!key || !value) continue;
    out.push({
      key,
      value,
      confidence: clampConfidence(pair?.value?.confidence) ?? clampConfidence(pair?.key?.confidence),
    });
  }
  return out;
}

type FieldName = keyof LoanStatementExtraction;

const EXACT_LABELS: Record<FieldName, string[]> = {
  lenderName: ['lender', 'lender name', 'creditor', 'creditor name', 'loan servicer', 'servicer', 'finance company'],
  statementDate: ['statement date', 'statement period ending', 'statement period end', 'statement ending date', 'billing date'],
  currentBalance: [
    'current balance', 'total balance', 'loan balance', 'principal balance',
    'outstanding balance', 'remaining balance', 'balance owed', 'unpaid balance', 'total loan balance',
  ],
  paymentAmount: [
    'regular payment amount', 'regular payment', 'payment amount', 'monthly payment amount',
    'monthly payment', 'scheduled payment amount', 'scheduled payment', 'amount due', 'total amount due',
  ],
  annualRatePct: [
    'annual percentage rate', 'interest rate', 'apr', 'nominal interest rate',
    'rate of interest', 'annual interest rate', 'contract rate',
  ],
  nextPaymentDate: [
    'next payment due date', 'next payment date', 'next due date',
    'payment due date', 'due date', 'payment due', 'next payment due',
  ],
  accountNumber: [
    'account number', 'account', 'acct number', 'acct', 'loan number',
    'loan account number', 'customer number', 'reference number', 'agreement number',
  ],
};

/** Distinctive phrases for the fallback pass, checked in this order. */
const CONTAINS_LABELS: [FieldName, string[]][] = [
  ['currentBalance', ['current balance', 'outstanding balance', 'principal balance', 'remaining balance']],
  ['nextPaymentDate', ['next payment', 'due date']],
  ['paymentAmount', ['regular payment', 'amount due', 'payment amount']],
  ['statementDate', ['statement date', 'statement period']],
  ['annualRatePct', ['interest rate', 'percentage rate']],
  ['accountNumber', ['account number', 'loan number']],
  ['lenderName', ['lender']],
];

function findPair(pairs: KeyValuePair[], field: FieldName): KeyValuePair | null {
  const exact = EXACT_LABELS[field];
  for (const pair of pairs) {
    if (exact.includes(pair.key)) return pair;
  }
  const phrases = CONTAINS_LABELS.find(([f]) => f === field)?.[1] ?? [];
  for (const pair of pairs) {
    if (phrases.some((p) => pair.key.includes(p))) return pair;
  }
  return null;
}

function parseMoneyValue(content: string): number | null {
  const cleaned = content.replace(/[$,\s]/g, '');
  const negative = /^\(.*\)$/.test(cleaned);
  const numeric = Number(cleaned.replace(/[()]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return round2(negative ? -numeric : numeric);
}

function parseRateValue(content: string): number | null {
  const m = content.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return Number(m[1]);
  const bare = Number(content.replace(/[^0-9.]/g, ''));
  return Number.isFinite(bare) && bare > 0 ? bare : null;
}

/**
 * A statement-period value ("10/16/2026 - 11/15/2026") names a range;
 * the statement date is its END. parseReceiptDate finds the first
 * date in a string, so ranges are split and the last segment parsed.
 */
function parseDateValue(content: string, takeLast: boolean): string | null {
  if (takeLast) {
    const segments = content.split(/\s+[-–—]\s+|\s+to\s+/i).filter(Boolean);
    if (segments.length > 1) {
      const parsed = parseReceiptDate(segments[segments.length - 1]);
      if (parsed) return parsed;
    }
  }
  return parseReceiptDate(content);
}

/**
 * Map one succeeded prebuilt-layout analyze result to the loan
 * statement shape. Labels that are absent — or whose values do not
 * parse — stay { value: null, confidence: null }: the read never
 * guesses a number the paper did not print.
 */
export function mapLoanStatementResult(result: any): LoanStatementExtraction {
  const extraction = emptyLoanStatementExtraction();
  const pairs = keyValuePairsOf(result);
  if (pairs.length === 0) return extraction;

  const lender = findPair(pairs, 'lenderName');
  if (lender) extraction.lenderName = { value: lender.value, confidence: lender.confidence };

  const statementDate = findPair(pairs, 'statementDate');
  if (statementDate) {
    const parsed = parseDateValue(statementDate.value, statementDate.key.includes('period'));
    if (parsed) extraction.statementDate = { value: parsed, confidence: statementDate.confidence };
  }

  const balance = findPair(pairs, 'currentBalance');
  if (balance) {
    const parsed = parseMoneyValue(balance.value);
    if (parsed !== null) extraction.currentBalance = { value: parsed, confidence: balance.confidence };
  }

  const payment = findPair(pairs, 'paymentAmount');
  if (payment) {
    const parsed = parseMoneyValue(payment.value);
    if (parsed !== null) extraction.paymentAmount = { value: parsed, confidence: payment.confidence };
  }

  const rate = findPair(pairs, 'annualRatePct');
  if (rate) {
    const parsed = parseRateValue(rate.value);
    if (parsed !== null) extraction.annualRatePct = { value: parsed, confidence: rate.confidence };
  }

  const nextDate = findPair(pairs, 'nextPaymentDate');
  if (nextDate) {
    const parsed = parseDateValue(nextDate.value, false);
    if (parsed) extraction.nextPaymentDate = { value: parsed, confidence: nextDate.confidence };
  }

  const account = findPair(pairs, 'accountNumber');
  if (account) extraction.accountNumber = { value: account.value, confidence: account.confidence };

  return extraction;
}
