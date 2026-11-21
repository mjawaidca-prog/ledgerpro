-- Receipt/bill OCR into draft entries (LedgerPro improvement plan,
-- Phase 2 item 2): the receipt inbox gains an AI document-intelligence
-- read (Azure Document Intelligence prebuilt receipt) alongside the
-- existing text pipeline. The provider returns vendor / date / total /
-- tax / currency / line items WITH per-field confidence; the raw
-- result is stored verbatim in extractionFields (JSONB) so the
-- reviewer sees exactly what the model said, and the pipeline mirrors
-- the found values into the existing ocr* suggestion columns.
--
-- extractionStatus: pending → extracted | failed | unavailable.
-- 'unavailable' means no OCR provider is configured (env absent) —
-- the document is still stored and nothing is fabricated.
--
-- draftBillId links the receipt to the draft expense (Bill,
-- kind='expense', status='draft') created from its extraction — a
-- loose reference, the same pattern as JournalEntry.sourceId (no FK:
-- the bill must never be able to block receipt evidence retention,
-- and deleting a draft must not touch the receipt).
--
-- Additive only: five new nullable/defaulted columns on Receipt.
-- Every existing row keeps its meaning (extractionStatus 'pending',
-- everything else NULL = today's behaviour).
-- Apply by hand (PR #49 procedure): run in the Supabase SQL Editor,
-- then record this file in _prisma_migrations with its SHA-256.
-- Apply BEFORE deploying code that selects these columns.

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN "extractionStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Receipt" ADD COLUMN "extractionProvider" TEXT;
ALTER TABLE "Receipt" ADD COLUMN "extractionFields" JSONB;
ALTER TABLE "Receipt" ADD COLUMN "extractionError" TEXT;
ALTER TABLE "Receipt" ADD COLUMN "draftBillId" TEXT;
