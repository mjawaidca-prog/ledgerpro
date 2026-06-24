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
 * Bill: Debit Expense (expense), Credit AP (liability).
 */
export async function postBillToLedger(
  billId: string,
  vendorName: string,
  total: number,
  expenseAccountCode: string,
  companyId: string,
  tx?: Prisma.TransactionClient
) {
  return postJournalEntry(
    {
      entryDate: new Date(),
      description: `Bill ${billId} — ${vendorName}`,
      sourceType: 'bill',
      sourceId: billId,
      lines: [
        {
          glAccountCode: expenseAccountCode,
          description: `Expense for ${billId}`,
          debit: total,
          credit: 0,
        },
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
