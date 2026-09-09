-- P1-F: retain the exact financial account on payment journal entries so
-- settlement reversals can update the correct bank/card subledger.
CREATE UNIQUE INDEX "FinancialAccount_companyId_id_key"
ON "FinancialAccount"("companyId", "id");

ALTER TABLE "JournalEntry" ADD COLUMN "paymentAccountId" TEXT;

CREATE INDEX "JournalEntry_companyId_paymentAccountId_idx"
ON "JournalEntry"("companyId", "paymentAccountId");

ALTER TABLE "JournalEntry"
ADD CONSTRAINT "JournalEntry_companyId_paymentAccountId_fkey"
FOREIGN KEY ("companyId", "paymentAccountId")
REFERENCES "FinancialAccount"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
