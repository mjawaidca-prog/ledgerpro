// Public API (v1) posting and voiding helpers for reviewed-tax documents.
// These mirror the dashboard's own flows exactly (same services, same
// guards), with the API key as the actor: the key's write_posting permission
// is the authorization, and the engine skips only the dashboard membership
// lookup — every accounting control stays identical.

import { db } from '@/lib/db';
import { postTaxDocument, reverseTaxPosting, TaxPostingError } from '@/lib/tax/posting-service';
import { closedPeriodGuard } from '@/lib/api-helpers';
import { moneyString } from '@/lib/api/serialize';
import type { Prisma } from '@prisma/client';

export interface PostDocumentInput {
  kind: 'invoice' | 'bill';
  id: string;
  companyId: string;
  apiKeyId: string;
  requestKey: string;
  taxDecisions: { lineIndex: number; taxCodeVersionId: string; jurisdictionEvidence: Record<string, unknown> }[];
}

export type PostResult =
  | { ok: true; document: { id: string; status: string; subtotal: string; taxAmount: string; total: string } }
  | { ok: false; status: number; code: string; message: string };

/**
 * Posts a draft document through the reviewed-tax engine: builds the server-
 * verified selections, posts the tax document (which journals the full
 * entry), computes the document totals from the immutable snapshots, and
 * flips the status — all in one transaction.
 */
export async function postReviewedDocument(input: PostDocumentInput): Promise<PostResult> {
  const doc =
    input.kind === 'invoice'
      ? await db.invoice.findFirst({
          where: { id: input.id, companyId: input.companyId },
          include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
        })
      : await db.bill.findFirst({
          where: { id: input.id, companyId: input.companyId },
          include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
        });

  if (!doc) return { ok: false, status: 404, code: 'not_found', message: `${input.kind === 'invoice' ? 'Invoice' : 'Bill'} not found.` };
  if (doc.status !== 'draft') {
    return { ok: false, status: 409, code: 'document_not_draft', message: `Only draft documents can be posted (current status: ${doc.status}).` };
  }
  if (input.taxDecisions.length !== doc.lineItems.length) {
    return { ok: false, status: 400, code: 'tax_decision_required', message: 'Choose a reviewed tax code and evidence for every document line.' };
  }

  const docDate = input.kind === 'invoice' ? (doc as any).issueDate : (doc as any).billDate;
  const guard = await closedPeriodGuard(input.companyId, docDate);
  if (guard) {
    const body = await guard.json();
    return { ok: false, status: 409, code: body.error?.code ?? 'closed_period', message: body.error?.message ?? body.error ?? 'Closed period.' };
  }

  try {
    const selections = doc.lineItems.map((line, index) => {
      const decision = input.taxDecisions.find((d) => d.lineIndex === index);
      if (!decision) {
        throw new TaxPostingError('line_selection_mismatch', `Line ${index} has no tax decision.`);
      }
      return {
        sourceLineId: line.id,
        taxCodeVersionId: decision.taxCodeVersionId,
        jurisdictionEvidence: decision.jurisdictionEvidence,
      };
    });

    const result = await db.$transaction(async (tx) => {
      const posting = await postTaxDocument(
        {
          companyId: input.companyId,
          userId: null,
          actor: { kind: 'api_key', keyId: input.apiKeyId },
          sourceKey: `${input.kind}:${input.id}:${input.requestKey}`,
          sourceType: input.kind,
          sourceId: input.id,
          description: `${input.kind === 'invoice' ? 'Invoice' : 'Bill'} ${input.id}`,
          lines: selections,
        },
        tx
      );

      // Document totals come from the immutable posted snapshots — the caller's
      // numbers are never trusted.
      const snapshots = await tx.documentLineTaxSnapshot.findMany({
        where: { postingId: posting.id },
        select: { netAmount: true, taxAmount: true, grossAmount: true },
      });
      const sum = (pick: (s: (typeof snapshots)[number]) => unknown) =>
        Math.round(snapshots.reduce((acc, s) => acc + Number(pick(s)), 0) * 100) / 100;

      const subtotal = sum((s) => s.netAmount);
      const taxAmount = sum((s) => s.taxAmount);
      const total = sum((s) => s.grossAmount);

      const updated =
        input.kind === 'invoice'
          ? await tx.invoice.update({
              where: { id: input.id },
              data: { status: 'sent', subtotal, taxAmount, total, taxRate: null, sentAt: new Date() },
              select: { id: true, status: true, subtotal: true, taxAmount: true, total: true },
            })
          : await tx.bill.update({
              where: { id: input.id },
              data: { status: 'open', subtotal, taxAmount, total, taxRate: null },
              select: { id: true, status: true, subtotal: true, taxAmount: true, total: true },
            });

      return {
        id: updated.id,
        status: updated.status,
        subtotal: moneyString(updated.subtotal),
        taxAmount: moneyString(updated.taxAmount),
        total: moneyString(updated.total),
      };
    });

    return { ok: true, document: result };
  } catch (err) {
    if (err instanceof TaxPostingError) {
      return { ok: false, status: err.status, code: err.code, message: err.message };
    }
    if ((err as any)?.message?.includes('already exists')) {
      return { ok: false, status: 409, code: 'document_already_posted', message: 'This document is already posted.' };
    }
    throw err;
  }
}

