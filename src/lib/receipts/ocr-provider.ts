/**
 * Receipt OCR provider abstraction (Phase 2 item 2 — improvement plan
 * Phase 2 §2: "Receipt/bill OCR via API → draft entries with the source
 * document attached").
 *
 * The existing text pipeline (extract.ts + parse.ts) reads what it can
 * with pdf text / tesseract and produces one blended confidence. This
 * layer is the step up the receipt-capture design always pointed at: a
 * real document-intelligence API that returns STRUCTURED fields, each
 * with the model's own confidence, so the reviewer can see which
 * fields to trust and which to double-check.
 *
 * Contract rules:
 * - A provider NEVER invents a value. A field it did not find is
 *   `{ value: null, confidence: null }`.
 * - Configuration comes purely from env. When no provider is
 *   configured, `resolveReceiptOcrProvider()` returns null and the
 *   pipeline marks the receipt 'unavailable' — the document is still
 *   stored and reviewed exactly as before this feature existed.
 */

export interface ExtractedField<T> {
  value: T | null;
  /** Model confidence 0–1 for this field, or null when not reported. */
  confidence: number | null;
}

export interface ExtractedLineItem {
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  /** Line total as printed (the extension), when the model found one. */
  amount: number | null;
  confidence: number | null;
}

/** The structured read of one receipt/invoice document. */
export interface ReceiptExtraction {
  vendor: ExtractedField<string>;
  /** ISO date (yyyy-mm-dd). */
  date: ExtractedField<string>;
  total: ExtractedField<number>;
  subtotal: ExtractedField<number>;
  /** All document taxes summed (GST/HST + PST/QST/...). */
  taxAmount: ExtractedField<number>;
  /** ISO 4217 code (e.g. "CAD"), when the document states one. */
  currency: ExtractedField<string>;
  lineItems: ExtractedLineItem[];
}

import { createAzureProviderFromEnv } from './azure-document-intelligence';

export interface ReceiptOcrProvider {
  /** Stable id stored on the receipt row (e.g. 'azure-document-intelligence'). */
  id: string;
  isConfigured(): boolean;
  extract(input: { buffer: Buffer; mimeType: string }): Promise<ReceiptExtraction>;
}

/**
 * Below this confidence a field is highlighted for the reviewer's eye
 * in the inbox UI. The model said it, but it is not sure — exactly the
 * fields a human should check first.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.8;

export const emptyField = <T,>(): ExtractedField<T> => ({ value: null, confidence: null });

export function emptyExtraction(): ReceiptExtraction {
  return {
    vendor: emptyField<string>(),
    date: emptyField<string>(),
    total: emptyField<number>(),
    subtotal: emptyField<number>(),
    taxAmount: emptyField<number>(),
    currency: emptyField<string>(),
    lineItems: [],
  };
}

/**
 * The configured provider, or null when none is configured. Today the
 * only concrete implementation is Azure Document Intelligence; the
 * resolver is the single place a second provider (Textract, ...) would
 * be selected.
 */
export function resolveReceiptOcrProvider(
  env: NodeJS.ProcessEnv = process.env,
): ReceiptOcrProvider | null {
  return createAzureProviderFromEnv(env);
}
