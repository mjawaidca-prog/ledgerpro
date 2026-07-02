/**
 * LedgerPro — Double-entry journal posting engine.
 *
 * Every financial event produces at least 2 journal lines (debit + credit)
 * that must balance to zero. This engine enforces that constraint.
 *
 * Account type natural balances:
 *   Asset      — debit increases, credit decreases
 *   Liability  — credit increases, debit decreases
 *   Equity     — credit increases, debit decreases
 *   Income     — credit increases, debit decreases (revenue)
 *   Expense    — debit increases, credit decreases
 */

import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

// ─── Types ───

interface JournalLineInput {
  glAccountCode: string;
  description?: string;
  debit: number;
  credit: number;
}

interface JournalEntryInput {
  entryDate: Date;
  description: string;
  sourceType: 'invoice' | 'bill' | 'payment' | 'transfer' | 'manual';
  sourceId?: string;
  createdBy?: string;
  lines: JournalLineInput[];
}

// ─── Validation ───

function validateBalanced(lines: JournalLineInput[]): void {
  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);

  const DIFF_TOLERANCE = 0.01;
  if (Math.abs(totalDebit - totalCredit) > DIFF_TOLERANCE) {
    throw new Error(
      `Journal entry is not balanced. Total debits: ${totalDebit.toFixed(2)}, total credits: ${totalCredit.toFixed(2)}. Difference: ${Math.abs(totalDebit - totalCredit).toFixed(2)}`
    );
  }
}

// ─── Post journal entry ───

export async function postJournalEntry(
  input: JournalEntryInput,
  companyId: string,
  tx?: Prisma.TransactionClient // pass in a transaction for atomicity
) {
  const client = tx ?? db;

  validateBalanced(input.lines);

  // Verify all GL accounts exist and are active
  const codes = [...new Set(input.lines.map((l) => l.glAccountCode))];
  const accounts = await client.chartOfAccount.findMany({
    where: {
      code: { in: codes },
      active: true,
      companyId,
    },
  });

  const accountMap = new Map(accounts.map((a) => [a.code, a]));

  for (const code of codes) {
    if (!accountMap.has(code)) {
      throw new Error(`GL account ${code} not found or inactive`);
    }
  }

  // Create the journal entry with its lines
  const entry = await client.journalEntry.create({
    data: {
      companyId,
      entryDate: input.entryDate,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdBy: input.createdBy,
      lines: {
        create: input.lines.map((line) => ({
          glAccountCode: line.glAccountCode,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
        })),
      },
    },
    include: {
      lines: true,
    },
  });

  // Update GL account balances
  for (const line of input.lines) {
    const account = accountMap.get(line.glAccountCode)!;
    const netEffect = line.debit - line.credit;

    // Apply based on account type
    let balanceChange: number;
    const type = account.type;

    if (type === 'asset' || type === 'expense') {
      // Debit increases, credit decreases
      balanceChange = netEffect;
    } else {
      // Liability, equity, income: credit increases, debit decreases
      balanceChange = -netEffect;
    }

    await client.chartOfAccount.update({
      where: { id: account.id },
      data: {
        balance: { increment: new Prisma.Decimal(balanceChange) },
      },
    });

    // If this account has a parent, update parent balance too
    if (account.parentCode) {
      await client.chartOfAccount.updateMany({
        where: { code: account.parentCode, companyId },
        data: {
          balance: { increment: new Prisma.Decimal(balanceChange) },
        },
      });
    }
  }

  return entry;
}

// ─── Specialized posting helpers ───

/**
 * Post an invoice to the ledger.
 * Invoice: Debit AR (asset), Credit Revenue (income) for the total.
 */
export async function postInvoiceToLedger(
  invoiceId: string,
  customerName: string,
  total: number,
  companyId: string,
  tx?: Prisma.TransactionClient
) {
  return postJournalEntry(
    {
      entryDate: new Date(),
      description: `Invoice ${invoiceId} — ${customerName}`,
      sourceType: 'invoice',
      sourceId: invoiceId,
      lines: [
        {
          glAccountCode: '1100', // Accounts Receivable
          description: `AR for ${invoiceId}`,
          debit: total,
          credit: 0,
        },
        {
          glAccountCode: '4000', // Product Sales (default revenue)
          description: `Revenue for ${invoiceId}`,
          debit: 0,
          credit: total,
        },
      ],
    },
    companyId,
    tx
  );
}

