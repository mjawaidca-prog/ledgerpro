# Bank Import Screen Redesign Handover

## Goal

Redesign the Banking > Import Statement flow so it is simpler, safer, and easier for users to understand.

The current screen opens import with Primary Checking preselected. The new flow must start with no account selected and require the user to choose the correct account from the Chart of Accounts before upload/import.

The import preview must show all statement columns from the uploaded file and allow the user to decide which uploaded column represents payment, receipt, balance, and other fields. Credit card imports need separate user-facing labels because the accounting meaning is different.

## Summary of Required Changes

1. Change the import wizard so the account field starts blank.
2. Populate the account selector from Chart of Accounts.
3. Filter selectable accounts by account type:
   - Bank imports: bank/cash asset accounts.
   - Credit card imports: credit card liability accounts.
4. Add a mapping step that displays all uploaded columns exactly as found in the file.
5. Add a dropdown above each uploaded column so the user can assign a role.
6. Use separate wording for bank accounts and credit cards.
7. Save successful column mappings for future imports.
8. Auto-apply saved mappings next time, but keep them editable.

## Recommended User Flow

### Step 1: Select Account

The import dialog should open with:

Select account from Chart of Accounts

No account should be preselected.

The account selector should be searchable and should show:

1010 - Business Checking | Bank | Current balance $385.70
2110 - Business Credit Card | Credit Card | Current balance $1,250.00

Required behavior:

- User must select an account before continuing.
- The account list must come from Chart of Accounts.
- Do not hardcode Primary Checking.
- Do not infer the account only from the selected Banking page card.
- If helpful, the current Banking card can be shown as a suggestion, but the user must still choose/confirm the account.

Suggested UI copy:

Choose the account this statement belongs to.

Validation:

Please select a bank or credit card account before uploading a statement.

### Step 2: Upload Statement

Supported files should remain the same as current behavior:

CSV, OFX, QFX, PDF

After upload, show:

- File name
- File type
- Detected row count
- Detected date range if available
- Detected columns

Do not import yet. Upload only prepares the preview/mapping step.

### Step 3: Map Columns & Preview

This is the most important change.

The preview table should show every original column from the uploaded statement. Do not hide columns at this stage.

Above each column, add a dropdown called:

Treat as

The user selects what each column means.

For bank accounts, mapping options should be:

- Ignore
- Date
- Description
- Money Out / Payment
- Money In / Receipt
- Balance
- Reference / Cheque No.
- Memo

For credit card accounts, mapping options should be:

- Ignore
- Date
- Description
- Charge / Purchase
- Payment / Credit
- Balance
- Reference
- Memo

Important: default unrecognized columns to Ignore, but still show them.

## Bank vs Credit Card Logic

### Bank Account Meaning

For bank accounts:

- Money Out / Payment means cash leaving the bank.
- Money In / Receipt means cash entering the bank.
- Balance is the running bank balance if provided.

Normalized preview columns should be:

Date | Description | Money Out | Money In | Balance | Reference | Status

### Credit Card Meaning

For credit cards:

- Charge / Purchase means a new expense or increase in card balance.
- Payment / Credit means payment made to the card, refund, or decrease in card balance.
- Balance is the running card balance if provided.

Normalized preview columns should be:

Date | Description | Charge | Payment/Credit | Balance | Reference | Status

Do not use only the labels debit/credit in the UI. They confuse normal users. Behind the scenes, the posting logic can still use debit/credit correctly.

## Preview Layout Recommendation

Use a two-part preview:

### A. Original Statement Preview

Shows the raw uploaded columns.

Each column header has:

Original column name  
[Treat as dropdown]

Example:

Transaction Date     Description       Withdrawals          Deposits        Balance  
[Date]               [Description]     [Money Out]          [Money In]      [Balance]  
Jan 5, 2025          Vendor ABC        42.00                -               1,250.00

### B. Normalized Import Preview

Shows how the system will import the data after mapping.

Example for bank:

Date         Description       Money Out     Money In      Balance     Status  
Jan 5, 2025  Vendor ABC        $42.00        -             $1,250.00   Ready

Example for credit card:

Date         Description       Charge        Payment/Credit Balance     Status  
Jan 5, 2025  Vendor ABC        $42.00        -              $1,250.00   Ready

This lets the user see both the original file and the final accounting interpretation.

## Required Mapping Rules

Minimum required fields:

- Date
- Description
- At least one amount field

For bank accounts, valid amount setups:

1. Separate Money Out and Money In columns.
2. One signed amount column if the app already supports this. If added, label it:

Signed Amount

For credit cards, valid amount setups:

1. Separate Charge and Payment/Credit columns.
2. One signed amount column if the app already supports this.

Balance should be optional.

Reference should be optional.

Memo should be optional.

Validation messages:

Choose a Date column.  
Choose a Description column.  
Choose at least one amount column.  
Only one column can be mapped as Date.  
Only one column can be mapped as Description.  
Only one column can be mapped as Balance.

For amount columns, allow:

- One Money Out and one Money In column.
- Or one Signed Amount column.
- Do not allow both separate amount columns and Signed Amount at the same time unless the current import engine already supports that safely.

## Saved Mapping Behavior

Mappings should be saved after a successful import or when the user clicks:

Save this mapping for next time

Recommended default: checkbox enabled.

[x] Save this mapping for this account and statement format

Saved mapping should be auto-applied next time when the uploaded statement has matching/similar column headers.

The user must still be able to edit the mapping before import.

## Suggested Data Model

Create a saved mapping model/table if one does not already exist.

