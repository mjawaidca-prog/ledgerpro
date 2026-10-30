/**
 * Browser-side receipt OCR.
 *
 * tesseract.js is built for the browser: it loads its engine and
 * language data from a CDN and runs recognition in a Web Worker. The
 * same library never completes inside the serverless function that
 * handles uploads (verified live 2026-10-29 — photo uploads hung and
 * no receipt was stored), so photos are read HERE, on the user's
 * device, and the extracted text is sent with the upload for the
 * server to parse.
 *
 * Best-effort by design: any failure returns '' and the upload simply
 * proceeds without text (the receipt lands in the inbox for manual
 * entry). Client OCR is an accelerator, never a gate.
 */
export async function readReceiptTextInBrowser(file: File): Promise<string> {
  try {
    const tesseract = (await import('tesseract.js')) as any;
    const createWorker = tesseract.createWorker ?? tesseract.default?.createWorker;
    if (!createWorker) return '';
    const worker = await createWorker('eng');
    try {
      const { data } = await worker.recognize(file);
      return (data?.text ?? '').trim();
    } finally {
      await worker.terminate?.();
    }
  } catch {
    return '';
  }
}
