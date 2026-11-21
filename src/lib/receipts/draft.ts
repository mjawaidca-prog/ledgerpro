/**
 * Receipt → DRAFT expense (Phase 2 item 2).
 *
 * From an AI-extracted receipt, build a draft expense in the app's own
 * document model — a Bill with kind='expense', status='draft' — pre-
 * filled with the vendor, date, total and tax split, its lines carrying
 * the suggested category, and the source receipt linked from both
 * sides (Bill.notes + attachments name the document; Receipt
 * .draftBillId points back). A draft posts NOTHING: the reviewer opens
 * it in Expenses, adjusts the account or any figure, and posts it
 * through the bills flow's own draft → open transition
 * (postBillToLedger) — approval-gated exactly like every other draft
 * in the product.
 *
 * Tax follows the app's simple document model (the reviewed-tax
 * engine's drafts are a separate, deliberately unsupported path): the
 * draft carries subtotal / taxAmount / total and a taxRate, and at
 * posting time postBillToLedger debits the tax to 2300 as the input
 * credit — the same treatment a hand-typed expense gets.
 *
 * The shape builder is pure: given the receipt's confirmed fields plus
 * the extraction's line items and currency, it produces a draft whose
 * lines sum EXACTLY to the net (subtotal) and lines + tax == total.
 */
import { db } from '@/lib/db';
import { closedPeriodGuard } from '@/lib/api-helpers';
import { round2 } from './parse';
import type { ExtractedLineItem } from './ocr-provider';

export interface DraftExpenseInput {
  vendor: string | null;
  /** ISO date (yyyy-mm-dd). */
  date: string | null;
  total: number | null;
  subtotal: number | null;
  taxAmount: number | null;
  /** ISO 4217 from the extraction, when the document stated one. */
  currency: string | null;
  lineItems: ExtractedLineItem[];
  categoryId: string | null;
}

export interface DraftExpenseLine {
  description: string;
  amount: number;
  categoryId: string | null;
}

export interface DraftExpenseShape {
  vendorName: string;
  billDate: string;
  currency: string | null;
  subtotal: number;
  taxAmount: number;
  total: number;
  /** tax / subtotal as a percent (3dp), null when there is no tax. */
  taxRate: number | null;
  lines: DraftExpenseLine[];
}

export type DraftExpenseBuild =
  | { ok: true; draft: DraftExpenseShape }
  | { ok: false; error: string };

/** Line sums may differ from the printed net by a few cents of OCR /
 *  rounding noise; beyond this the items are not trusted as the split. */
const LINE_SUM_TOLERANCE = 0.05;

export function buildDraftExpense(input: DraftExpenseInput): DraftExpenseBuild {
  const vendor = input.vendor?.trim();
  if (!vendor) return { ok: false, error: 'Add the vendor before creating the draft.' };
  if (!input.date) return { ok: false, error: 'Add the receipt date before creating the draft.' };
  if (input.total === null || input.total === undefined || !(input.total > 0)) {
    return { ok: false, error: 'Add the receipt total before creating the draft.' };
  }
  const total = round2(input.total);

  // Tax: the amount the extraction read off the document wins; else
  // total − subtotal when both were read; else the document is treated
  // as tax-free (the reviewer can add tax in the draft).
  let tax = 0;
  if (input.taxAmount !== null && input.taxAmount !== undefined) {
    tax = round2(input.taxAmount);
  } else if (input.subtotal !== null && input.subtotal !== undefined && total > input.subtotal) {
    tax = round2(total - input.subtotal);
  }
  if (tax < 0) tax = 0;
  if (tax > total) tax = total;
  const net = round2(total - tax);

  // Lines: use the extracted items when they reconcile to the net —
  // they are the split the document itself printed. Any residual
  // within tolerance is folded into the last line so the draft is
  // balanced to the cent.
  const items = (input.lineItems ?? []).filter(
    (li) => li.amount !== null && li.amount !== undefined && Number(li.amount) > 0,
  );
  let lines: DraftExpenseLine[];
  const itemsSum = round2(items.reduce((s, li) => s + Number(li.amount), 0));
  if (items.length > 0 && Math.abs(itemsSum - net) <= LINE_SUM_TOLERANCE) {
    lines = items.map((li) => ({
      description: li.description?.trim() || vendor,
      amount: round2(Number(li.amount)),
      categoryId: input.categoryId,
    }));
    const drift = round2(net - round2(lines.reduce((s, l) => s + l.amount, 0)));
    if (drift !== 0) lines[lines.length - 1].amount = round2(lines[lines.length - 1].amount + drift);
  } else {
    lines = [{ description: vendor, amount: net, categoryId: input.categoryId }];
  }

  const taxRate = tax > 0 && net > 0 ? Math.round((tax / net) * 100 * 1000) / 1000 : null;

  return {
    ok: true,
    draft: {
      vendorName: vendor,
      billDate: input.date,
      currency: input.currency ? input.currency.toUpperCase() : null,
      subtotal: net,
      taxAmount: tax,
      total,
      taxRate,
      lines,
    },
  };
}

/**
 * Category from the company's own history: the category most recently
 * used for this vendor's bank transactions. This is the simple lookup
 * the design allows until the AI categorization memory (Phase 2
 * item 1) lands — it reads only splits the company itself confirmed.
 */
