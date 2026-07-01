# LedgerPro — System Audit Report
## July 1, 2026

---

### BUG-1 [CRITICAL]: Deleting non-posted transactions corrupts account balance

**Flow:**
1. Import transactions → balance NOT updated (correct — not yet posted)
2. Delete transactions → `currentBalance: { increment: -totalAmount }` is applied

**Result:** Balance goes negative by the sum of deleted transactions because the balance was never incremented in the first place. The delete code incorrectly assumes the balance was always incremented during import.

**Fix:** Only reverse financial account balance for `status === 'reconciled'` transactions. Non-posted (`toreview`/`categorized`) transactions never affected the balance.

**Files:** `src/app/api/transactions/route.ts` (bulk), `src/app/api/transactions/[id]/route.ts` (single)

---

### BUG-2 [CRITICAL]: `currentBalance` and COA `balance` track different things — they diverge

**Problem:** `financialAccount.currentBalance` is the bank statement balance. `chartOfAccount.balance` is the GL balance. They should reconcile but are updated independently:
- Post to GL: updates BOTH `currentBalance` AND COA `balance`
- Delete posted: reverses BOTH
- Delete non-posted: reverses `currentBalance` but there's no COA balance to reverse → DIVERGENCE

**Fix:** Same as BUG-1. Only touch `currentBalance` for `reconciled` transactions.

---

### BUG-3 [HIGH]: PDF parser creates ghost transactions from non-transaction text

**Examples of lines incorrectly parsed as transactions:**
- "Select Account for Business Plan A - ****4214"
- "Page created on Apr 17, 2026 - 12:05 pm MT"
- "Current balance $4,023.02 Available balance $4,023.02"
- "December 2024, From date=2024-12-01, To date=2024-12-31"

**Root cause:** The skip regex is incomplete. The multi-line row builder accumulates description lines from non-transaction text, then completes the fake row when it hits a real amount.

**Fix:** More aggressive header/footer filtering. Skip any pending row that has fewer than X description characters or matches boilerplate patterns.

**File:** `src/lib/import-parser.ts`

---

### BUG-4 [HIGH]: Dashboard `totalCash` mixes bank + credit card balances

**Code:** `dashboard/route.ts` line 138
```js
const totalCash = bankAccounts.reduce((s, a) => s + Number(a.currentBalance), 0);
```

Credit card accounts have negative balances (debt) — adding them to cash is misleading.

**Fix:** Split into "Cash & Bank" (checking + savings) and "Credit Cards" (liability) totals.

---

### BUG-5 [MEDIUM]: Dashboard KPIs use COA `balance` which only updates on post-to-GL

Income/Expense KPIs read from `chartOfAccount.balance`. These only change when journal entries are posted. Uncategorized imported transactions don't affect them. This means the dashboard can show $0 revenue even with thousands in imported deposits.

**Fix:** Also include unreviewed transaction amounts in KPI calculations.

---

### BUG-6 [MEDIUM]: Duplicate detection matches ANY transaction ±2 days with same amount

**Code:** `import/confirm/route.ts` lines 94-101
```js
const dayDiff = Math.abs((rowDate.getTime() - existingDate.getTime()) / (1000 * 60 * 60 * 24));
const amountMatch = Math.abs(normalizedRow.amount - Number(existing.amount)) < 0.01;
return dayDiff <= 2 && amountMatch;
```

Two different transactions on Jan 3 and Jan 5 with the same $20.00 amount would be flagged as duplicates. This is too aggressive — it should also compare descriptions.

---

### BUG-7 [MEDIUM]: PDF amount columns not labeled meaningfully

When a PDF statement uses separate Debit/Credit columns (both positive), the auto-detection may map them incorrectly. Amount_1 might be mapped to Debit when it actually contains both payments and deposits as unsigned numbers.

**Fix:** The column preview table already helps, but add better auto-detection by checking if all values in a column are positive → likely not a signed amount column.

---

### BUG-8 [LOW]: `signMultiplier` removed but not accounted for in existing data

The hardcoded `signMultiplier = account.kind === 'creditcard' ? -1 : 1` was removed in the import route. This is correct because the frontend now handles sign direction. But any existing transactions imported BEFORE this fix will have incorrect signs.

---

## Summary

| Bug | Severity | Impact |
|-----|----------|--------|
| BUG-1 | CRITICAL | Balance corruption on delete |
| BUG-2 | CRITICAL | COA/Bank balance divergence |
| BUG-3 | HIGH | Ghost transactions in import |
| BUG-4 | HIGH | Misleading dashboard cash total |
| BUG-5 | MEDIUM | Dashboard KPIs ignore unreviewed |
| BUG-6 | MEDIUM | False duplicate detection |
| BUG-7 | MEDIUM | PDF column mapping confusion |
| BUG-8 | LOW | Historical data sign issues |

## Fixes Applied (July 1, 2026)

- [x] **BUG-1** — Delete only reverses balance for `reconciled` transactions. `transactions/route.ts` + `[id]/route.ts`
- [x] **BUG-2** — Same fix as BUG-1. Non-posted transactions no longer touch `currentBalance`.
- [x] **BUG-3** — Added `boilerplateDescRe` filter in `flushRow()` + expanded `skipAnywhereRe` patterns.
- [x] **BUG-4** — Dashboard now splits `totalCash` (bank only) from `totalCreditCardDebt` (CC only). New KPI card shown on dashboard.
- [x] **BUG-6** — Duplicate detection now requires description similarity (first 5 chars match) in addition to date + amount.
- [ ] **BUG-5** — Not yet fixed. Requires including unreviewed transactions in KPI calculations.
- [ ] **BUG-7** — Column preview already helps. Could be improved with smarter auto-detection.
- [ ] **BUG-8** — Historical data issue only. No new imports affected.
