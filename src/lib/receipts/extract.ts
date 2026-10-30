/**
 * Receipt text extraction — turns an uploaded file into raw text for
 * `parseReceiptText`. Best-effort by design: any failure returns
 * method 'none' and the receipt is still stored; the user types the
 * fields in the inbox. OCR is an accelerator, never a gate.
 *
 * - PDF: unpdf (a current pdf.js build) — text-based PDF receipts and
 *   emailed invoices extract deterministically, including modern PDFs
 *   with compressed cross-reference streams that the previous
 *   pdf-parse 1.x reader could not open at all.
 * - Images: read in the user's browser (see client-ocr.ts) and sent
 *   with the upload. The server-side tesseract.js path below remains
 *   only as a fallback for clients that send no text — and it is
 *   strictly time-bounded, because tesseract's worker never completes
 *   inside the serverless function (verified live 2026-10-29: photo
 *   uploads hung until the request died and no receipt was stored).
 *
 * Every extraction is wrapped in a timeout: an upload must NEVER hang
 * waiting for text. Worst case the receipt lands in the inbox for
 * manual entry, exactly as the design intends.
 */

export interface ExtractedText {
  text: string;
  method: 'pdf-text' | 'tesseract' | 'none';
  error?: string;
}

/** Hard cap on any single server-side extraction attempt. */
export const EXTRACTION_TIMEOUT_MS = 20_000;

/**
 * Race a promise against a deadline. Exported for tests. The losing
 * promise is left to settle on its own; callers treat the timeout as
 * a plain extraction failure.
 */
export async function withExtractionTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Text extraction timed out after ${Math.round(ms / 1000)}s.`)),
      ms,
    );
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function extractReceiptText(
  buffer: Buffer,
  mimeType: string,
  opts?: { timeoutMs?: number },
): Promise<ExtractedText> {
  const timeoutMs = opts?.timeoutMs ?? EXTRACTION_TIMEOUT_MS;
  try {
    return await withExtractionTimeout(extract(buffer, mimeType), timeoutMs);
  } catch (err: any) {
    return { text: '', method: 'none', error: err?.message ?? 'Text extraction failed.' };
  }
}

async function extract(buffer: Buffer, mimeType: string): Promise<ExtractedText> {
  if (mimeType === 'application/pdf') {
    try {
      const { getDocumentProxy, extractText } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text: raw } = await extractText(pdf, { mergePages: true });
      const text = (typeof raw === 'string' ? raw : '').trim();
      return text
        ? { text, method: 'pdf-text' }
        : { text: '', method: 'none', error: 'No selectable text in the PDF (scanned image PDFs need photo OCR).' };
    } catch (err: any) {
      return { text: '', method: 'none', error: err?.message ?? 'PDF text extraction failed.' };
    }
  }

  // Image path — tesseract.js fallback (the browser normally reads
  // photos client-side and sends the text with the upload). Lazily and
  // defensively loaded; the caller's timeout bounds the whole attempt.
  try {
    const tesseract = (await import('tesseract.js')) as any;
    const createWorker = tesseract.createWorker ?? tesseract.default?.createWorker;
    if (!createWorker) throw new Error('tesseract.js is unavailable.');
    const worker = await createWorker('eng');
    try {
      const { data } = await worker.recognize(buffer);
      const text = (data?.text ?? '').trim();
      return text
        ? { text, method: 'tesseract' }
        : { text: '', method: 'none', error: 'OCR found no text in the image.' };
    } finally {
      await worker.terminate?.();
    }
  } catch (err: any) {
    return { text: '', method: 'none', error: err?.message ?? 'Image OCR is unavailable.' };
  }
}
