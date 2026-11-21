/**
 * Upload validation for loan statement files — pure, shared by the
 * API route and the import UI copy. Mirrors the receipt validator's
 * limits (receipts/validate.ts): the formats lender statements
 * actually arrive in, with a hard size cap because v1 stores the
 * bytes in Postgres.
 */

export const LOAN_STATEMENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const LOAN_STATEMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type StatementUploadValidation = { ok: true } | { ok: false; error: string };

export function validateLoanStatementUpload(input: {
  mimeType: string;
  sizeBytes: number;
}): StatementUploadValidation {
  if (!input.sizeBytes || input.sizeBytes <= 0) {
    return { ok: false, error: 'That file is empty.' };
  }
  if (input.sizeBytes > LOAN_STATEMENT_MAX_BYTES) {
    return { ok: false, error: 'Statement files are limited to 5 MB. Try a smaller photo or a compressed PDF.' };
  }
  if (input.mimeType === 'image/heic' || input.mimeType === 'image/heif') {
    return {
      ok: false,
      error:
        'iPhone HEIC photos are not supported yet. In the Camera app settings choose "Most Compatible" (JPEG), or share the photo as a PDF.',
    };
  }
  if (!(LOAN_STATEMENT_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return { ok: false, error: 'Only JPEG, PNG, WebP, or PDF statements are supported.' };
  }
  return { ok: true };
}

/** Extensions accepted by the import file input (mirrors the mime list). */
export const LOAN_STATEMENT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
