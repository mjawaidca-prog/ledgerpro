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
import { computeSettlement, journalLinesForPayment } from '@/lib/fx/settlement';
import { Prisma } from '@prisma/client';

// ─── Types ───

interface JournalLineInput {
  glAccountCode: string;
  description?: string;
  debit: number;
  credit: number;
  // Foreign-currency detail — debit/credit stay in the HOME currency always.
  currency?: string;
  fxRate?: number;
  debitForeign?: number;
  creditForeign?: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface JournalEntryInput {
  entryDate: Date;
  description: string;
  sourceType: 'invoice' | 'bill' | 'payment' | 'transfer' | 'manual' | 'revaluation';
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
          currency: line.currency,
          fxRate: line.fxRate,
          debitForeign: line.debitForeign,
          creditForeign: line.creditForeign,
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
 * Invoice: Debit AR (asset) for the total, Credit Revenue account(s) per line
 * item (grouped by GL category) for the subtotal, Credit Sales Tax Payable
 * for tax collected. Every line item must carry a categoryId — posting tax
 * collected as revenue, or all revenue to one hardcoded account regardless
 * of what was actually sold, silently corrupts the P&L.
 */
export async function postInvoiceToLedger(
  invoiceId: string,
  customerName: string,
  lineItems: { categoryId: string | null; amount: number }[],
  taxAmount: number,
  total: number,
  companyId: string,
  tx?: Prisma.TransactionClient,
  fx?: { currency: string; fxRate: number }
) {
  const client = tx ?? db;

  if (lineItems.some((li) => !li.categoryId)) {
    throw new Error('Every invoice line item must have a GL revenue category selected before it can be posted.');
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
      throw new Error(`Invoice line item references an unknown GL category (${li.categoryId})`);
    }
    amountByCode.set(code, (amountByCode.get(code) ?? 0) + li.amount);
  }

  // FX: home amount = Σ of per-line rounded conversions, so the entry
  // balances to the cent by construction. CAD posting is unchanged.
  const toHome = (foreign: number) => (fx ? round2(foreign * fx.fxRate) : foreign);
  const foreignCols = (foreign: number) =>
    fx ? { currency: fx.currency, fxRate: fx.fxRate, creditForeign: foreign } : {};

  const creditLines = [...amountByCode.entries()].map(([code, amount]) => ({
    glAccountCode: code,
    description: `Revenue for ${invoiceId}`,
    debit: 0,
    credit: toHome(amount),
    ...foreignCols(amount),
  }));

  if (taxAmount > 0) {
    creditLines.push({
      glAccountCode: '2300', // Sales Tax Payable — GST/HST/PST collected on sales
      description: `Tax collected for ${invoiceId}`,
      debit: 0,
      credit: toHome(taxAmount),
      ...foreignCols(taxAmount),
    });
  }

  const arDebit = fx ? round2(creditLines.reduce((s, l) => s + l.credit, 0)) : total;

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
          debit: arDebit,
          credit: 0,
          ...(fx ? { currency: fx.currency, fxRate: fx.fxRate, debitForeign: total } : {}),
        },
        ...creditLines,
      ],
    },
    companyId,
    tx
  );
}

export interface PaymentPostingOptions {
  documentId: string;
  counterpartyName: string;
  companyId: string;
  /** Amount received in the DOCUMENT currency. */
  amountForeign: number;
  currency: string;
  /** The rate frozen on the document (home per 1 foreign). */
  invoiceRate: number;
  settlementRate: number;
  paymentDate: Date;
  paymentAccountCode: string;
  paymentAccountCurrency: string;
  fxAccountCode: string;
  roundingAccountCode: string;
  userId?: string;
  paymentAccountId?: string;
}

/**
 * Post a payment received against an invoice (FX-aware).
 * Receivable: DR cash / CR AR (relieved at the invoice rate) / FX difference
 * to the realized FX account — the gain/loss posts in the period of the
 * PAYMENT. Updates the document and the financial account in one transaction.
 * Overpayment posts the excess as a foreign-denominated customer credit on AR.
 */
