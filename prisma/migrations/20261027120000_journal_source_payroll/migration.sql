-- Block B1 (2026-10-27): add 'payroll' to the JournalSource enum so journals
-- posted by the Nexvar Pay payroll sync are stamped as payroll instead of
-- manual. Additive only; existing rows are untouched.
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'payroll';
