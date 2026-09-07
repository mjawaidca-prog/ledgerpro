-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('sole_proprietor', 'partnership', 'corporation', 'nonprofit', 'other');

-- CreateEnum
CREATE TYPE "CanadianProvince" AS ENUM ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'admin', 'bookkeeper', 'viewer');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'expired');

-- CreateEnum
CREATE TYPE "GLType" AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');

-- CreateEnum
CREATE TYPE "AccountSubType" AS ENUM ('current_asset', 'fixed_asset', 'other_asset', 'current_liability', 'long_term_liability', 'common_shares', 'retained_earnings', 'owners_equity', 'other_equity');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('checking', 'savings', 'creditcard', 'payoutclearing');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('manual', 'connected', 'error', 'paused');

-- CreateEnum
CREATE TYPE "SignDirection" AS ENUM ('normal', 'inverted');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('toreview', 'categorized', 'excluded', 'transfer', 'reconciled', 'voided');

-- CreateEnum
CREATE TYPE "TxSource" AS ENUM ('feed', 'csv', 'ofx', 'pdf', 'manual');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('customer', 'supplier');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'sent', 'paid', 'overdue', 'void');

-- CreateEnum
CREATE TYPE "BillKind" AS ENUM ('bill', 'expense');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('draft', 'open', 'paid', 'overdue', 'void');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('invoice', 'bill', 'payment', 'transfer', 'manual', 'revaluation');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('draft', 'mapped', 'confirmed', 'imported', 'error');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('monthly', 'quarterly', 'annual');

-- CreateEnum
CREATE TYPE "CloseStatus" AS ENUM ('draft', 'closed', 'reopened');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('invoice_overdue', 'bill_due', 'reconciliation_needed', 'import_complete', 'transfer_detected', 'period_close_reminder', 'subscription_expiring', 'member_joined', 'system', 'import_reminder');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('weekly', 'monthly', 'quarterly', 'annual');

-- CreateEnum
CREATE TYPE "InterCompanyKind" AS ENUM ('FUND_TRANSFER', 'EXPENSE_ON_BEHALF', 'RECHARGE', 'JOURNAL');