export async function postInvoicePayment(opts: PaymentPostingOptions) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: opts.documentId, companyId: opts.companyId } });
    if (invoice.status === 'void') throw new Error('Cannot pay a voided invoice.');
    if (!invoice.fxRate) throw new Error('The invoice has no frozen FX rate to settle against.');

    const remainingForeign = round2(Number(invoice.total) - Number(invoice.paidAmount));
    const remainingHome = round2(Number(invoice.totalHome ?? invoice.total) - Number(invoice.paidAmountHome ?? invoice.paidAmount));
    if (remainingForeign <= 0) throw new Error('This invoice is already fully paid.');

    const reliefForeign = Math.min(opts.amountForeign, remainingForeign);
    const excessForeign = round2(opts.amountForeign - reliefForeign);

    const c = computeSettlement({
      amountForeign: reliefForeign,
      invoiceRate: Number(invoice.fxRate),
      settlementRate: opts.settlementRate,
      remainingForeign,
      remainingHome,
    });

    const lines = journalLinesForPayment(c, {
      cashAccountCode: opts.paymentAccountCode,
      receivableAccountCode: '1100',
      fxAccountCode: opts.fxAccountCode,
      roundingAccountCode: opts.roundingAccountCode,
      documentId: opts.documentId,
      counterpartyName: opts.counterpartyName,
      currency: opts.currency,
    });

    if (excessForeign >= 0.005) {
      // Overpayment → foreign-denominated customer credit on AR.
      const excessHome = round2(excessForeign * opts.settlementRate);
      lines.push({
        glAccountCode: '1100',
        description: `Customer credit (overpayment) for ${opts.documentId}`,
        debit: 0,
        credit: excessHome,
        currency: opts.currency,
        fxRate: opts.settlementRate,
        creditForeign: excessForeign,
      });
      // Absorb any cent-level drift from splitting the cash.
      const drift = round2(round2(opts.amountForeign * opts.settlementRate) - lines.reduce((s, l) => s + l.debit - l.credit, 0));
      if (Math.abs(drift) >= 0.005) {
        lines.push({
          glAccountCode: opts.roundingAccountCode,
          description: `FX rounding for ${opts.documentId}`,
          debit: drift > 0 ? drift : 0,
          credit: drift < 0 ? -drift : 0,
        });
      }
    }

    const entry = await postJournalEntry(
      {
        entryDate: opts.paymentDate,
        description: `Payment for ${opts.documentId} — ${opts.counterpartyName}`,
        sourceType: 'payment',
        sourceId: opts.documentId,
        createdBy: opts.userId,
        lines,
      },
      opts.companyId,
      tx
    );

    const fullyPaid = reliefForeign >= remainingForeign - 0.005;
    const cashHome = round2(opts.amountForeign * opts.settlementRate);
    await tx.invoice.update({
      where: { id: opts.documentId },
      data: {
        paidAmount: { increment: new Prisma.Decimal(opts.amountForeign) },
        paidAmountHome: { increment: new Prisma.Decimal(cashHome) },
        paidAt: opts.paymentDate,
        paymentAccountId: opts.paymentAccountId ?? invoice.paymentAccountId,
        status: fullyPaid ? 'paid' : invoice.status,
      },
    });

    // Financial account: same-currency deposit keeps its own currency; a
    // different-currency deposit records the converted home amount.
    const finAcct = await tx.financialAccount.findFirst({
      where: { glAccountCode: opts.paymentAccountCode, companyId: opts.companyId },
    });
    if (finAcct) {
      const increment = finAcct.currency === opts.currency ? opts.amountForeign : cashHome;
      await tx.financialAccount.update({
        where: { id: finAcct.id },
        data: { currentBalance: { increment: new Prisma.Decimal(increment) } },
      });
    }

    return entry;
  });
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
  tx?: Prisma.TransactionClient,
  fx?: { currency: string; fxRate: number },
  importTaxAmount?: number
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

  // FX: home amounts = Σ of per-line rounded conversions; import GST/HST is
  // entered in CAD on CBSA's own valuation and is NEVER derived from the
  // foreign amount — it posts as a separate CAD line on 2300.
  const isFx = Boolean(fx && fx.fxRate);
  const toHome = (foreign: number) => (isFx ? round2(foreign * fx!.fxRate) : foreign);
  const foreignCols = (foreign: number) =>
    isFx ? { currency: fx!.currency, fxRate: fx!.fxRate, debitForeign: foreign } : {};

  const debitLines = [...amountByCode.entries()].map(([code, amount]) => ({
    glAccountCode: code,
    description: `Expense for ${billId}`,
    debit: toHome(amount),
    credit: 0,
    ...foreignCols(amount),
  }));

  if (taxAmount > 0) {
    debitLines.push({
      glAccountCode: '2300', // Sales Tax Payable — net GST/HST/PST position (input tax credit reduces what's owed)
      description: `Tax paid for ${billId}`,
      debit: toHome(taxAmount),
      credit: 0,
      ...foreignCols(taxAmount),
    });
  }

  const importTax = importTaxAmount ?? 0;
  if (importTax > 0) {
    debitLines.push({
      glAccountCode: '2300',
      description: `Import GST/HST assessed by CBSA in CAD for ${billId}`,
      debit: importTax,
      credit: 0,
    });
  }

  const apCredit = isFx
    ? round2(debitLines.reduce((s, l) => s + l.debit, 0))
    : total;

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
          credit: apCredit,
          ...(isFx ? { currency: fx!.currency, fxRate: fx!.fxRate, creditForeign: total } : {}),
        },
      ],
    },
    companyId,
    tx
  );
}

