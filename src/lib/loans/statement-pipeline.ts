/**
 * Loan statement extraction pipeline (Phase 3, item 3) — the same
 * lifecycle as the receipt AI pipeline, deliberately:
 *
 *   extractionStatus: pending → extracted | failed | unavailable
 *
 * - 'unavailable': no provider is configured (env absent). The
 *   document stays stored; the manual loan path is unchanged.
 *   NOTHING is fabricated — the update carries no field values.
 * - 'failed': the provider was configured but the read errored; the
 *   error is kept in extractionError and no fields are written.
 * - 'extracted': the structured read (with per-field confidences) is
 *   stored verbatim in extractionFields. The loan itself is NOT
 *   touched — a statement becomes a draft/check for a reviewer, and
 *   only the apply step (statement-service.ts) may change a loan.
 *
 * Failures are captured on the row instead of thrown, and the upload
 * flow treats the whole run as best-effort — an AI outage can never
 * fail an upload.
 */
import { db } from '@/lib/db';
import {
  resolveLoanStatementProvider,
  type LoanStatementOcrProvider,
} from './statement-ocr';

export type LoanStatementExtractionStatus = 'pending' | 'extracted' | 'failed' | 'unavailable';

export interface LoanStatementExtractionRunResult {
  status: LoanStatementExtractionStatus;
  providerId: string | null;
  error: string | null;
}

export async function runLoanStatementExtraction(
  args: { companyId: string; statementId: string },
  deps?: { provider?: LoanStatementOcrProvider | null },
): Promise<LoanStatementExtractionRunResult> {
  const statement = await (db as any).loanStatement.findFirst({
    where: { id: args.statementId, companyId: args.companyId },
  });
  if (!statement) return { status: 'pending', providerId: null, error: 'Loan statement not found.' };

  const provider = deps && 'provider' in deps ? deps.provider : resolveLoanStatementProvider();

  // Not configured: a first-class outcome, not an error.
  if (!provider || !provider.isConfigured()) {
    await (db as any).loanStatement.update({
      where: { id: statement.id },
      data: { extractionStatus: 'unavailable', extractionProvider: null, extractionError: null },
    });
    return { status: 'unavailable', providerId: null, error: null };
  }

  if (statement.storageBackend !== 'db' || !statement.imageData) {
    const error = 'The stored document bytes are not readable from this backend yet.';
    await (db as any).loanStatement.update({
      where: { id: statement.id },
      data: { extractionStatus: 'failed', extractionProvider: provider.id, extractionError: error },
    });
    return { status: 'failed', providerId: provider.id, error };
  }

  try {
    const extraction = await provider.extract({
      buffer: Buffer.from(statement.imageData as Uint8Array),
      mimeType: statement.mimeType as string,
    });
    await (db as any).loanStatement.update({
      where: { id: statement.id },
      data: {
        extractionStatus: 'extracted',
        extractionProvider: provider.id,
        extractionError: null,
        extractionFields: extraction as any,
      },
    });
    return { status: 'extracted', providerId: provider.id, error: null };
  } catch (err: any) {
    const error = (err?.message ?? 'The AI read failed.').slice(0, 500);
    await (db as any).loanStatement.update({
      where: { id: statement.id },
      data: { extractionStatus: 'failed', extractionProvider: provider.id, extractionError: error },
    });
    return { status: 'failed', providerId: provider.id, error };
  }
}
