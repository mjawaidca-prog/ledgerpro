/**
 * Receipt service — the DB-facing half of receipt capture. The pure
 * halves (parse / suggest / validate) live in sibling modules; everything
 * here is company-scoped and never posts anything to the GL. Confirming a
 * receipt only LINKS it to a bank transaction and hands the UI a split
 * payload for the existing split endpoint (see attachReceipt).
 */
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { accountLockedGuard, closedPeriodGuard } from '@/lib/api-helpers';
import { makeDedupeKey } from '@/lib/banking/dedupe';
import { getDefaultFinancialAccountGlCode } from '@/lib/default-coa';
import { loadActiveCategorizationRules } from '@/lib/banking/categorization-apply';
import type { BankRuleLike } from '@/lib/banking/rules';
import { validateReceiptUpload } from './validate';
import { extractReceiptText, type ExtractedText } from './extract';
import { parseReceiptText } from './parse';
import { suggestForReceipt, buildReceiptSplit, type ReceiptSuggestion } from './suggest';

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** API-safe receipt shape: metadata + suggestion fields, never the bytes. */
export function serializeReceipt(r: any) {
  return {
    id: r.id,
    companyId: r.companyId,
    transactionId: r.transactionId ?? null,
    originalFileName: r.originalFileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    status: r.status,
    ocrStatus: r.ocrStatus,
    merchant: r.ocrMerchant ?? null,
    date: r.ocrDate ? new Date(r.ocrDate).toISOString().slice(0, 10) : null,
    total: num(r.ocrTotal),
    subtotal: num(r.ocrSubtotal),
    taxAmount: num(r.ocrTaxAmount),
    confidence: num(r.ocrConfidence),
    suggestedCategoryId: r.suggestedCategoryId ?? null,
    suggestedCategoryCode: r.suggestedCategory?.code ?? null,
    suggestedSource: r.suggestedSource ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function createReceiptFromUpload(args: {
  companyId: string;
  userId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  /**
   * Text read in the user's browser (client-side OCR for photos — see
   * client-ocr.ts). When present it is parsed directly and the server
   * never runs its own extraction for this upload.
   */
  providedText?: string;
}) {
  const validation = validateReceiptUpload({ mimeType: args.mimeType, sizeBytes: args.buffer.length });
  if (!validation.ok) throw new Error(validation.error);

  const sha256 = createHash('sha256').update(args.buffer).digest('hex');

  const provided = args.providedText?.trim().slice(0, 20000);
  const extracted: ExtractedText = provided
    ? { text: provided, method: 'tesseract' }
    : await extractReceiptText(args.buffer, args.mimeType);
  const parsed = extracted.text ? parseReceiptText(extracted.text) : null;

  const company = await db.company.findUnique({
    where: { id: args.companyId },
    select: { province: true },
  });

  let suggestion: ReceiptSuggestion | null = null;
  if (parsed) {
    const [catRules, bankRuleRows] = await Promise.all([
      loadActiveCategorizationRules(db, args.companyId).catch(() => []),
      db.bankRule.findMany({ where: { companyId: args.companyId }, orderBy: { order: 'asc' } }).catch(() => []),
    ]);
    const bankRules = (bankRuleRows as any[]).map((r) => ({
      ...r,
      setTaxRate: r.setTaxRate === null || r.setTaxRate === undefined ? null : Number(r.setTaxRate),
    })) as BankRuleLike[];
    suggestion = suggestForReceipt({
      merchant: parsed.merchant,
      total: parsed.total,
      province: company?.province ?? null,
      receiptTaxAmount: parsed.taxAmount,
      categorizationRules: catRules as any,
      bankRules,
    });
  }

  // A bank-rule suggestion arrives as a code; resolve it to a category id.
  let suggestedCategoryId = suggestion?.categoryId ?? null;
  if (!suggestedCategoryId && suggestion?.categoryCode) {
    const coa = await db.chartOfAccount.findFirst({
      where: { companyId: args.companyId, code: suggestion.categoryCode, active: true },
      select: { id: true },
    });
    suggestedCategoryId = coa?.id ?? null;
  }

  const receipt = await (db as any).receipt.create({
    data: {
      companyId: args.companyId,
      originalFileName: args.fileName.slice(0, 200),
      mimeType: args.mimeType,
      sizeBytes: args.buffer.length,
      sha256,
      storageBackend: 'db',
      imageData: args.buffer,
      status: 'inbox',
      ocrStatus: parsed ? 'done' : extracted.method === 'none' ? 'failed' : 'done',
      ocrMerchant: parsed?.merchant ?? null,
      ocrDate: parsed?.date ? new Date(`${parsed.date}T12:00:00Z`) : null,
      ocrTotal: parsed?.total ?? null,
      ocrSubtotal: parsed?.subtotal ?? null,
      ocrTaxAmount: parsed?.taxAmount ?? null,
      ocrRawText: extracted.text ? extracted.text.slice(0, 20000) : null,
      ocrConfidence: parsed?.confidence ?? null,
      suggestedCategoryId,
      suggestedSource: suggestion?.source ?? null,
      createdBy: args.userId,
    },
    include: { suggestedCategory: { select: { code: true } } },
  });

  return serializeReceipt(receipt);
}

export async function listReceipts(companyId: string, status?: string | null) {
  const rows = await (db as any).receipt.findMany({
    where: { companyId, ...(status && status !== 'all' ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { suggestedCategory: { select: { code: true } } },
  });
  return rows.map(serializeReceipt);
}

export async function getReceipt(companyId: string, id: string) {
  const receipt = await (db as any).receipt.findFirst({
    where: { id, companyId },
    include: { suggestedCategory: { select: { code: true } } },
  });
  return receipt ? serializeReceipt(receipt) : null;
}

export async function getReceiptImage(companyId: string, id: string) {
  const receipt = await (db as any).receipt.findFirst({
    where: { id, companyId },
    select: { mimeType: true, originalFileName: true, imageData: true, storageBackend: true, storageKey: true },
  });
  if (!receipt) return null;
  if (receipt.storageBackend !== 'db' || !receipt.imageData) {
    // External storage backends arrive with the Supabase Storage follow-up;
    // v1 only writes 'db' rows, so anything else is unreadable by design.
    return null;
  }
  return {
    mimeType: receipt.mimeType as string,
    fileName: receipt.originalFileName as string,
    buffer: Buffer.from(receipt.imageData as Uint8Array),
  };
}

export async function updateReceiptSuggestion(
  companyId: string,
  id: string,
  patch: { merchant?: string | null; date?: string | null; total?: number | null; taxAmount?: number | null; categoryId?: string | null },
) {
  const existing = await (db as any).receipt.findFirst({ where: { id, companyId }, select: { id: true } });
  if (!existing) return null;

  const data: any = {};
  if (patch.merchant !== undefined) data.ocrMerchant = patch.merchant;
  if (patch.date !== undefined) data.ocrDate = patch.date ? new Date(`${patch.date}T12:00:00Z`) : null;
  if (patch.total !== undefined) data.ocrTotal = patch.total;
  if (patch.taxAmount !== undefined) data.ocrTaxAmount = patch.taxAmount;
  if (patch.categoryId !== undefined) {
    if (patch.categoryId) {
      const coa = await db.chartOfAccount.findFirst({
        where: { id: patch.categoryId, companyId, active: true },
        select: { id: true },
      });
      if (!coa) throw new Error('That category does not belong to this company.');
    }
    data.suggestedCategoryId = patch.categoryId;
    data.suggestedSource = patch.categoryId ? 'manual' : null;
  }

  const updated = await (db as any).receipt.update({
    where: { id },
    data,
    include: { suggestedCategory: { select: { code: true } } },
  });
  return serializeReceipt(updated);
}

/**
 * Link a receipt to a bank transaction of the same company. Returns the
 * receipt plus — when a category is known — the split payload the UI sends
 * to the EXISTING POST /api/bank-transactions/[id]/split endpoint to
 * categorize the row (no posting; that stays the user's banking action).
 */
export async function attachReceipt(args: { companyId: string; receiptId: string; transactionId: string }) {
  const receipt = await (db as any).receipt.findFirst({
    where: { id: args.receiptId, companyId: args.companyId },
    include: { suggestedCategory: { select: { code: true } } },
  });
  if (!receipt) return null;
  if (receipt.transactionId && receipt.transactionId !== args.transactionId) {
    throw new Error('This receipt is already attached to another transaction. Detach it first.');
  }

  const tx = await db.transaction.findUnique({
    where: { id: args.transactionId, companyId: args.companyId },
    select: { id: true, amount: true },
  });
  if (!tx) throw new Error('Transaction not found for this company.');

  const updated = await (db as any).receipt.update({
    where: { id: args.receiptId },
    data: { transactionId: args.transactionId, status: 'attached' },
    include: { suggestedCategory: { select: { code: true } } },
  });

  const company = await db.company.findUnique({
    where: { id: args.companyId },
    select: { province: true },
  });

  const suggestedSplit = updated.suggestedCategory?.code
    ? buildReceiptSplit({
        categoryCode: updated.suggestedCategory.code,
        amount: Number(tx.amount),
        taxProvince: company?.province ?? null,
      })
    : null;

  return { receipt: serializeReceipt(updated), suggestedSplit };
}

/**
 * Resolve the account a receipt-created expense is paid from. `paidFrom`
 * is either a financial account id of this company, or 'cash' — the
 * company's Cash (petty cash) account, created on first use and linked
 * to the Petty Cash GL account (1040). Cash purchases have no bank row
 * to attach to, so without this path they could not be recorded from a
 * receipt at all.
 */
export async function resolveExpenseAccount(companyId: string, paidFrom: string) {
  const select = { id: true, kind: true, name: true } as const;
  if (paidFrom && paidFrom !== 'cash') {
    const account = await db.financialAccount.findFirst({
      where: { id: paidFrom, companyId, isActive: true },
      select,
    });
    if (!account) throw new Error('That account was not found for this company.');
    return account;
  }

  const existing = await db.financialAccount.findFirst({
    where: { companyId, kind: 'cash', isActive: true },
    select,
  });
  if (existing) return existing;

  const glAccountCode = await getDefaultFinancialAccountGlCode(companyId, 'cash');
  return db.financialAccount.create({
    data: { companyId, name: 'Cash', kind: 'cash', glAccountCode: glAccountCode ?? null },
    select,
  });
}

/**
 * Record a receipt as a NEW expense when there is no bank transaction
 * to attach it to (cash purchases, or a row the statement import has
 * not produced). Creates the bank-side transaction on the paid-from
 * account (a negative row, exactly like an imported purchase), attaches
 * the receipt to it, and applies the suggested category split — the
 * same end state as attach + categorize, still unposted: the user
 * posts it from Banking, which is the moment the GL moves.
 */
export async function createExpenseFromReceipt(args: {
  companyId: string;
  receiptId: string;
  paidFrom: string;
}) {
  const receipt = await (db as any).receipt.findFirst({
    where: { id: args.receiptId, companyId: args.companyId },
    include: { suggestedCategory: { select: { code: true } } },
  });
  if (!receipt) return null;
  if (receipt.transactionId) {
    throw new Error('This receipt is already attached to a transaction. Detach it first.');
  }
  if (receipt.ocrTotal === null || receipt.ocrTotal === undefined) {
    throw new Error('Add the receipt total before creating the expense.');
  }
  if (!receipt.ocrDate) {
    throw new Error('Add the receipt date before creating the expense.');
  }

  const date = new Date(receipt.ocrDate);
  if (await closedPeriodGuard(args.companyId, date)) {
    throw new Error('The receipt date falls in a closed period.');
  }

  const account = await resolveExpenseAccount(args.companyId, args.paidFrom);
  if (await accountLockedGuard(args.companyId, account.id, date)) {
    throw new Error('That account is locked through the receipt date.');
  }

  const total = Math.abs(Number(receipt.ocrTotal));
  const description = receipt.ocrMerchant?.trim() || 'Receipt expense';
  const tx = await db.transaction.create({
    data: {
      companyId: args.companyId,
      financialAccountId: account.id,
      date,
      description,
      merchant: receipt.ocrMerchant ?? null,
      amount: -total,
      dedupeHash: makeDedupeKey({
        date: date.toISOString().slice(0, 10),
        amount: -total,
        description,
      }),
    },
  });

  const attached = await attachReceipt({
    companyId: args.companyId,
    receiptId: args.receiptId,
    transactionId: tx.id,
  });

  if (attached?.suggestedSplit) {
    await db.transaction.update({
      where: { id: tx.id },
      data: { splits: [attached.suggestedSplit] as any, status: 'categorized' },
    });
  }

  return {
    receipt: attached?.receipt ?? null,
    transactionId: tx.id,
    accountId: account.id,
    accountKind: account.kind,
    accountName: account.name,
    suggestedSplit: attached?.suggestedSplit ?? null,
  };
}

export async function detachReceipt(companyId: string, receiptId: string) {
  const receipt = await (db as any).receipt.findFirst({
    where: { id: receiptId, companyId },
    select: { id: true },
  });
  if (!receipt) return null;
  const updated = await (db as any).receipt.update({
    where: { id: receiptId },
    data: { transactionId: null, status: 'inbox' },
    include: { suggestedCategory: { select: { code: true } } },
  });
  return serializeReceipt(updated);
}