Suggested fields:

id  
companyId  
accountId  
accountType: bank | credit_card  
formatName  
sourceType: csv | ofx | qfx | pdf  
headerSignature  
columnMappingsJson  
createdAt  
updatedAt  
lastUsedAt

### headerSignature

Use a normalized signature of column headers to match future files.

Example:

date|description|withdrawals|deposits|balance

Normalize by:

- Lowercasing
- Trimming spaces
- Removing duplicate whitespace
- Removing punctuation if needed

### columnMappingsJson Example

Bank account:

{
  "Transaction Date": "date",
  "Description": "description",
  "Withdrawals": "money_out",
  "Deposits": "money_in",
  "Balance": "balance"
}

Credit card:

{
  "Date": "date",
  "Merchant": "description",
  "Amount Charged": "card_charge",
  "Payment": "card_payment",
  "Balance": "balance"
}

## Import Engine Changes

The import parser should return raw rows and raw columns before normalizing.

Recommended internal flow:

upload file  
parse raw columns and rows  
detect saved mapping  
show mapping UI  
user confirms mapping  
normalize rows  
validate normalized rows  
deduplicate  
create bank feed transactions  
save mapping if enabled

Avoid changing the final posting/categorization logic unless necessary. This change should mostly affect the import wizard and normalization layer.

## Implementation Areas To Check

The coder should look for modules/components with names similar to:

Banking  
BankImport  
ImportStatement  
StatementImport  
ImportPreview  
BankAccountSelector  
ChartOfAccounts  
parseStatement  
normalizeStatement  
bankTransactions

Likely changes:

- Import dialog component: remove preselected account behavior.
- Account selector component: source options from Chart of Accounts.
- Parser layer: expose raw columns and rows to UI.
- Preview component: add column mapping controls.
- Normalization function: convert user mapping to final transaction shape.
- Persistence/API layer: save and retrieve import mappings.
- Validation layer: block import until required mappings are selected.

## UI Design Notes

Keep the screen operational and accounting-focused. Avoid a marketing-style layout.

Recommended structure:

Import Statement

Step 1  Account  
Step 2  Upload  
Step 3  Map & Preview

[Account selector]  
[Upload area]  
[Raw preview with mapping dropdowns]  
[Normalized preview]  
[Import button]

Use clear button labels:

- Back
- Continue
- Import transactions
- Cancel

Use compact helper text, not long explanations.

Good helper text:

Select how each statement column should be used.

Avoid:

This page allows you to configure every possible accounting transformation...

## Edge Cases

Handle these carefully:

- Uploaded file has no headers.
- Uploaded file has duplicate column names.
- Statement uses one signed amount column.
- Statement uses separate debit/credit columns.
- Credit card statement has charges as positive numbers.
- Credit card statement has charges as negative numbers.
- Amounts contain commas, currency symbols, brackets, or minus signs.
- Dates use Canadian formats such as 2025-01-31, 31/01/2025, or Jan 31, 2025.
- Balance column is missing.
- Same file is uploaded twice.
- Saved mapping exists but one column name changed.

## Duplicate Detection

Keep existing duplicate detection if it already works.

If it needs improvement, use a stable key such as:

accountId + date + normalized description + amount + reference

If reference is missing:

accountId + date + normalized description + amount

Show duplicate rows in preview with status:

Possible duplicate

Do not silently import duplicates.

## Acceptance Criteria

The feature is complete when:

1. Import Statement opens with no account selected.
2. Account selector lists accounts from Chart of Accounts.
3. Bank imports show bank wording: Money Out / Money In.
4. Credit card imports show credit card wording: Charge / Payment/Credit.
5. Uploaded preview shows every original column.
6. User can map columns before importing.
7. Import is blocked until required fields are mapped.
8. Normalized preview updates when mappings change.
9. Mapping can be saved for future use.
10. Saved mapping auto-applies on a later matching upload.
11. User can edit an auto-applied mapping before import.
12. Existing transaction review/categorization flow still works after import.

## Testing Checklist

Test with at least these files:

- Bank CSV with Withdrawals and Deposits columns.
- Bank CSV with one signed Amount column.
- Credit card CSV with Charges and Payments columns.
- Credit card CSV with one signed Amount column.
- CSV with extra columns that should be ignored.
- CSV with missing balance column.
- CSV with duplicate transactions.

Manual test path:

Banking > Import Statement  
Open dialog  
Confirm account starts blank  
Select Business Checking  
Upload bank CSV  
Map columns  
Preview normalized rows  
Import  
Confirm transactions appear in To Review  
Repeat upload and confirm saved mapping is applied  
Edit mapping and confirm preview changes

Credit card test path:

Banking > Import Statement  
Open dialog  
Select Business Credit Card  
Upload credit card CSV  
Confirm labels show Charge and Payment/Credit  
Map columns  
Import  
Confirm transactions appear correctly in review queue

## Suggested Rollout Plan

Use a low-risk rollout because this software is already heavily coded.

1. Add the new mapping UI behind a feature flag if available.
2. Keep the existing import parser as much as possible.
3. Insert a mapping/normalization layer before current import creation.
4. Test with existing statement samples.
5. Turn on for one company/admin account first.
6. After validation, make it the default import flow.

## Final Recommendation

The best user experience is:

Blank account selector from Chart of Accounts  
Upload statement  
Show all original columns  
Let user map each column  
Show normalized preview  
Save mapping for next time  
Import to review queue

This makes the workflow clear for normal business users and still gives the accounting system the exact structure it needs for correct posting later.