/**
 * Post a bill payment (FX-aware). Payable: DR AP (relieved at the bill's
 * frozen rate) / CR cash at the settlement rate / FX difference to the
 * realized FX account — the payable sign flips in computeSettlement.
 */
export async function postBillPayment(opts: PaymentPostingOptions) {
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findUniqueOrThrow({ where: { id: opts.documentId, companyId: opts.companyId } });
    if (bill.status === 'void') throw new Error('Cannot pay a voided bill.');
    if (!bill.fxRate) throw new Error('The bill has no frozen FX rate to settle against.');

    const remainingForeign = round2(Number(bill.total) - Number(bill.paidAmount));
    const remainingHome = round2(Number(bill.totalHome ?? bill.total) - Number(bill.paidAmountHome ?? bill.paidAmount));
    if (remainingForeign <= 0) throw new Error('This bill is already fully paid.');

    const reliefForeign = Math.min(opts.amountForeign, remainingForeign);
    const excessForeign = round2(opts.amountForeign - reliefForeign);

    const c = computeSettlement({
      amountForeign: reliefForeign,
      invoiceRate: Number(bill.fxRate),
      settlementRate: opts.settlementRate,
      remainingForeign,
      remainingHome,
      isPayable: true,
    });

    const lines = journalLinesForPayment(c, {
      cashAccountCode: opts.paymentAccountCode,
      receivableAccountCode: '2200',
      fxAccountCode: opts.fxAccountCode,
      roundingAccountCode: opts.roundingAccountCode,
      documentId: opts.documentId,
      counterpartyName: opts.counterpartyName,
      currency: opts.currency,
    });

    if (excessForeign >= 0.005) {
      const excessHome = round2(excessForeign * opts.settlementRate);
      lines.push({
        glAccountCode: '2200',
        description: `Vendor credit (overpayment) for ${opts.documentId}`,
        debit: excessHome,
        credit: 0,
        currency: opts.currency,
        fxRate: opts.settlementRate,
        debitForeign: excessForeign,
      });
      const drift = round2(round2(opts.amountForeign * opts.settlementRate) - lines.reduce((s, l) => s + l.credit - l.debit, 0));
      if (Math.abs(drift) >= 0.005) {
        lines.push({
          glAccountCode: opts.roundingAccountCode,
          description: `FX rounding for ${opts.documentId}`,
          debit: drift > 0 ? drift : 0,
          credit: drift < 0 ? -drift : 0,
        });
      }
    }

    const entry = await postJournalEntry(
      {
        entryDate: opts.paymentDate,
        description: `Payment for ${opts.documentId} — ${opts.counterpartyName}`,
        sourceType: 'payment',
        sourceId: opts.documentId,
        createdBy: opts.userId,
        lines,
      },
      opts.companyId,
      tx
    );

    const fullyPaid = reliefForeign >= remainingForeign - 0.005;
    const cashHome = round2(opts.amountForeign * opts.settlementRate);
    await tx.bill.update({
      where: { id: opts.documentId },
      data: {
        paidAmount: { increment: new Prisma.Decimal(opts.amountForeign) },
        paidAmountHome: { increment: new Prisma.Decimal(cashHome) },
        paidAt: opts.paymentDate,
        paymentAccountId: opts.paymentAccountId ?? bill.paymentAccountId,
        status: fullyPaid ? 'paid' : bill.status,
      },
    });

    const finAcct = await tx.financialAccount.findFirst({
      where: { glAccountCode: opts.paymentAccountCode, companyId: opts.companyId },
    });
    if (finAcct) {
      const increment = finAcct.currency === opts.currency ? -opts.amountForeign : -cashHome;
      await tx.financialAccount.update({
        where: { id: finAcct.id },
        data: { currentBalance: { increment: new Prisma.Decimal(increment) } },
      });
    }

    return entry;
  });
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
  transaction: {
    id: string;
    date: Date;
    description: string;
    amount: number;
    // FX: frozen per-row rate + home amount (home per 1 foreign unit).
    currency?: string;
    fxRate?: number;
    amountHome?: number;
  },
  bankAccountCode: string | undefined,
  categoryCode: string,
  companyId: string,
  entryDate: Date = transaction.date,
  tx?: Prisma.TransactionClient
) {
  if (!bankAccountCode) {
    // Never guess (e.g. defaulting to a checking account's code) — a credit
    // card transaction posted against the wrong GL account silently
    // misclassifies a liability as an asset movement. Fail loudly instead;
    // the fix is to link the financial account to a GL account.
    throw new Error(`Transaction ${transaction.id}'s bank/card account has no linked GL account code. Link it in Chart of Accounts before posting.`);
  }
  const amount = Math.abs(transaction.amount);
  const isInflow = transaction.amount > 0;
  const bankCode = bankAccountCode;

  // FX: the journal posts HOME amounts (debit/credit invariant); the foreign
  // columns carry the row's own currency and rate.
  const homeAmount = transaction.amountHome !== undefined ? Math.abs(transaction.amountHome) : amount;
  const fxCols =
    transaction.currency && transaction.fxRate
      ? {
          currency: transaction.currency,
          fxRate: transaction.fxRate,
          debitForeign: isInflow ? amount : undefined,
          creditForeign: isInflow ? undefined : amount,
        }
      : {};

  const lines = isInflow
    ? [
        { glAccountCode: bankCode, description: transaction.description, debit: homeAmount, credit: 0, ...fxCols },
        { glAccountCode: categoryCode, description: `Revenue — ${transaction.description}`, debit: 0, credit: homeAmount },
      ]
    : [
        { glAccountCode: categoryCode, description: transaction.description, debit: homeAmount, credit: 0 },
        { glAccountCode: bankCode, description: `Payment — ${transaction.description}`, debit: 0, credit: homeAmount, ...fxCols },
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
  reversalDate: Date = new Date(),
  outerTx?: Prisma.TransactionClient // pass in an existing transaction (e.g. void-then-repost) for atomicity
) {
  const run = async (tx: Prisma.TransactionClient) => {
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
          // Swap the foreign columns too, or per-currency balances drift on any void.
          currency: l.currency ?? undefined,
          fxRate: l.fxRate ? Number(l.fxRate) : undefined,
          debitForeign: l.creditForeign ? Number(l.creditForeign) : undefined,
          creditForeign: l.debitForeign ? Number(l.debitForeign) : undefined,
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
  };

  return outerTx ? run(outerTx) : db.$transaction(run);
}
