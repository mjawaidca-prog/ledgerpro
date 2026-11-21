/**
 * Azure Document Intelligence provider — prebuilt receipt model over
 * the REST API (api-version 2024-11-30). Configured purely from env:
 *
 *   AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT  e.g. https://<resource>.cognitiveservices.azure.com
 *   AZURE_DOCUMENT_INTELLIGENCE_KEY       the resource key
 *
 * When either is absent the provider does not exist (the resolver in
 * ocr-provider.ts returns null) and receipts are marked 'unavailable'
 * — never a fabricated read.
 *
 * The response mapper (`mapAzureAnalyzeResult`) is pure and separate
 * from the network path so fixtures can pin the field mapping without
 * a network. Azure field shapes (prebuilt-receipt):
 *   MerchantName    { type:'string',  valueString, confidence }
 *   TransactionDate { type:'date',    valueDate: 'yyyy-mm-dd', confidence }
 *   Subtotal/Total/TotalTax { type:'currency', valueCurrency:{amount, currencyCode}, confidence }
 *                   (older responses may carry valueNumber instead)
 *   TaxDetails      { type:'array', valueArray:[{ type:'object',
 *                     valueObject:{ Amount:{...currency...} } }] }
 *   Items           { type:'array', valueArray:[{ type:'object', valueObject:{
 *                     Description:{valueString}, Quantity:{valueNumber},
 *                     Price:{...currency...}, TotalPrice:{...currency...} } }] }
 */
import {
  emptyExtraction,
  type ExtractedField,
  type ExtractedLineItem,
  type ReceiptExtraction,
  type ReceiptOcrProvider,
} from './ocr-provider';
import { parseReceiptDate, round2 } from './parse';
import { withExtractionTimeout } from './extract';

export const AZURE_DI_PROVIDER_ID = 'azure-document-intelligence';
export const AZURE_DI_API_VERSION = '2024-11-30';
export const AZURE_DI_MODEL = 'prebuilt-receipt';

/** Hard cap on submit + polling for one document. */
export const AZURE_DI_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

/** Document types the prebuilt receipt model accepts. WebP is NOT one
 *  of them — those receipts keep the text pipeline's read instead of a
 *  guaranteed-failed API call. */
export const AZURE_DI_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/bmp', 'image/tiff'] as const;

type FetchLike = (url: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<any>;
  text(): Promise<string>;
}>;

