-- Operator-only fixture. Replace the ONE owner placeholder with a verified
-- existing User.id; execute the whole file in one call. Never expose via an API.
-- Repeat calls return without changing any existing sample-company data.
DO $sample$
DECLARE
  owner_id text := 'REPLACE_WITH_VERIFIED_EXISTING_OWNER_ID';
  company_id text;
  prefix text;
  free_plan text;
  year_start timestamp := date_trunc('year', CURRENT_TIMESTAMP);
  opening_id text;
BEGIN
  IF owner_id = 'REPLACE_WITH_VERIFIED_EXISTING_OWNER_ID'
     OR NOT EXISTS (SELECT 1 FROM "User" WHERE id = owner_id) THEN
    RAISE EXCEPTION 'Supply a verified existing owner User.id';
  END IF;
  -- One fixture per owner; serialize concurrent requests without a schema change.
  PERFORM pg_advisory_xact_lock(hashtextextended('ledgerpro-sample-v1:' || owner_id, 0));
  prefix := 'sample_v1_' || md5(owner_id);
  company_id := prefix || '_company';
  IF EXISTS (SELECT 1 FROM "Company" WHERE id = company_id) THEN
    IF NOT EXISTS (SELECT 1 FROM "Membership" WHERE "companyId" = company_id
                   AND "userId" = owner_id AND role = 'owner')
       OR NOT EXISTS (SELECT 1 FROM "AuditLog" WHERE "companyId" = company_id
                      AND action = 'sample_company.create.v1') THEN
      RAISE EXCEPTION 'Sample ID collision or ownership mismatch; no changes made';
    END IF;
    RAISE NOTICE 'Sample already exists: %. No data or subscription reset.', company_id;
    RETURN;
  END IF;
  SELECT id INTO free_plan FROM "Plan"
   WHERE name = 'Free Trial' AND "monthlyPrice" = 0 AND "annualPrice" = 0
   ORDER BY id LIMIT 1;
  IF free_plan IS NULL THEN
    RAISE EXCEPTION 'Expected zero-price Free Trial plan is missing';
  END IF;

  INSERT INTO "Company" (id, name, "legalName", "fiscalYearStart", "fiscalYearEnd",
    "businessType", province, currency, locale, timezone, "onboardingComplete",
    "enabledCurrencies", "apiAccessEnabled", "updatedAt")
  VALUES (company_id, 'LedgerPro Sample — Maple Practice Ltd.',
    'FICTIONAL TRAINING COMPANY — NOT A REGISTERED BUSINESS', year_start,
    year_start + interval '1 year' - interval '1 day', 'corporation', 'AB', 'CAD',
    'en-CA', 'America/Edmonton', true, ARRAY['CAD'], false, now());
  INSERT INTO "Membership" (id, "userId", "companyId", role, "updatedAt")
    VALUES (prefix || '_owner', owner_id, company_id, 'owner', now());
  -- Identical ordinary trial duration to createCompanyForUser. No paid-plan
  -- flags, Stripe IDs, API activation, trial extension or bank-feed entitlement.
  INSERT INTO "Subscription" (id, "companyId", "planId", status,
    "trialEndsAt", "currentPeriodStart", "currentPeriodEnd", "updatedAt")
  VALUES (prefix || '_subscription', company_id, free_plan, 'trialing',
    now() + interval '30 days', now(), now() + interval '1 month', now());

  INSERT INTO "ChartOfAccount" (id, "companyId", code, name, type, "subType", balance, "updatedAt")
  SELECT prefix || '_gl_' || code, company_id, code, name, type::"GLType",
         subtype::"AccountSubType", balance, now()
  FROM (VALUES
    ('1010', 'Sample Operating Bank', 'asset', 'current_asset', 10000),
    ('1100', 'Accounts Receivable', 'asset', 'current_asset', 0),
    ('1500', 'Furniture & Equipment', 'asset', 'fixed_asset', 2000),
    ('2200', 'Accounts Payable', 'liability', 'current_liability', 0),
    ('2300', 'Sales Tax Payable', 'liability', 'current_liability', 0),
    ('3000', 'Share Capital', 'equity', 'common_shares', 12000),
    ('3100', 'Retained Earnings', 'equity', 'retained_earnings', 0),
    ('4100', 'Service Revenue', 'income', NULL, 0),
    ('6800', 'Office Supplies', 'expense', NULL, 0),
    ('6900', 'Bank Fees', 'expense', NULL, 0)
  ) AS chart(code, name, type, subtype, balance);

  INSERT INTO "FinancialAccount" (id, "companyId", name, kind, institution,
    currency, "currentBalance", "glAccountCode", "syncStatus", "updatedAt")
  VALUES (prefix || '_bank', company_id, 'SAMPLE ONLY — Manual Chequing',
    'checking', 'OTHER', 'CAD', 10000, '1010', 'manual', now());
  opening_id := prefix || '_opening';
  INSERT INTO "JournalEntry" (id, "companyId", "entryDate", description,
    "sourceType", "sourceId", "createdBy")
  VALUES (opening_id, company_id, year_start, 'SAMPLE opening capital and equipment',
    'manual', prefix || '_opening', owner_id);
  INSERT INTO "JournalLine" (id, "journalEntryId", "glAccountCode", description, debit, credit)
  VALUES (prefix || '_line_bank', opening_id, '1010', 'Fictional opening cash', 10000, 0),
    (prefix || '_line_equipment', opening_id, '1500', 'Fictional opening equipment', 2000, 0),
    (prefix || '_line_capital', opening_id, '3000', 'Fictional opening share capital', 0, 12000);

  INSERT INTO "Contact" (id, "companyId", name, type, notes, "updatedAt")
  VALUES (prefix || '_customer', company_id, 'SAMPLE — Prairie Design Studio', 'customer',
    'Fictional training contact. No email or phone; do not send documents.', now()),
    (prefix || '_supplier', company_id, 'SAMPLE — Foothills Office Supply', 'supplier',
    'Fictional training contact. No email or phone; do not send documents.', now());
  INSERT INTO "Invoice" (id, "companyId", "customerId", "issueDate", "dueDate",
    subtotal, "taxRate", "taxAmount", total, status, notes, "updatedAt")
  VALUES (prefix || '_invoice', company_id, prefix || '_customer', CURRENT_DATE,
    CURRENT_DATE + interval '30 days', 1000, 5, 50, 1050, 'draft',
    'SAMPLE DRAFT — illustrative Alberta GST arithmetic only. Not posted or sent. Review tax configuration before use.', now());
  INSERT INTO "InvoiceLineItem" (id, "invoiceId", description, quantity, "unitPrice", amount, "categoryId")
  VALUES (prefix || '_invoice_line', prefix || '_invoice', 'SAMPLE consulting services',
    1, 1000, 1000, prefix || '_gl_4100');
  INSERT INTO "Bill" (id, "companyId", kind, "vendorId", "billDate", "dueDate",
    subtotal, "taxRate", "taxAmount", total, status, notes, "updatedAt")
  VALUES (prefix || '_bill', company_id, 'bill', prefix || '_supplier', CURRENT_DATE,
    CURRENT_DATE + interval '30 days', 200, 5, 10, 210, 'draft',
    'SAMPLE DRAFT — illustrative Alberta GST arithmetic only. Not posted or paid. No ITC claimed.', now());
  INSERT INTO "BillLineItem" (id, "billId", description, amount, "categoryId")
  VALUES (prefix || '_bill_line', prefix || '_bill', 'SAMPLE office supplies', 200, prefix || '_gl_6800');

  INSERT INTO "Transaction" (id, "companyId", "financialAccountId", date,
    description, amount, status, source, "updatedAt")
  VALUES (prefix || '_tx_deposit', company_id, prefix || '_bank', CURRENT_DATE,
    'SAMPLE unposted customer receipt', 1050, 'toreview', 'manual', now()),
    (prefix || '_tx_purchase', company_id, prefix || '_bank', CURRENT_DATE,
    'SAMPLE unposted supplier payment', -210, 'toreview', 'manual', now()),
    (prefix || '_tx_fee', company_id, prefix || '_bank', CURRENT_DATE,
    'SAMPLE unposted bank fee', -15, 'toreview', 'manual', now());
  INSERT INTO "AuditLog" (id, "companyId", "userId", action, "entityType", "entityId", metadata)
  VALUES (prefix || '_audit', company_id, owner_id, 'sample_company.create.v1',
    'company', company_id, '{"fixtureVersion":1,"fictional":true,"noExternalActions":true}'::jsonb);
  IF (SELECT sum(debit - credit) FROM "JournalLine" WHERE "journalEntryId" = opening_id) <> 0 THEN
    RAISE EXCEPTION 'Sample opening journal must balance';
  END IF;
  RAISE NOTICE 'Created sample company: %', company_id;
END
$sample$;