export interface VoidDocumentInput {
  kind: 'invoice' | 'bill';
  id: string;
  companyId: string;
  apiKeyId: string;
}

export type VoidResult =
  | { ok: true; id: string; status: string; mode: 'deleted_draft' | 'voided' }
  | { ok: false; status: number; code: string; message: string };

/**
 * Mirrors the dashboard void workflow: drafts are deleted; posted documents
 * are voided only when no payments or bank matches remain, through a tax
 * posting reversal — nothing is ever hard-deleted from the books.
 */
export async function voidReviewedDocument(input: VoidDocumentInput): Promise<VoidResult> {
  const existingTaxPosting = await db.taxPosting.findFirst({
    where: {
      companyId: input.companyId,
      journalEntry: { sourceId: input.id, sourceType: input.kind },
      reversalOfId: null,
    },
    include: { reversedBy: true },
  });

  const doc =
    input.kind === 'invoice'
      ? await db.invoice.findFirst({ where: { id: input.id, companyId: input.companyId }, select: { id: true, status: true, paidAmount: true } })
      : await db.bill.findFirst({ where: { id: input.id, companyId: input.companyId }, select: { id: true, status: true, paidAmount: true } });

  if (!doc) return { ok: false, status: 404, code: 'not_found', message: `${input.kind === 'invoice' ? 'Invoice' : 'Bill'} not found.` };
  if (doc.status === 'void') return { ok: true, id: doc.id, status: 'void', mode: 'voided' };

  // Drafts have no posted facts — delete like the dashboard does.
  if (!existingTaxPosting) {
    if (doc.status !== 'draft') {
      return { ok: false, status: 409, code: 'legacy_document', message: 'This document predates reviewed tax and cannot be voided through the API.' };
    }
    await db.$transaction(async (tx) => {
      if (input.kind === 'invoice') {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: input.id } });
        await tx.invoice.delete({ where: { id: input.id } });
      } else {
        await tx.billLineItem.deleteMany({ where: { billId: input.id } });
        await tx.bill.delete({ where: { id: input.id } });
      }
    });
    return { ok: true, id: doc.id, status: 'deleted', mode: 'deleted_draft' };
  }

  try {
    await db.$transaction(async (tx) => {
      // Serialize concurrent void/pay attempts on this document (both table
      // names come from a closed enum, never from request input).
      if (input.kind === 'invoice') {
        await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${input.id} AND "companyId" = ${input.companyId} FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT id FROM "Bill" WHERE id = ${input.id} AND "companyId" = ${input.companyId} FOR UPDATE`;
      }
      const current =
        input.kind === 'invoice'
          ? await tx.invoice.findUniqueOrThrow({ where: { id: input.id } })
          : await tx.bill.findUniqueOrThrow({ where: { id: input.id } });
      if (current.status === 'void') return;

      const payment = await tx.journalEntry.findFirst({
        where: { companyId: input.companyId, sourceId: input.id, sourceType: 'payment', voidedAt: null },
      });
      if (Number(current.paidAmount) !== 0 || payment) {
        throw new TaxPostingError('tax_settlement_reversal_required', 'Reverse the payments and bank matches before voiding this reviewed-tax document.', 409);
      }

      await reverseTaxPosting(
        {
          companyId: input.companyId,
          userId: null,
          actor: { kind: 'api_key', keyId: input.apiKeyId },
          postingId: existingTaxPosting.id,
          sourceKey: `${input.kind}-void:${input.id}`,
          reversalDate: new Date(),
          reason: 'voided via API',
        },
        tx
      );
      if (input.kind === 'invoice') {
        await tx.invoice.update({ where: { id: input.id }, data: { status: 'void' } });
      } else {
        await tx.bill.update({ where: { id: input.id }, data: { status: 'void' } });
      }
    });
    return { ok: true, id: doc.id, status: 'void', mode: 'voided' };
  } catch (err) {
    if (err instanceof TaxPostingError) {
      return { ok: false, status: err.status, code: err.code, message: err.message };
    }
    throw err;
  }
}