-- CreateEnum
CREATE TYPE "InterCompanyStatus" AS ENUM ('POSTED', 'VOIDED', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "InterCompanyRole" AS ENUM ('SOURCE', 'MIRROR');

-- CreateEnum
CREATE TYPE "RulePatternType" AS ENUM ('merchant_match', 'description_contains', 'amount_range', 'regex');

-- CreateEnum
CREATE TYPE "ExchangeRateType" AS ENUM ('closing', 'average', 'daily');

-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('feed', 'manual');

-- CreateEnum
CREATE TYPE "BankInstitution" AS ENUM ('RBC', 'TD', 'BMO', 'SCOTIA', 'CIBC', 'DESJARDINS', 'NBC', 'TANGERINE', 'EQ', 'OTHER');

-- CreateEnum
CREATE TYPE "PresetDateFormat" AS ENUM ('MDY', 'MM_DD_YYYY', 'YYYY_MM_DD', 'YYYYMMDD', 'DD_MM_YYYY');

-- CreateEnum
CREATE TYPE "PresetAmountMode" AS ENUM ('signed', 'debit_credit');

-- CreateEnum
CREATE TYPE "StatementImportStatus" AS ENUM ('imported', 'partial', 'all_duplicates', 'failed');

-- CreateEnum
CREATE TYPE "RuleOp" AS ENUM ('contains', 'is', 'starts_with');

-- CreateEnum
CREATE TYPE "ReconciliationState" AS ENUM ('open', 'locked', 'closed_with_variance');

-- CreateEnum
CREATE TYPE "ReminderCadence" AS ENUM ('monthly', 'semimonthly', 'weekly');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "emailVerificationToken" TEXT,
    "passwordHash" TEXT,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "fiscalYearStart" TIMESTAMP(3) NOT NULL,
    "fiscalYearEnd" TIMESTAMP(3),
    "businessType" "BusinessType",
    "businessNumber" TEXT,
    "gstNumber" TEXT,
    "province" "CanadianProvince",
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "locale" TEXT NOT NULL DEFAULT 'en-CA',
    "timezone" TEXT NOT NULL DEFAULT 'America/Edmonton',
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "enabledCurrencies" TEXT[] DEFAULT ARRAY['CAD']::TEXT[],
    "rateSource" TEXT NOT NULL DEFAULT 'bank_of_canada',
    "realizedFxAccountCode" TEXT,
    "unrealizedFxAccountCode" TEXT,
    "fxRoundingAccountCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stripePriceId" TEXT,
    "monthlyPrice" DECIMAL(10,2) NOT NULL,
    "annualPrice" DECIMAL(10,2) NOT NULL,
    "maxUsers" INTEGER NOT NULL DEFAULT 1,
    "maxCompanies" INTEGER NOT NULL DEFAULT 1,
    "maxTransactions" INTEGER NOT NULL DEFAULT 500,
    "maxBankAccounts" INTEGER NOT NULL DEFAULT 1,
    "csvExport" BOOLEAN NOT NULL DEFAULT true,
    "pdfReports" BOOLEAN NOT NULL DEFAULT false,
    "bankFeeds" BOOLEAN NOT NULL DEFAULT false,
    "customReports" BOOLEAN NOT NULL DEFAULT false,
    "prioritySupport" BOOLEAN NOT NULL DEFAULT false,
    "whiteLabel" BOOLEAN NOT NULL DEFAULT false,
    "features" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "stripeSubscriptionId" TEXT,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartOfAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GLType" NOT NULL,
    "subType" "AccountSubType",
    "gifiCode" TEXT,
    "detailType" TEXT,
    "parentCode" TEXT,
    "description" TEXT,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isControlAccount" BOOLEAN NOT NULL DEFAULT false,
    "relatedPartyCompanyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartOfAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mask" TEXT,
    "kind" "AccountKind" NOT NULL,
    "institution" "BankInstitution" NOT NULL DEFAULT 'OTHER',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "lastImportAt" TIMESTAMP(3),
    "lockedThrough" TIMESTAMP(3),
    "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "glAccountCode" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'manual',
    "lastSyncedAt" TIMESTAMP(3),
    "plaidItemId" TEXT,
    "plaidAccessToken" TEXT,
    "displayColor" TEXT,
    "logoInitials" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColumnMapping" (
    "id" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "profileName" TEXT,
    "dateColumn" TEXT NOT NULL,
    "descriptionColumn" TEXT NOT NULL,
    "amountColumn" TEXT,
    "debitColumn" TEXT,
    "creditColumn" TEXT,
    "balanceColumn" TEXT,
    "signDirection" "SignDirection" NOT NULL DEFAULT 'normal',
    "skipRows" INTEGER NOT NULL DEFAULT 0,
    "dateFormat" TEXT NOT NULL DEFAULT 'yyyy-MM-dd',
    "headerSignature" TEXT,
    "mappingsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ColumnMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "merchant" TEXT,
    "rawStatementText" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "fxRate" DECIMAL(18,8),
    "amountHome" DECIMAL(14,2),
    "statementImportId" TEXT,
    "dedupeHash" TEXT,
    "payeeGuess" TEXT,
    "contactId" TEXT,
    "memo" TEXT,
    "reference" TEXT,
    "statementBalance" DECIMAL(14,2),
    "taxCode" TEXT,
    "taxRate" DECIMAL(5,3),
    "taxAmount" DECIMAL(14,2),
    "splits" JSONB,
    "matchedDocs" JSONB,
    "appliedRuleId" TEXT,
    "reconciledInId" TEXT,
    "categoryId" TEXT,
    "suggestedCategoryId" TEXT,
    "status" "TxStatus" NOT NULL DEFAULT 'toreview',
    "excludeReason" TEXT,
    "matchRef" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "reconciledBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "importBatchId" TEXT,
    "source" "TxSource" NOT NULL DEFAULT 'manual',
    "transferMatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferMatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "outflowTxId" TEXT NOT NULL,
    "inflowTxId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "matchDate" TIMESTAMP(3) NOT NULL,
    "matchConfidence" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "type" "ContactType" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "outstandingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "ContactStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "terms" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,3) DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "fxRate" DECIMAL(18,8),
    "fxRateSource" "RateSource",
    "fxRateDate" TIMESTAMP(3),
    "totalHome" DECIMAL(14,2),
    "paidAmountHome" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "paymentAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "categoryId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "BillKind" NOT NULL,
    "vendorId" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "terms" TEXT,
    "referenceNo" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,3) DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "fxRate" DECIMAL(18,8),
    "fxRateSource" "RateSource",
    "fxRateDate" TIMESTAMP(3),
    "totalHome" DECIMAL(14,2),
    "paidAmountHome" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importTaxAmount" DECIMAL(14,2),
    "status" "BillStatus" NOT NULL DEFAULT 'draft',
    "paymentAccountId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillLineItem" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "categoryId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BillLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" "JournalSource" NOT NULL,
    "sourceId" TEXT,
    "transferMatchId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "reversalOfId" TEXT,
    "interCompanyId" TEXT,
    "interCompanyRole" "InterCompanyRole",
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "glAccountCode" TEXT NOT NULL,
    "description" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT DEFAULT 'CAD',
    "fxRate" DECIMAL(18,8),
    "debitForeign" DECIMAL(14,2),
    "creditForeign" DECIMAL(14,2),

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" "TxSource" NOT NULL,
    "fileSize" INTEGER,
    "rowsParsed" INTEGER NOT NULL,
    "rowsImported" INTEGER NOT NULL,
    "duplicatesFound" INTEGER NOT NULL DEFAULT 0,
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "columnMappingId" TEXT,
    "mappingConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "importConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "errors" JSONB,
    "status" "ImportStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "period" "BudgetPeriod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "glAccountCode" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "period" TEXT,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodClose" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "status" "CloseStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeriodClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionUrl" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "province" "CanadianProvince" NOT NULL,
    "provinceName" TEXT NOT NULL,
    "gst" DECIMAL(5,3) NOT NULL DEFAULT 5.00,
    "hst" DECIMAL(5,3) NOT NULL DEFAULT 0,
    "pst" DECIMAL(5,3) NOT NULL DEFAULT 0,
    "totalSalesTax" DECIMAL(5,3) NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "frequency" "RecurringFrequency" NOT NULL,
    "nextPostDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sourceType" "JournalSource" NOT NULL DEFAULT 'manual',
    "lastPostedAt" TIMESTAMP(3),
    "timesPosted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringLine" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "glAccountCode" TEXT NOT NULL,
    "description" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecurringLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelatedPartyLink" (
    "id" TEXT NOT NULL,
    "companyAId" TEXT NOT NULL,
    "companyBId" TEXT NOT NULL,
    "aDueFromAccountId" TEXT NOT NULL,
    "aDueToAccountId" TEXT NOT NULL,
    "bDueFromAccountId" TEXT NOT NULL,
    "bDueToAccountId" TEXT NOT NULL,
    "aOwnershipOfB" DECIMAL(5,2) DEFAULT 100,
    "bOwnershipOfA" DECIMAL(5,2) DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelatedPartyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterCompanyTransaction" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "sourceCompanyId" TEXT NOT NULL,
    "targetCompanyId" TEXT NOT NULL,
    "kind" "InterCompanyKind" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "fxRate" DECIMAL(18,8),
    "memo" TEXT,
    "sourceEntryId" TEXT NOT NULL,
    "mirrorEntryId" TEXT,
    "status" "InterCompanyStatus" NOT NULL DEFAULT 'POSTED',
    "createdById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterCompanyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategorizationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "patternType" "RulePatternType" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "minAmount" DECIMAL(14,2),
    "maxAmount" DECIMAL(14,2),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "lastMatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategorizationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "type" "ExchangeRateType" NOT NULL,
    "source" "RateSource" NOT NULL DEFAULT 'manual',
    "fetchedAt" TIMESTAMP(3),
    "enteredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportPackage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setup" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRevaluation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "rateType" "ExchangeRateType" NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "reversalEntryId" TEXT,
    "lines" JSONB NOT NULL,
    "postedById" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "FxRevaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxFeedStatus" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastResults" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FxFeedStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportPreset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "institution" "BankInstitution" NOT NULL,
    "label" TEXT NOT NULL,
    "fileTypes" TEXT[],
    "hasHeader" BOOLEAN NOT NULL DEFAULT true,
    "dateFormat" "PresetDateFormat" NOT NULL,
    "amountMode" "PresetAmountMode" NOT NULL,
    "columnMap" JSONB NOT NULL,
    "headerSignature" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementImport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileType" "TxSource" NOT NULL,
    "presetId" TEXT,
    "mappingJson" JSONB,
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "rowsTotal" INTEGER NOT NULL,
    "rowsImported" INTEGER NOT NULL,
    "rowsSkippedDuplicate" INTEGER NOT NULL DEFAULT 0,
    "rowsSkippedLocked" INTEGER NOT NULL DEFAULT 0,
    "rulesApplied" INTEGER NOT NULL DEFAULT 0,
    "status" "StatementImportStatus" NOT NULL,
    "createdById" TEXT,
    "reversibleUntil" TIMESTAMP(3) NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "op" "RuleOp" NOT NULL,
    "value" TEXT NOT NULL,
    "anyOf" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scope" JSONB NOT NULL,
    "setCategoryCode" TEXT,
    "setTaxCode" TEXT,
    "setTaxRate" DECIMAL(5,3),
    "setTaxInclusive" BOOLEAN NOT NULL DEFAULT true,
    "setContactId" TEXT,
    "autoPost" BOOLEAN NOT NULL DEFAULT false,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "statementClosingBalance" DECIMAL(14,2) NOT NULL,
    "ledgerBalance" DECIMAL(14,2),
    "difference" DECIMAL(14,2),
    "unrecordedItems" JSONB,
    "state" "ReconciliationState" NOT NULL DEFAULT 'open',
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "varianceReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportReminder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cadence" "ReminderCadence" NOT NULL DEFAULT 'monthly',
    "dayOfMonth" INTEGER,
    "dayOfWeek" INTEGER,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT[] DEFAULT ARRAY['in_app']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_companyId_role_idx" ON "Membership"("companyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_companyId_key" ON "Membership"("userId", "companyId");

