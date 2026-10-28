/**
 * Receipt text extraction — turns an uploaded file into raw text for
 * `parseReceiptText`. Best-effort by design: any failure returns
 * method 'none' and the receipt is still stored; the user types the
 * fields in the inbox. OCR is an accelerator, never a gate.
 *
 * - PDF: pdf-parse (already a product dependency) — text-based PDF
 *   receipts and emailed invoices extract deterministically.
 * - Images: tesseract.js (free, open-source, no API keys) loaded lazily.
 *   If the package is not installed or recognition fails, we degrade to
 *   'none' instead of failing the upload.
 */

export interface ExtractedText {
  text: string;
  method: 'pdf-text' | 'tesseract' | 'none';
  error?: string;
}

export async function extractReceiptText(buffer: Buffer, mimeType: string): Promise<ExtractedText> {
  if (mimeType === 'application/pdf') {
    try {
      const pdfParse = (await import('pdf-parse')).default as any;
      const data = await pdfParse(buffer);
      const text = (data?.text ?? '').trim();
      return text
        ? { text, method: 'pdf-text' }
        : { text: '', method: 'none', error: 'No selectable text in the PDF (scanned image PDFs need photo OCR).' };
    } catch (err: any) {
      return { text: '', method: 'none', error: err?.message ?? 'PDF text extraction failed.' };
    }
  }

  // Image path — tesseract.js, lazily and defensively.
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