/**
 * Post a payment received against an invoice.
 * Payment: Debit Cash (asset), Credit AR (asset — reducing the receivable).
 */
export async function postInvoicePayment(
  invoiceId: string,
  customerName: string,
  amount: number,
  paymentAccountCode: string,
  companyId: string,
  tx?: Prisma.TransactionClient
) {
  return postJournalEntry(
    {
      entryDate: new Date(),
      description: `Payment for ${invoiceId} — ${customerName}`,
      sourceType: 'payment',
      sourceId: invoiceId,
      lines: [
        {
          glAccountCode: paymentAccountCode, // e.g. 1010 = Chase Checking
          description: `Cash received for ${invoiceId}`,
          debit: amount,
          credit: 0,
        },
        {
          glAccountCode: '1100', // Accounts Receivable
          description: `AR reduction for ${invoiceId}`,
          debit: 0,
          credit: amount,
        },
      ],
    },
    companyId,
    tx
  );
}

/**
 * Post a bill to the ledger.
 * Bill: Debit Expense account(s) per line item (grouped by GL category),
 * plus tax paid to the Sales Tax Payable control account, Credit AP (liability)
 * for the total. Every line item must carry a categoryId — there is no
 * generic "uncategorized expense" fallback, since posting to the wrong
 * account silently corrupts the P&L.
 */
export async function postBillToLedger(
  billId: string,
  vendorName: string,
  lineItems: { categoryId: string | null; amount: number }[],
  taxAmount: number,
  total: number,
  companyId: string,
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? db;

  if (lineItems.some((li) => !li.categoryId)) {
    throw new Error('Every bill line item must have a GL category selected before it can be posted.');
  }
  const categoryIds = [...new Set(lineItems.map((li) => li.categoryId!))];

  const accounts = await client.chartOfAccount.findMany({
    where: { id: { in: categoryIds }, companyId },
  });
  const acctByIdCode = new Map(accounts.map((a) => [a.id, a.code]));

  const amountByCode = new Map<string, number>();
  for (const li of lineItems) {
    const code = acctByIdCode.get(li.categoryId!);
    if (!code) {
      throw new Error(`Bill line item references an unknown GL category (${li.categoryId})`);
    }
    amountByCode.set(code, (amountByCode.get(code) ?? 0) + li.amount);
  }

  const debitLines = [...amountByCode.entries()].map(([code, amount]) => ({
    glAccountCode: code,
    description: `Expense for ${billId}`,
    debit: amount,
    credit: 0,
  }));

  if (taxAmount > 0) {
    debitLines.push({
      glAccountCode: '2300', // Sales Tax Payable — net GST/HST/PST position (input tax credit reduces what's owed)
      description: `Tax paid for ${billId}`,
      debit: taxAmount,
      credit: 0,
    });
  }

  return postJournalEntry(
    {
      entryDate: new Date(),
      description: `Bill ${billId} — ${vendorName}`,
      sourceType: 'bill',
      sourceId: billId,
      lines: [
        ...debitLines,
        {
          glAccountCode: '2200', // Accounts Payable
          description: `AP for ${billId}`,
          debit: 0,
          credit: total,
        },
      ],
    },
    companyId,
    tx
  );
}

/**
 * Post a bill payment.
 * Bill Payment: Debit AP (liability — reducing), Credit Cash (asset — reducing).
 */
export async function postBillPayment(
  billId: string,
  vendorName: string,
  amount: number,
  paymentAccountCode: string,
  companyId: string,
  tx?: Prisma.TransactionClient
) {
  return postJournalEntry(
    {
      entryDate: new Date(),
      description: `Payment for ${billId} — ${vendorName}`,
      sourceType: 'payment',
      sourceId: billId,
      lines: [
        {
          glAccountCode: '2200', // Accounts Payable
          description: `AP reduction for ${billId}`,
          debit: amount,
          credit: 0,
        },
        {
          glAccountCode: paymentAccountCode, // e.g. 1010 = Chase Checking
          description: `Cash paid for ${billId}`,
          debit: 0,
          credit: amount,
        },
      ],
    },
    companyId,
    tx
  );
}