export async function suggestCategoryFromHistory(
  companyId: string,
  vendor: string,
): Promise<string | null> {
  try {
    const rows = await db.transaction.findMany({
      where: { companyId, merchant: { equals: vendor, mode: 'insensitive' } },
      orderBy: { date: 'desc' },
      take: 25,
      select: { splits: true },
    });
    for (const row of rows as any[]) {
      const splits = Array.isArray(row.splits) ? row.splits : [];
      const code = splits.find((s: any) => s && typeof s.categoryCode === 'string')?.categoryCode;
      if (code) {
        const coa = await db.chartOfAccount.findFirst({
          where: { companyId, code, active: true },
          select: { id: true },
        });
        if (coa) return coa.id;
      }
    }
  } catch {
    // History is a hint, never a gate.
  }
  return null;
}

function generateExpenseId(): string {
  return `EXP-${Math.floor(Math.random() * 9000) + 1000}`;
}

/**
 * Create the draft expense for an extracted receipt. Returns the bill
 * id + the serialized receipt essentials; null when the receipt does
 * not exist for this company. Throws (with a reviewer-readable
 * message) on the guard failures: not extracted yet, draft already
 * created, missing fields, closed period.
 */
export async function createDraftExpenseFromReceipt(args: {
  companyId: string;
  receiptId: string;
}) {
  const receipt = await (db as any).receipt.findFirst({
    where: { id: args.receiptId, companyId: args.companyId },
    include: { suggestedCategory: { select: { code: true } } },
  });
  if (!receipt) return null;
  if (receipt.draftBillId) {
    throw new Error(`A draft expense was already created from this receipt (${receipt.draftBillId}). Review it in Expenses.`);
  }
  if (receipt.extractionStatus !== 'extracted') {
    throw new Error('Run the AI read on this receipt first — drafts are created from an extraction.');
  }

  const fields = (receipt.extractionFields ?? {}) as any;
  const built = buildDraftExpense({
    vendor: receipt.ocrMerchant ?? fields.vendor?.value ?? null,
    date: receipt.ocrDate ? new Date(receipt.ocrDate).toISOString().slice(0, 10) : null,
    total: receipt.ocrTotal !== null && receipt.ocrTotal !== undefined ? Number(receipt.ocrTotal) : null,
    subtotal: receipt.ocrSubtotal !== null && receipt.ocrSubtotal !== undefined ? Number(receipt.ocrSubtotal) : null,
    taxAmount: receipt.ocrTaxAmount !== null && receipt.ocrTaxAmount !== undefined ? Number(receipt.ocrTaxAmount) : null,
    currency: typeof fields.currency?.value === 'string' ? fields.currency.value : null,
    lineItems: Array.isArray(fields.lineItems) ? fields.lineItems : [],
    categoryId: receipt.suggestedCategoryId ?? null,
  });
  if (!built.ok) throw new Error(built.error);
  const draft = built.draft;

  const billDate = new Date(`${draft.billDate}T12:00:00Z`);
  if (await closedPeriodGuard(args.companyId, billDate)) {
    throw new Error('The receipt date falls in a closed period.');
  }

  // Category fallback: rules said nothing at upload/pipeline time —
  // try the company's own history for this vendor before leaving the
  // lines uncategorized for the reviewer.
  let categoryId = receipt.suggestedCategoryId ?? null;
  if (!categoryId) {
    categoryId = await suggestCategoryFromHistory(args.companyId, draft.vendorName);
    if (categoryId) {
      await (db as any).receipt.update({
        where: { id: receipt.id },
        data: { suggestedCategoryId: categoryId, suggestedSource: 'history' },
      });
      for (const line of draft.lines) line.categoryId = categoryId;
    }
  }

  // Vendor: the bill's currency comes from the contact (the bills
  // route's rule), so a new contact is created in the document's
  // currency when the extraction stated one.
  const company = await db.company.findUnique({
    where: { id: args.companyId },
    select: { currency: true },
  });
  let vendor = await db.contact.findFirst({
    where: {
      companyId: args.companyId,
      type: 'supplier',
      OR: [
        { name: { equals: draft.vendorName, mode: 'insensitive' } },
        { companyName: { equals: draft.vendorName, mode: 'insensitive' } },
      ],
    },
    select: { id: true, currency: true },
  });
  if (!vendor) {
    vendor = await db.contact.create({
      data: {
        companyId: args.companyId,
        name: draft.vendorName,
        type: 'supplier',
        currency: draft.currency ?? company?.currency ?? 'CAD',
      },
      select: { id: true, currency: true },
    });
  }

  const notes = `Created from receipt "${receipt.originalFileName}" — AI-extracted (${receipt.extractionProvider ?? 'provider'}), review before posting.`;
  let bill: any = null;
  for (let attempt = 0; attempt < 3 && !bill; attempt++) {
    try {
      bill = await db.bill.create({
        data: {
          id: generateExpenseId(),
          companyId: args.companyId,
          kind: 'expense',
          vendorId: vendor.id,
          billDate,
          subtotal: draft.subtotal,
          taxRate: draft.taxRate,
          taxAmount: draft.taxAmount,
          total: draft.total,
          currency: vendor.currency,
          status: 'draft',
          notes,
          attachments: [`/api/receipts/${receipt.id}/image`],
          lineItems: {
            create: draft.lines.map((line, idx) => ({
              description: line.description,
              amount: line.amount,
              categoryId: line.categoryId,
              sortOrder: idx,
            })),
          },
        },
        include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
      });
    } catch (err: any) {
      // EXP-#### ids are random 4-digit (the bills route's own scheme);
      // a primary-key collision just means roll again.
      if (err?.code !== 'P2002' || attempt === 2) throw err;
    }
  }

  await (db as any).receipt.update({
    where: { id: receipt.id },
    data: { draftBillId: bill.id },
  });

  return {
    billId: bill.id as string,
    receiptId: receipt.id as string,
    status: bill.status as string,
    total: Number(bill.total),
    currency: bill.currency as string,
    lineCount: (bill.lineItems ?? []).length,
  };
}