export interface AzureProviderConfig {
  endpoint: string;
  key: string;
  fetchImpl?: FetchLike;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/** Build the provider from env, or null when either variable is absent. */
export function createAzureProviderFromEnv(env: NodeJS.ProcessEnv): ReceiptOcrProvider | null {
  const endpoint = env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim();
  const key = env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim();
  if (!endpoint || !key) return null;
  return createAzureDocumentIntelligenceProvider({ endpoint, key });
}

export function createAzureDocumentIntelligenceProvider(config: AzureProviderConfig): ReceiptOcrProvider {
  const endpoint = config.endpoint.replace(/\/+$/, '');
  const fetchImpl: FetchLike = config.fetchImpl ?? ((url, init) => fetch(url, init) as any);
  const pollIntervalMs = config.pollIntervalMs ?? POLL_INTERVAL_MS;

  return {
    id: AZURE_DI_PROVIDER_ID,
    isConfigured: () => Boolean(endpoint && config.key),
    async extract({ buffer, mimeType }) {
      if (!(AZURE_DI_MIME_TYPES as readonly string[]).includes(mimeType)) {
        throw new Error(`Azure Document Intelligence cannot read ${mimeType} documents.`);
      }
      const timeoutMs = config.timeoutMs ?? AZURE_DI_TIMEOUT_MS;
      return withExtractionTimeout(
        (async () => {
          const submit = await fetchImpl(
            `${endpoint}/documentintelligence/documentModels/${AZURE_DI_MODEL}:analyze?api-version=${AZURE_DI_API_VERSION}`,
            {
              method: 'POST',
              headers: {
                'Ocp-Apim-Subscription-Key': config.key,
                'Content-Type': mimeType,
              },
              body: buffer,
            },
          );
          if (submit.status !== 202) {
            const detail = await submit.text().catch(() => '');
            throw new Error(`Azure Document Intelligence rejected the document (HTTP ${submit.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
          }
          const operationUrl = submit.headers.get('Operation-Location') ?? submit.headers.get('operation-location');
          if (!operationUrl) throw new Error('Azure Document Intelligence did not return an operation URL.');

          // Poll the operation until it settles. The caller's timeout
          // bounds the race; this deadline also stops the loop itself
          // so an abandoned poll never runs on in the background.
          const deadline = Date.now() + timeoutMs;
          for (;;) {
            if (Date.now() > deadline) {
              throw new Error(`Azure Document Intelligence timed out after ${Math.round(timeoutMs / 1000)}s.`);
            }
            const poll = await fetchImpl(operationUrl, {
              headers: { 'Ocp-Apim-Subscription-Key': config.key },
            });
            if (!poll.ok) throw new Error(`Azure Document Intelligence polling failed (HTTP ${poll.status}).`);
            const result = await poll.json();
            if (result.status === 'succeeded') {
              return mapAzureAnalyzeResult(result);
            }
            if (result.status === 'failed') {
              const message = result.error?.message ?? 'The document could not be read.';
              throw new Error(`Azure Document Intelligence failed: ${message}`);
            }
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          }
        })(),
        timeoutMs,
      );
    },
  };
}

// ─── Response mapping (pure) ────────────────────────────────────────

const clampConfidence = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;

function moneyOf(field: any): { amount: number | null; currencyCode: string | null; confidence: number | null } {
  if (!field || typeof field !== 'object') return { amount: null, currencyCode: null, confidence: null };
  const confidence = clampConfidence(field.confidence);
  const vc = field.valueCurrency;
  if (vc && typeof vc.amount === 'number' && Number.isFinite(vc.amount)) {
    return { amount: round2(vc.amount), currencyCode: typeof vc.currencyCode === 'string' ? vc.currencyCode : null, confidence };
  }
  if (typeof field.valueNumber === 'number' && Number.isFinite(field.valueNumber)) {
    return { amount: round2(field.valueNumber), currencyCode: null, confidence };
  }
  if (typeof field.valueString === 'string') {
    const parsed = Number(field.valueString.replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(parsed)) return { amount: round2(parsed), currencyCode: null, confidence };
  }
  return { amount: null, currencyCode: null, confidence };
}

function stringField(field: any): ExtractedField<string> {
  if (!field || typeof field !== 'object') return { value: null, confidence: null };
  const value =
    typeof field.valueString === 'string' && field.valueString.trim()
      ? field.valueString.trim()
      : typeof field.content === 'string' && field.content.trim()
        ? field.content.trim()
        : null;
  return { value, confidence: clampConfidence(field.confidence) };
}

function dateField(field: any): ExtractedField<string> {
  if (!field || typeof field !== 'object') return { value: null, confidence: null };
  const confidence = clampConfidence(field.confidence);
  if (typeof field.valueDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(field.valueDate)) {
    return { value: field.valueDate.slice(0, 10), confidence };
  }
  // Fall back to the printed content, read by the same date parser the
  // text pipeline trusts.
  if (typeof field.content === 'string') {
    const parsed = parseReceiptDate(field.content);
    if (parsed) return { value: parsed, confidence };
  }
  return { value: null, confidence };
}

function moneyField(field: any): ExtractedField<number> {
  const { amount, confidence } = moneyOf(field);
  return { value: amount, confidence };
}

function taxField(fields: Record<string, any>): ExtractedField<number> {
  const direct = moneyOf(fields.TotalTax);
  if (direct.amount !== null) return { value: direct.amount, confidence: direct.confidence };

  // No TotalTax: sum the TaxDetails amounts. Confidence is the LOWEST
  // part's — the sum is only as trustworthy as its weakest component.
  const details = fields.TaxDetails?.valueArray;
  if (Array.isArray(details) && details.length) {
    let sum = 0;
    let confidence: number | null = null;
    let found = false;
    for (const entry of details) {
      const amount = moneyOf(entry?.valueObject?.Amount ?? entry?.valueObject?.amount);
      if (amount.amount !== null) {
        sum += amount.amount;
        found = true;
        if (amount.confidence !== null) {
          confidence = confidence === null ? amount.confidence : Math.min(confidence, amount.confidence);
        }
      }
    }
    if (found) return { value: round2(sum), confidence };
  }
  return { value: null, confidence: null };
}

function lineItemsOf(field: any): ExtractedLineItem[] {
  const items = field?.valueArray;
  if (!Array.isArray(items)) return [];
  const out: ExtractedLineItem[] = [];
  for (const entry of items) {
    const obj = entry?.valueObject ?? {};
    const description = stringField(obj.Description);
    const quantity =
      typeof obj.Quantity?.valueNumber === 'number' && Number.isFinite(obj.Quantity.valueNumber)
        ? obj.Quantity.valueNumber
        : null;
    const unitPrice = moneyOf(obj.Price);
    const amount = moneyOf(obj.TotalPrice);
    const confidences = [description.confidence, amount.confidence].filter((c): c is number => c !== null);
    out.push({
      description: description.value,
      quantity,
      unitPrice: unitPrice.amount,
      amount: amount.amount,
      confidence: confidences.length ? Math.min(...confidences) : clampConfidence(entry?.confidence),
    });
  }
  return out;
}

/**
 * Map one succeeded analyze response to the provider-neutral shape.
 * Takes the document with the highest overall confidence when the
 * model returns several (merged receipts); fields the model did not
 * find stay null — never guessed.
 */
export function mapAzureAnalyzeResult(result: any): ReceiptExtraction {
  const extraction = emptyExtraction();
  const documents = result?.analyzeResult?.documents;
  if (!Array.isArray(documents) || documents.length === 0) return extraction;

  const doc = documents.reduce((best: any, d: any) =>
    (d?.confidence ?? 0) > (best?.confidence ?? 0) ? d : best,
  documents[0]);
  const fields = doc?.fields ?? {};

  extraction.vendor = stringField(fields.MerchantName);
  extraction.date = dateField(fields.TransactionDate);
  extraction.subtotal = moneyField(fields.Subtotal);
  extraction.total = moneyField(fields.Total);
  extraction.taxAmount = taxField(fields);

  // Currency: prefer the Total's own currency code; fall back to any
  // other money field that carries one.
  const currencyCode =
    moneyOf(fields.Total).currencyCode ??
    moneyOf(fields.Subtotal).currencyCode ??
    moneyOf(fields.TotalTax).currencyCode ??
    null;
  extraction.currency = {
    value: currencyCode ? currencyCode.toUpperCase() : null,
    confidence: currencyCode ? clampConfidence(fields.Total?.confidence) : null,
  };

  extraction.lineItems = lineItemsOf(fields.Items);
  return extraction;
}