/**
 * Post a transfer between internal accounts (e.g., bank pays credit card).
 * Transfer: Debit the destination account, Credit the source account.
 * This is a balance-sheet-only movement. No P&L impact.
 */
export async function postTransfer(
  sourceAccountCode: string,
  destinationAccountCode: string,
  amount: number,
  description: string,
  transferMatchId: string,
  companyId: string,
  tx?: Prisma.TransactionClient
) {
  return postJournalEntry(
    {
      entryDate: new Date(),
      description,
      sourceType: 'transfer',
      sourceId: transferMatchId,
      lines: [
        {
          glAccountCode: destinationAccountCode,
          description: 'Transfer received',
          debit: amount,
          credit: 0,
        },
        {
          glAccountCode: sourceAccountCode,
          description: 'Transfer sent',
          debit: 0,
          credit: amount,
        },
      ],
    },
    companyId,
    tx
  );
}

/**
 * Post a categorized bank transaction to the ledger.
 * Inflow: Debit bank account, Credit the income/category account.
 * Outflow: Debit the expense/category account, Credit the bank account.
 * Shared by both the initial post-gl action and reclassification (void + repost).
 */
export async function postTransactionToLedger(
  transaction: { id: string; date: Date; description: string; amount: number },
  bankAccountCode: string | undefined,
  categoryCode: string,
  companyId: string,
  entryDate: Date = transaction.date,
  tx?: Prisma.TransactionClient
) {
  const amount = Math.abs(transaction.amount);
  const isInflow = transaction.amount > 0;
  const bankCode = bankAccountCode || '1010';

  const lines = isInflow
    ? [
        { glAccountCode: bankCode, description: transaction.description, debit: amount, credit: 0 },
        { glAccountCode: categoryCode, description: `Revenue — ${transaction.description}`, debit: 0, credit: amount },
      ]
    : [
        { glAccountCode: categoryCode, description: transaction.description, debit: amount, credit: 0 },
        { glAccountCode: bankCode, description: `Payment — ${transaction.description}`, debit: 0, credit: amount },
      ];

  return postJournalEntry(
    {
      entryDate,
      description: transaction.description,
      sourceType: 'payment',
      sourceId: transaction.id,
      lines,
    },
    companyId,
    tx
  );
}

// ─── Void / reversal ───

/**
 * Void a posted journal entry without deleting it.
 *
 * A voided entry is never removed: it stays in the ledger for audit purposes,
 * and an equal-and-opposite reversing entry is posted (dated `reversalDate`,
 * default now) to net its balance effect back out. This is what lets the
 * trial balance and general ledger stay correct with no special-case
 * filtering — the pair of entries simply sums to zero.
 *
 * Throws if the entry doesn't exist or has already been voided; callers are
 * responsible for closedPeriodGuard on the reversal date and for company-scoping.
 */
export async function voidJournalEntry(
  entryId: string,
  companyId: string,
  userId: string | undefined,
  reversalDate: Date = new Date()
) {
  return db.$transaction(async (tx) => {
    const entry = await tx.journalEntry.findUnique({
      where: { id: entryId, companyId },
      include: { lines: true },
    });

    if (!entry) {
      throw new Error('Journal entry not found');
    }
    if (entry.voidedAt) {
      throw new Error('This journal entry has already been voided');
    }

    const reversal = await postJournalEntry(
      {
        entryDate: reversalDate,
        description: `Reversal of: ${entry.description}`,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId ?? undefined,
        createdBy: userId,
        lines: entry.lines.map((l) => ({
          glAccountCode: l.glAccountCode,
          description: l.description ?? undefined,
          debit: Number(l.credit),
          credit: Number(l.debit),
        })),
      },
      companyId,
      tx
    );

    await tx.journalEntry.update({
      where: { id: reversal.id },
      data: { reversalOfId: entry.id },
    });

    await tx.journalEntry.update({
      where: { id: entry.id },
      data: { voidedAt: new Date(), voidedBy: userId },
    });

    return { original: entry, reversal };
  });
}
