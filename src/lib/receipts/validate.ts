/**
 * Upload validation for receipt files — pure, shared by the API route and
 * the inbox UI copy. v1 accepts the formats phone cameras and emailed
 * receipts actually arrive in, with a hard size cap because v1 stores the
 * bytes in Postgres (see DESIGN.md — storage decision).
 */

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const RECEIPT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type ReceiptMimeType = (typeof RECEIPT_MIME_TYPES)[number];

export type UploadValidation = { ok: true } | { ok: false; error: string };

export function validateReceiptUpload(input: { mimeType: string; sizeBytes: number }): UploadValidation {
  if (!input.sizeBytes || input.sizeBytes <= 0) {
    return { ok: false, error: 'That file is empty.' };
  }
  if (input.sizeBytes > RECEIPT_MAX_BYTES) {
    return { ok: false, error: 'Receipt files are limited to 5 MB. Try a smaller photo or a compressed PDF.' };
  }
  if (input.mimeType === 'image/heic' || input.mimeType === 'image/heif') {
    return {
      ok: false,
      error:
        'iPhone HEIC photos are not supported yet. In the Camera app settings choose "Most Compatible" (JPEG), or share the photo as a PDF.',
    };
  }
  if (!(RECEIPT_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return { ok: false, error: 'Only JPEG, PNG, WebP, or PDF receipts are supported.' };
  }
  return { ok: true };
}

/** Extensions accepted by the inbox file input (mirrors the mime list). */
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
