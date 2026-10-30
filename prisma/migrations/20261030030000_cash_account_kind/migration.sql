-- Cash (petty cash) financial accounts: receipt-driven expenses can be
-- recorded against cash on hand instead of only bank/card accounts.
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'cash';
