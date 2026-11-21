/**
 * AI extraction pipeline (Phase 2 item 2) — runs a configured document
 * OCR provider over a stored receipt and records the outcome on the
 * receipt row:
 *
 *   extractionStatus: pending → extracted | failed | unavailable
 *
 * - 'unavailable': no provider is configured (env absent). The
 *   document stays stored; the ocr* suggestion fields keep whatever
 *   the text pipeline / the user provided. NOTHING is fabricated.
 * - 'failed': the provider was configured but the read errored. The
 *   error is kept in extractionError; the ocr* fields are untouched.
 * - 'extracted': the raw structured result (with per-field
 *   confidences) is stored verbatim in extractionFields, and the found
 *   values are mirrored into the existing ocr* suggestion columns so
 *   the inbox, attach and create-expense flows all benefit from the
 *   better read. Fields the model did not find never overwrite an
 *   existing value.
 *
 * The category suggestion is recomputed from the AI merchant/total
 * with the company's own rules (the same engines upload uses), unless
 * a human already picked the category ('manual' is never overridden).
 *
 * Async-safe by shape: the status is written by exactly one transition
 * per call, failures are captured on the row instead of thrown, and
 * the caller (upload flow) treats the whole run as best-effort — an
 * AI outage can never fail an upload.
 */
import { db } from '@/lib/db';
import { loadActiveCategorizationRules } from '@/lib/banking/categorization-apply';
import type { BankRuleLike } from '@/lib/banking/rules';
import { round2 } from './parse';
import { suggestForReceipt } from './suggest';
import {
  resolveReceiptOcrProvider,
  type ReceiptExtraction,
  type ReceiptOcrProvider,
} from './ocr-provider';

export type ReceiptExtractionStatus = 'pending' | 'extracted' | 'failed' | 'unavailable';

export interface ExtractionRunResult {
  status: ReceiptExtractionStatus;
  providerId: string | null;
  error: string | null;
}

/**
 * Overall confidence on the same 0–1 scale the text parser reports
 * (parse.ts weights: merchant .25 / date .25 / total .35 / tax .15) —
 * here each present field contributes its weight × the model's own
 * confidence, so the inbox's "% of fields found" line stays comparable
 * across both readers.
 */
export function overallExtractionConfidence(x: ReceiptExtraction): number | null {
  const weighted =
    0.25 * (x.vendor.confidence ?? 0) +
    0.25 * (x.date.confidence ?? 0) +
    0.35 * (x.total.confidence ?? 0) +
    0.15 * (x.taxAmount.confidence ?? 0);
  const anyFound =
    x.vendor.value !== null || x.date.value !== null || x.total.value !== null || x.taxAmount.value !== null;
  return anyFound ? round2(weighted) : null;
}

export async function runReceiptExtraction(
  args: { companyId: string; receiptId: string },
  deps?: { provider?: ReceiptOcrProvider | null },
): Promise<ExtractionRunResult> {
  const receipt = await (db as any).receipt.findFirst({
    where: { id: args.receiptId, companyId: args.companyId },
  });
  if (!receipt) return { status: 'pending', providerId: null, error: 'Receipt not found.' };

  const provider = deps && 'provider' in deps ? deps.provider : resolveReceiptOcrProvider();

  // Not configured: a first-class outcome, not an error. The document
  // is stored and reviewable; there is simply no AI read to offer.
  if (!provider || !provider.isConfigured()) {
    await (db as any).receipt.update({
      where: { id: receipt.id },
      data: { extractionStatus: 'unavailable', extractionProvider: null, extractionError: null },
    });
    return { status: 'unavailable', providerId: null, error: null };
  }

  if (receipt.storageBackend !== 'db' || !receipt.imageData) {
    const error = 'The stored document bytes are not readable from this backend yet.';
    await (db as any).receipt.update({
      where: { id: receipt.id },
      data: { extractionStatus: 'failed', extractionProvider: provider.id, extractionError: error },
    });
    return { status: 'failed', providerId: provider.id, error };
  }

  let extraction: ReceiptExtraction;
  try {
    extraction = await provider.extract({
      buffer: Buffer.from(receipt.imageData as Uint8Array),
      mimeType: receipt.mimeType as string,
    });
  } catch (err: any) {
    const error = (err?.message ?? 'The AI read failed.').slice(0, 500);
    await (db as any).receipt.update({
      where: { id: receipt.id },
      data: { extractionStatus: 'failed', extractionProvider: provider.id, extractionError: error },
    });
    return { status: 'failed', providerId: provider.id, error };
  }

  // Mirror found values into the suggestion columns the rest of the
  // product already reads. A null from the model NEVER overwrites.
  const data: Record<string, unknown> = {
    extractionStatus: 'extracted',
    extractionProvider: provider.id,
    extractionError: null,
    extractionFields: extraction as any,
  };
  if (extraction.vendor.value) data.ocrMerchant = extraction.vendor.value;
  if (extraction.date.value) data.ocrDate = new Date(`${extraction.date.value}T12:00:00Z`);
  if (extraction.total.value !== null) data.ocrTotal = extraction.total.value;
  if (extraction.subtotal.value !== null) data.ocrSubtotal = extraction.subtotal.value;
  if (extraction.taxAmount.value !== null) data.ocrTaxAmount = extraction.taxAmount.value;
  const overall = overallExtractionConfidence(extraction);
  if (overall !== null) {
    data.ocrConfidence = overall;
    data.ocrStatus = 'done';
  }

  // Recompute the category suggestion from the AI read (rules only —
  // the reviewer may already have a better merchant than the text
  // pipeline found). A human's manual pick is never overridden.
  if (receipt.suggestedSource !== 'manual' && (extraction.vendor.value || extraction.total.value !== null)) {
    try {
      const company = await db.company.findUnique({
        where: { id: args.companyId },
        select: { province: true },
      });
      const [catRules, bankRuleRows] = await Promise.all([
        loadActiveCategorizationRules(db, args.companyId).catch(() => []),
        db.bankRule.findMany({ where: { companyId: args.companyId }, orderBy: { order: 'asc' } }).catch(() => []),
      ]);
      const bankRules = (bankRuleRows as any[]).map((r) => ({
        ...r,
        setTaxRate: r.setTaxRate === null || r.setTaxRate === undefined ? null : Number(r.setTaxRate),
      })) as BankRuleLike[];
      const suggestion = suggestForReceipt({
        merchant: extraction.vendor.value ?? receipt.ocrMerchant ?? null,
        total: extraction.total.value ?? (receipt.ocrTotal !== null && receipt.ocrTotal !== undefined ? Number(receipt.ocrTotal) : null),
        province: company?.province ?? null,
        receiptTaxAmount: extraction.taxAmount.value ?? null,
        categorizationRules: catRules as any,
        bankRules,
      });
      let suggestedCategoryId = suggestion?.categoryId ?? null;
      if (!suggestedCategoryId && suggestion?.categoryCode) {
        const coa = await db.chartOfAccount.findFirst({
          where: { companyId: args.companyId, code: suggestion.categoryCode, active: true },
          select: { id: true },
        });
        suggestedCategoryId = coa?.id ?? null;
      }
      if (suggestedCategoryId) {
        data.suggestedCategoryId = suggestedCategoryId;
        data.suggestedSource = suggestion?.source ?? null;
      }
    } catch {
      // A suggestion failure never fails the extraction itself.
    }
  }

  await (db as any).receipt.update({ where: { id: receipt.id }, data });
  return { status: 'extracted', providerId: provider.id, error: null };
}