-- CreateIndex
CREATE INDEX "Subscription_companyId_idx" ON "Subscription"("companyId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "ChartOfAccount_companyId_type_idx" ON "ChartOfAccount"("companyId", "type");

-- CreateIndex
CREATE INDEX "ChartOfAccount_parentCode_idx" ON "ChartOfAccount"("parentCode");

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccount_companyId_code_key" ON "ChartOfAccount"("companyId", "code");

-- CreateIndex
CREATE INDEX "FinancialAccount_companyId_idx" ON "FinancialAccount"("companyId");

-- CreateIndex
CREATE INDEX "ColumnMapping_financialAccountId_headerSignature_idx" ON "ColumnMapping"("financialAccountId", "headerSignature");

-- CreateIndex
CREATE UNIQUE INDEX "ColumnMapping_financialAccountId_profileName_key" ON "ColumnMapping"("financialAccountId", "profileName");

-- CreateIndex
CREATE INDEX "Transaction_companyId_financialAccountId_date_idx" ON "Transaction"("companyId", "financialAccountId", "date");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");

-- CreateIndex
CREATE INDEX "Transaction_importBatchId_idx" ON "Transaction"("importBatchId");

-- CreateIndex
CREATE INDEX "Transaction_financialAccountId_dedupeHash_idx" ON "Transaction"("financialAccountId", "dedupeHash");

-- CreateIndex
CREATE UNIQUE INDEX "TransferMatch_outflowTxId_key" ON "TransferMatch"("outflowTxId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferMatch_inflowTxId_key" ON "TransferMatch"("inflowTxId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferMatch_journalEntryId_key" ON "TransferMatch"("journalEntryId");

-- CreateIndex
CREATE INDEX "TransferMatch_companyId_confirmed_idx" ON "TransferMatch"("companyId", "confirmed");

-- CreateIndex
CREATE INDEX "Contact_companyId_type_idx" ON "Contact"("companyId", "type");

-- CreateIndex
CREATE INDEX "Contact_companyId_status_idx" ON "Contact"("companyId", "status");

-- CreateIndex
CREATE INDEX "Invoice_companyId_customerId_idx" ON "Invoice"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_status_idx" ON "Invoice"("companyId", "status");

-- CreateIndex
CREATE INDEX "Invoice_issueDate_idx" ON "Invoice"("issueDate");

-- CreateIndex
CREATE INDEX "Bill_companyId_vendorId_idx" ON "Bill"("companyId", "vendorId");

-- CreateIndex
CREATE INDEX "Bill_companyId_kind_idx" ON "Bill"("companyId", "kind");

-- CreateIndex
CREATE INDEX "Bill_companyId_status_idx" ON "Bill"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_transferMatchId_key" ON "JournalEntry"("transferMatchId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversalOfId_key" ON "JournalEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_entryDate_idx" ON "JournalEntry"("companyId", "entryDate");

-- CreateIndex
CREATE INDEX "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalEntry_interCompanyId_idx" ON "JournalEntry"("interCompanyId");

-- CreateIndex
CREATE INDEX "JournalLine_glAccountCode_idx" ON "JournalLine"("glAccountCode");

-- CreateIndex
CREATE INDEX "ImportBatch_companyId_financialAccountId_idx" ON "ImportBatch"("companyId", "financialAccountId");

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_companyId_name_fiscalYear_key" ON "Budget"("companyId", "name", "fiscalYear");

-- CreateIndex
CREATE INDEX "BudgetLine_glAccountCode_idx" ON "BudgetLine"("glAccountCode");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodClose_companyId_periodStart_periodEnd_key" ON "PeriodClose"("companyId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_companyId_createdAt_idx" ON "Notification"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRate_province_key" ON "TaxRate"("province");

-- CreateIndex
CREATE INDEX "RelatedPartyLink_companyBId_idx" ON "RelatedPartyLink"("companyBId");

-- CreateIndex
CREATE UNIQUE INDEX "RelatedPartyLink_companyAId_companyBId_key" ON "RelatedPartyLink"("companyAId", "companyBId");

-- CreateIndex
CREATE UNIQUE INDEX "InterCompanyTransaction_reference_key" ON "InterCompanyTransaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "InterCompanyTransaction_sourceEntryId_key" ON "InterCompanyTransaction"("sourceEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "InterCompanyTransaction_mirrorEntryId_key" ON "InterCompanyTransaction"("mirrorEntryId");

-- CreateIndex
CREATE INDEX "InterCompanyTransaction_sourceCompanyId_date_idx" ON "InterCompanyTransaction"("sourceCompanyId", "date");

-- CreateIndex
CREATE INDEX "InterCompanyTransaction_targetCompanyId_date_idx" ON "InterCompanyTransaction"("targetCompanyId", "date");

-- CreateIndex
CREATE INDEX "InterCompanyTransaction_linkId_idx" ON "InterCompanyTransaction"("linkId");

-- CreateIndex
CREATE INDEX "ExchangeRate_from_to_type_date_idx" ON "ExchangeRate"("from", "to", "type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_date_from_to_type_source_key" ON "ExchangeRate"("date", "from", "to", "type", "source");

-- CreateIndex
CREATE INDEX "ReportPackage_userId_idx" ON "ReportPackage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FxRevaluation_journalEntryId_key" ON "FxRevaluation"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "FxRevaluation_reversalEntryId_key" ON "FxRevaluation"("reversalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "FxRevaluation_companyId_asOf_key" ON "FxRevaluation"("companyId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "FxFeedStatus_companyId_key" ON "FxFeedStatus"("companyId");

-- CreateIndex
CREATE INDEX "ImportPreset_institution_isSystem_idx" ON "ImportPreset"("institution", "isSystem");

-- CreateIndex
CREATE INDEX "StatementImport_companyId_financialAccountId_createdAt_idx" ON "StatementImport"("companyId", "financialAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "BankRule_companyId_order_idx" ON "BankRule"("companyId", "order");

-- CreateIndex
CREATE INDEX "Reconciliation_companyId_financialAccountId_state_idx" ON "Reconciliation"("companyId", "financialAccountId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ImportReminder_companyId_key" ON "ImportReminder"("companyId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartOfAccount" ADD CONSTRAINT "ChartOfAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColumnMapping" ADD CONSTRAINT "ColumnMapping_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_statementImportId_fkey" FOREIGN KEY ("statementImportId") REFERENCES "StatementImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_appliedRuleId_fkey" FOREIGN KEY ("appliedRuleId") REFERENCES "BankRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_reconciledInId_fkey" FOREIGN KEY ("reconciledInId") REFERENCES "Reconciliation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferMatch" ADD CONSTRAINT "TransferMatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferMatch" ADD CONSTRAINT "TransferMatch_outflowTxId_fkey" FOREIGN KEY ("outflowTxId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferMatch" ADD CONSTRAINT "TransferMatch_inflowTxId_fkey" FOREIGN KEY ("inflowTxId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLineItem" ADD CONSTRAINT "BillLineItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLineItem" ADD CONSTRAINT "BillLineItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ChartOfAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_transferMatchId_fkey" FOREIGN KEY ("transferMatchId") REFERENCES "TransferMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_columnMappingId_fkey" FOREIGN KEY ("columnMappingId") REFERENCES "ColumnMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodClose" ADD CONSTRAINT "PeriodClose_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTemplate" ADD CONSTRAINT "RecurringTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringLine" ADD CONSTRAINT "RecurringLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecurringTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatedPartyLink" ADD CONSTRAINT "RelatedPartyLink_companyAId_fkey" FOREIGN KEY ("companyAId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatedPartyLink" ADD CONSTRAINT "RelatedPartyLink_companyBId_fkey" FOREIGN KEY ("companyBId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterCompanyTransaction" ADD CONSTRAINT "InterCompanyTransaction_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "RelatedPartyLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterCompanyTransaction" ADD CONSTRAINT "InterCompanyTransaction_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterCompanyTransaction" ADD CONSTRAINT "InterCompanyTransaction_mirrorEntryId_fkey" FOREIGN KEY ("mirrorEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterCompanyTransaction" ADD CONSTRAINT "InterCompanyTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategorizationRule" ADD CONSTRAINT "CategorizationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategorizationRule" ADD CONSTRAINT "CategorizationRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ChartOfAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxRevaluation" ADD CONSTRAINT "FxRevaluation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxRevaluation" ADD CONSTRAINT "FxRevaluation_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxRevaluation" ADD CONSTRAINT "FxRevaluation_reversalEntryId_fkey" FOREIGN KEY ("reversalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxFeedStatus" ADD CONSTRAINT "FxFeedStatus_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportPreset" ADD CONSTRAINT "ImportPreset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "ImportPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankRule" ADD CONSTRAINT "BankRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankRule" ADD CONSTRAINT "BankRule_setContactId_fkey" FOREIGN KEY ("setContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportReminder" ADD CONSTRAINT "ImportReminder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
