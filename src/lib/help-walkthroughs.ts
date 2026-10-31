import type { HelpArticle } from './help-content';

// Task-based walkthroughs for the Help Center (Workstream B of the go-to-market
// plan). Every walkthrough is written against the Prairie Peak sample
// companies, and its screenshots live in public/help-images/<slug>/.
// The overview articles in help-content.ts stay as the reference layer;
// these are the step-by-step companions a new user follows end to end.

export const WALKTHROUGH_ARTICLES: HelpArticle[] = [
  {
    slug: 'walkthrough-company-setup',
    title: 'Walkthrough: set up your company and chart of accounts',
    category: 'Getting started',
    summary: 'Follow a real company setup end to end: profile and tax registration, the default chart of accounts, bank and cash accounts, and a second related company.',
    keywords: ['setup', 'walkthrough', 'sample company', 'chart of accounts', 'tax registration', 'getting started'],
    sections: [
      {
        heading: 'The company profile',
        text: 'Everything starts in Settings. The example company in these walkthroughs is Prairie Peak Renovations Ltd., an Alberta renovation contractor. Its profile carries the legal name, business number, GST/HST number, province, and fiscal year — the same fields LedgerPro uses on invoices and in the GST/HST return.',
        steps: [
          'Open Settings and complete the company profile: legal name, business type, business number, and province.',
          'Enter the GST/HST registration number exactly as CRA has it (for example, 812345678 RT0001).',
          'Set the fiscal year. Prairie Peak uses a calendar year, January 1 to December 31.',
          'Save, then confirm the company name in the company switcher at the top of the screen.',
        ],
        images: [
          { src: '/help-images/walkthrough-company-setup/01.png', alt: 'Company profile settings for Prairie Peak Renovations', caption: 'Prairie Peak Renovations: profile, business number, GST/HST number, and fiscal year in Settings.' },
        ],
      },
      {
        heading: 'Add the tax registration',
        text: 'The GST/HST return only computes for a company with a tax registration on file. Prairie Peak is a quarterly filer, so its registration is set to the GST/HST regime with quarterly filing.',
        steps: [
          'In Settings, open the tax registrations section and add a registration.',
          'Choose the GST/HST regime, enter the registration number, and pick the filing frequency that matches your CRA account (monthly, quarterly, or annual).',
          'Set the date the registration became valid. Returns for periods before that date will not compute.',
        ],
        images: [
          { src: '/help-images/walkthrough-company-setup/02.png', alt: 'GST/HST tax registration set to quarterly filing', caption: 'One registration drives the return periods, the filing frequency, and the workpapers.' },
        ],
      },
      {
        heading: 'Review the chart of accounts',
        text: 'A new company starts with the Canadian default chart. Prairie Peak added the accounts its business actually needs: Petty Cash (1040) for cash spending, payroll accounts (6920 wages, 6940 employer payroll taxes, 2410–2440 payroll liabilities), job-cost accounts (5010 materials, 5020 subcontractors), and the intercompany control accounts (1160 Due from Holdings, 2260 Due to Holdings).',
        steps: [
          'Open the chart of accounts and scan the defaults before adding anything — most of what you need already exists.',
          'Add an account only when a default does not fit; choose the kind carefully, because the kind decides where the account appears in reports.',
          'For money you hold physically, add a cash account (kind: Cash). Cash expenses and the receipts walkthrough use it.',
        ],
        images: [
          { src: '/help-images/walkthrough-company-setup/03.png', alt: 'Chart of accounts with payroll and intercompany accounts', caption: 'The Prairie Peak chart: defaults plus payroll, job-cost, cash, and intercompany control accounts.' },
          { src: '/help-images/walkthrough-company-setup/04.png', alt: 'Adding a financial account with the Cash kind', caption: 'Financial accounts (bank, credit card, cash) each map to one GL account.' },
        ],
      },
      {
        heading: 'Working with more than one company',
        text: 'Prairie Peak Holdings Ltd. owns the building Prairie Peak Renovations works from. Both companies live under the same login, and the company switcher moves between them. Intercompany balances only stay mirrored if every entry is recorded in the right company, so confirm the switcher before you type.',
        notes: [
          'A fictional sample company with a full quarter of data is available on the Owner plan for practice — explore there before touching your real books.',
        ],
      },
    ],
    action: { label: 'Open company settings', href: '/settings' },
  },
  {
    slug: 'walkthrough-bank-import',
    title: 'Walkthrough: import a bank statement — and never import it twice',
    category: 'Banking',
    summary: 'Import a statement file into a bank or card account, see how LedgerPro recognises rows it has already imported, and land a clean register ready to categorize.',
    keywords: ['import', 'walkthrough', 'bank statement', 'csv', 'ofx', 'duplicates', 'dedupe'],
    sections: [
      {
        heading: 'Start from the account',
        text: 'Imports belong to one financial account at a time. Prairie Peak runs three: TD Chequing for operations, a TD Business Visa for site purchases, and a small Cash account. Each maps to its own GL account, so importing into the wrong account posts to the wrong place.',
        steps: [
          'Open Banking and choose the account the statement belongs to.',
          'Choose Import, then pick the statement file (CSV, OFX, or a text-based PDF statement).',
          'Map the columns once if LedgerPro asks — date, description, and amount are the essentials.',
        ],
        images: [
          { src: '/help-images/walkthrough-bank-import/01.png', alt: 'Banking accounts list with balances', caption: 'Prairie Peak’s three financial accounts with their current balances.' },
          { src: '/help-images/walkthrough-bank-import/02.png', alt: 'Import a statement page with bank presets and import options', caption: 'The import page: pick the account and the statement file, and leave the duplicate-skip and rules options on.' },
        ],
      },
      {
        heading: 'How duplicates are prevented',
        text: 'Re-importing a statement is safe. LedgerPro fingerprints every row — for OFX files it uses the bank’s own transaction ID; otherwise it combines the date, the amount, and the cleaned-up description. A row whose fingerprint already exists in that account is skipped automatically, so overlapping statement periods never double your books.',
        steps: [
          'On the review screen, check the counts: new rows versus duplicates skipped.',
          'If a row is flagged as a duplicate but is genuinely a second, identical purchase, you can force-keep it — the fingerprint is a safety net, not a lock.',
          'Confirm the import. New rows land in the register as unposted, ready to categorize.',
        ],
        images: [
          { src: '/help-images/walkthrough-bank-import/03.png', alt: 'Imported rows waiting in To Review', caption: 'Imported rows land in To Review — importing moves data in; categorizing is what posts it.' },
        ],
        notes: [
          'Categorization rules you have saved apply automatically to imported rows that match, so repeat purchases (fuel, phone, software) often arrive already categorized.',
          'Keep the original statement file with your records — the import is a copy, not the evidence.',
        ],
      },
    ],
    action: { label: 'Open Banking', href: '/banking' },
  },
  {
    slug: 'walkthrough-categorize-and-post',
    title: 'Walkthrough: categorize and post — how a bank row becomes a ledger entry',
    category: 'Banking',
    summary: 'Take imported rows from “to review” to posted: pick the category, split the GST, let rules do the repeat work, and see the journal entry a posted row creates.',
    keywords: ['categorize', 'post', 'walkthrough', 'journal entry', 'gst split', 'rules', 'reconcile'],
    sections: [
      {
        heading: 'Work the to-review list',
        text: 'An imported row is not in your books yet — it is a suggestion waiting for a decision. Posting is the moment it becomes accounting: LedgerPro creates a journal entry, marks the row reconciled, and the amount starts counting in reports and in the GST return.',
        steps: [
          'Open Banking and select the account. Rows that still need a decision are marked to review.',
          'For each row, pick the category in the row’s Categorize dropdown. Prairie Peak’s Visa rows split into materials (5010), fuel (6550), and job supplies (5030). The row moves to the Categorized tab.',
          'The category carries the tax treatment: on a GST-taxable purchase the posting splits the GST out as an input tax credit — it is never buried in the cost.',
          'When the batch looks right, choose Post to GL. Each categorized row becomes a journal entry and the row flips to reconciled.',
        ],
        images: [
          { src: '/help-images/walkthrough-categorize-and-post/01.png', alt: 'The To Review list with rows ready to categorize', caption: 'Work the To Review tab: one Categorize dropdown per row, then Post to GL.' },
        ],
      },
      {
        heading: 'What posting creates',
        text: 'Posting a $486.20 materials purchase on the Visa creates one balanced journal entry: debit Materials $463.05, debit GST input tax credits $23.15, credit the Visa account $486.20. The bank row and the journal stay linked, so you can always walk from a report back to the row — and to the receipt attached to it.',
        images: [
          { src: '/help-images/walkthrough-categorize-and-post/02.png', alt: 'Journal entry created by posting a bank row', caption: 'One posted row, one balanced journal entry — net expense, GST credit, bank account.' },
        ],
        notes: [
          'Made a mistake? Void the journal entry rather than editing the row — the audit trail keeps both.',
          'Rules learn from what you post: a merchant you categorize the same way three times is a good candidate for an automatic rule.',
        ],
      },
      {
        heading: 'Let rules carry the repeat work',
        steps: [
          'Open Banking rules and create a rule from a merchant you see every month (Prairie Peak’s rules cover the TELUS phone bill, the Intact insurance premium, and the Jobber subscription).',
          'Set the category and tax treatment once. Matching imported rows arrive pre-categorized.',
          'Review rule-posted rows in batches — the rule proposes, you still post.',
        ],
        images: [
          { src: '/help-images/walkthrough-categorize-and-post/03.png', alt: 'Categorization rules for recurring merchants', caption: 'Rules pre-categorize imports; posting stays a human decision.' },
        ],
      },
    ],
    action: { label: 'Open Banking', href: '/banking' },
  },
  {
    slug: 'walkthrough-receipts',
    title: 'Walkthrough: receipts — snap it, attach it, or book the cash expense',
    category: 'Sales and expenses',
    summary: 'The full life of a receipt: phone capture with Add from phone, attaching paper to its bank row, and the cash purchase that has no bank row at all.',
    keywords: ['receipts', 'walkthrough', 'phone', 'qr', 'cash expense', 'ocr', 'attach'],
    sections: [
      {
        heading: 'Start from the Receipts inbox',
        text: 'Every receipt lands in one inbox first, whether it was photographed, uploaded, or captured from a phone. Prairie Peak’s inbox holds two receipts still waiting — a Staples office-supplies receipt and a Calgary Parking receipt — while four others are already attached to their transactions.',
        steps: [
          'Open Receipts. Waiting receipts show what was read from them: merchant, date, and total.',
          'Check the read fields against the paper. Correct anything misread before you rely on it.',
          'A receipt by itself changes nothing in the books — it is evidence plus parsed data, waiting to be attached or turned into an expense.',
        ],
        images: [
          { src: '/help-images/walkthrough-receipts/01.png', alt: 'Receipts inbox with two waiting receipts', caption: 'The inbox: receipts waiting to be attached or expensed, with their parsed totals.' },
          { src: '/help-images/walkthrough-receipts/02.png', alt: 'Receipt detail with parsed fields and suggested category', caption: 'Parsed merchant, date, subtotal, GST, and total — with a category suggested from your rules.' },
        ],
      },
      {
        heading: 'Add from phone — no login on the phone',
        text: 'Paper shows up on site, not at your desk. Add from phone opens a one-time link as a QR code: anyone you hand it to can photograph receipts straight into this company’s inbox without a LedgerPro login. The link expires in 30 minutes, and minting a new one retires the old.',
        steps: [
          'In Receipts, choose Add from phone and scan the QR code with the phone’s camera (or copy the link).',
          'The phone opens a simple capture page — no login, no app. Photograph the receipt; the phone converts the photo and reads the text before sending.',
          'Back at your desk, the receipt is waiting in the inbox with its fields already read.',
        ],
        images: [
          { src: '/help-images/walkthrough-receipts/03.png', alt: 'Add from phone panel with QR code', caption: 'One live link per person and company, 30 minutes, up to 100 uploads.' },
          { src: '/help-images/walkthrough-receipts/04.png', alt: 'Public phone capture page', caption: 'What the phone sees: point, shoot, done — the receipt lands in the inbox.' },
        ],
        notes: [
          'iPhone photos are converted to JPEG by the capture page itself, so HEIC is not a problem on this path.',
        ],
      },
      {
        heading: 'Attach a receipt to its bank row',
        steps: [
          'Open the waiting receipt and choose the bank transaction it belongs to — the Home Depot receipt belongs to the $486.20 Visa row.',
          'Choose Attach & categorize. The receipt pre-fills the row’s category and GST split from what it read.',
          'Post the row from Banking when ready. The image stays attached as the audit evidence behind the journal entry.',
        ],
        images: [
          { src: '/help-images/walkthrough-receipts/05.png', alt: 'Receipt attached to its bank transaction', caption: 'Attached: the receipt, the bank row, and the journal entry now point at each other.' },
        ],
      },
      {
        heading: 'Paid cash? There is no bank row — book the expense directly',
        text: 'The Tim Hortons receipt ($5.54, coffee for the crew) was paid from petty cash, so no bank transaction will ever arrive to attach it to. Receipts handles that case directly.',
        steps: [
          'Open the receipt and choose the “no bank transaction for this one” path.',
          'Pick the account it was paid from — Prairie Peak uses its Cash account (Petty Cash, 1040).',
          'Create the expense. LedgerPro builds the entry from the receipt: debit the expense $5.28, debit GST credits $0.26, credit Cash $5.54 — review it, then post.',
        ],
        images: [
          { src: '/help-images/walkthrough-receipts/06.png', alt: 'Creating a cash expense from a receipt', caption: 'A receipt with no bank row becomes a cash expense in one step, GST split included.' },
        ],
      },
    ],
    action: { label: 'Open Receipts', href: '/receipts' },
  },
  {
    slug: 'walkthrough-invoices-and-payments',
    title: 'Walkthrough: invoices and payments',
    category: 'Sales and expenses',
    summary: 'Raise an invoice with GST, send it, take a part payment, and chase the one that goes overdue — the whole receivables cycle on Prairie Peak’s Q3 invoices.',
    keywords: ['invoices', 'walkthrough', 'payments', 'accounts receivable', 'overdue', 'part payment'],
    sections: [
      {
        heading: 'The invoice list tells the story',
        text: 'Prairie Peak raised eight invoices in Q3 2026 — $69,700 of work plus $3,485 GST. By September 30: five are paid, one has a $3,000 part payment against it, one is overdue, and one is sent and not yet due. That mix is deliberate in this walkthrough, because each state behaves differently.',
        images: [
          { src: '/help-images/walkthrough-invoices-and-payments/01.png', alt: 'Invoice list with paid, partial, overdue, and sent statuses', caption: 'Eight invoices, four states — the list is your receivables to-do list.' },
        ],
      },
      {
        heading: 'Raise an invoice',
        steps: [
          'Open Sales & Invoices and choose New invoice. Pick the customer — Hartwell Homes, in the overdue example.',
          'Add lines with plain descriptions your customer will understand (“Rental unit turnover — 88 Patterson Blvd SW”). Each line carries its revenue category.',
          'GST is added at the invoice’s tax rate — 5% in Alberta. Check the totals: $6,900 of work, $345 GST, $7,245 total.',
          'Save and send. The invoice posts revenue and GST collected to the ledger and the amount owing onto the customer’s balance.',
        ],
        images: [
          { src: '/help-images/walkthrough-invoices-and-payments/02.png', alt: 'New invoice form with a line item and GST', caption: 'Lines carry revenue categories; the tax rate drives the GST line.' },
          { src: '/help-images/walkthrough-invoices-and-payments/03.png', alt: 'Invoice detail showing subtotal, GST, and total', caption: 'The Hartwell invoice: $6,900 + $345 GST = $7,245 — the same total as the list and the ledger.' },
        ],
      },
      {
        heading: 'How payments land — through the bank, not the invoice',
        text: 'There is no “record payment” form on the invoice itself, by design: money is recorded where it actually moves — the bank account. When a customer pays, the payment arrives as a bank row; matching that row to the invoice creates the payment journal (debit bank, credit receivables) and reduces what the customer owes. Prairie Peak’s five paid invoices were all settled exactly this way.',
        steps: [
          'When a payment arrives, find its row in Banking (import the statement if needed) and match it to the open invoice. Posting the matched row clears that much of the receivable.',
          'A part payment is just a smaller match: Maple & Main Café paid $3,000 of their $5,722.50 on September 15. The invoice stays open, and the customer’s balance drops to $2,722.50.',
          'If money settled entirely outside the bank feed, the invoice list’s Mark Paid closes the invoice’s status — but it records no money, so prefer the bank match whenever a row exists.',
        ],
        images: [
          { src: '/help-images/walkthrough-invoices-and-payments/04.png', alt: 'Maple & Main Café invoice detail', caption: 'The Maple & Main invoice: $5,450.00 + $272.50 GST = $5,722.50, issued Sep 2.' },
          { src: '/help-images/walkthrough-invoices-and-payments/05.png', alt: 'Customer balances showing amounts still owing', caption: 'Customer balances carry what is left: Maple & Main owes $2,722.50 after its part payment.' },
        ],
        notes: [
          'An overdue invoice needs no special handling to keep the books right — aging is a report, the ledger already carries the receivable.',
        ],
      },
    ],
    action: { label: 'Open Invoices', href: '/invoices' },
  },
  {
    slug: 'walkthrough-bills-and-payments',
    title: 'Walkthrough: bills and payments',
    category: 'Sales and expenses',
    summary: 'Enter supplier bills, attach the supplier’s own paperwork, pay some and carry the rest — accounts payable the way Prairie Peak runs it.',
    keywords: ['bills', 'walkthrough', 'accounts payable', 'suppliers', 'payments', 'expenses'],
    sections: [
      {
        heading: 'Bills are promises; payments are cash',
        text: 'A bill records what you owe and when — entering it does not move money. Prairie Peak entered eight bills in Q3: five paid, two still open at quarter-end, and one special case (the intercompany management fee, covered in the intercompany walkthrough). The open two — Foothills Lumber $3,123.75 and Volt Right Electrical $1,617.00 — are exactly the accounts payable on the balance sheet.',
        images: [
          { src: '/help-images/walkthrough-bills-and-payments/01.png', alt: 'Bills list with paid and open bills', caption: 'Open bills at September 30 are your A/P — nothing more, nothing less.' },
        ],
      },
      {
        heading: 'Enter a bill',
        steps: [
          'Open Bills & Expenses and choose New bill. Pick the supplier and enter the bill date, due date, and their reference number.',
          'Add lines with categories — lumber to Materials (5010), electrical work to Subcontractor Costs (5020).',
          'Enter the GST as billed. The GST on a supplier bill is your input tax credit, claimed in the period of the bill, not the payment.',
          'Save. The expense and the payable are in the ledger; cash has not moved.',
        ],
        images: [
          { src: '/help-images/walkthrough-bills-and-payments/02.png', alt: 'Bill detail for the open Foothills Lumber bill', caption: 'The open Foothills bill: $2,975.00 + $148.75 GST = $3,123.75, reference FL-2450, due Sep 27.' },
        ],
      },
      {
        heading: 'Pay a bill',
        steps: [
          'Open the bill and choose Pay. Choose the account paying it — chequing for Prairie Peak’s supplier runs.',
          'Pay in full or in part; a part payment leaves the balance open with the amount still owing.',
          'The payment creates the matching bank transaction, so the register, the bill, and the payable all agree.',
        ],
        images: [
          { src: '/help-images/walkthrough-bills-and-payments/03.png', alt: 'Supplier balances showing amounts still owing', caption: 'Supplier balances on Contacts always equal the open bills — check them before a payment run.' },
        ],
      },
    ],
    action: { label: 'Open Bills', href: '/expenses' },
  },

  {
    slug: 'walkthrough-gst-return',
    title: 'Walkthrough: your GST/HST return, line by line (101–115)',
    category: 'Canadian tax',
    summary: 'Compute Prairie Peak’s Q3 2026 return from its own journals and read every line the way CRA does — sales, tax collected, ITCs, and the net amount owing.',
    keywords: ['gst', 'hst', 'walkthrough', 'return', 'line 101', 'itc', 'net tax', 'workpapers'],
    sections: [
      {
        heading: 'Set the period, then compute',
        text: 'The return is computed from posted journal entries — nothing is typed in. Prairie Peak files quarterly, so this walkthrough uses July 1 to September 30, 2026. Choose the period that matches your CRA filing period and choose Compute.',
        steps: [
          'Open Reports and choose GST/HST Return.',
          'Set the period start and end to your filing period (Q3 2026 here) and choose Compute.',
          'Confirm the header shows your registration number and filing frequency — Prairie Peak shows 812345678 RT0001, quarterly filer.',
        ],
        images: [
          { src: '/help-images/walkthrough-gst-return/01.png', alt: 'GST/HST return for Q3 2026 with all lines computed', caption: 'Q3 2026, computed from the journals: every line below is a sum you can trace.' },
          { src: '/help-images/walkthrough-gst-return/02.png', alt: 'Return header showing registration number and quarterly filing', caption: 'The header is your tax registration — wrong number or frequency, wrong return.' },
        ],
      },
      {
        heading: 'Read the return the way CRA does',
        notes: [
          'Line 101 — Sales and other revenue: $69,700.00. Every revenue line posted in the period, before tax.',
          'Line 103 — GST/HST collected or collectible: $3,485.00. The GST charged on those sales.',
          'Line 105 — Total GST/HST and adjustments: $3,485.00 (line 103 plus any adjustments on line 104 — Prairie Peak had none).',
          'Line 106 — Input tax credits: $1,491.29. The GST Prairie Peak paid on materials, fuel, rent, and the rest of its purchases.',
          'Line 108 — Total ITCs and adjustments: $1,491.29.',
          'Line 109 — Net tax: $1,993.71. Line 105 minus line 108.',
          'Line 115 — Amount owing: $1,993.71. A positive net tax is a payment to make; a negative one lands on line 114 as a refund claim.',
        ],
        images: [
          { src: '/help-images/walkthrough-gst-return/03.png', alt: 'GST return lines 101 to 115 with Prairie Peak amounts', caption: 'Net tax $1,993.71 owing — the difference between tax collected and ITCs, nothing else.' },
        ],
      },
      {
        heading: 'Where the numbers come from — and the workpapers',
        text: 'Two GL accounts carry the whole return: GST collected (2300) ends the quarter at $3,485.00 credit, and GST input tax credits (2310) at $1,491.29 debit. If a line ever surprises you, those balances — and the journal lines under them — are the audit trail. The tax workpapers package the same figures with the supporting detail your accountant (or a CRA review) will ask for.',
        steps: [
          'Open the tax workpapers for the same period and compare the totals to the return — they must agree.',
          'Drill into any figure that differs from your expectation at the journal-line level before you file.',
          'File with CRA through your usual channel, then record the filing in LedgerPro so the period is locked with its lock date.',
        ],
        images: [
          { src: '/help-images/walkthrough-gst-return/04.png', alt: 'Tax workpapers for the quarter', caption: 'Workpapers: the return’s figures with their supporting detail, ready for review or filing.' },
        ],
        notes: [
          'LedgerPro prepares and records the return; the actual CRA filing and payment remain external steps.',
        ],
      },
    ],
    action: { label: 'Open the GST/HST return', href: '/reports/gst-hst-return' },
  },
  {
    slug: 'walkthrough-payroll-sync',
    title: 'Walkthrough: payroll sync with Nexvar Pay — one journal per pay run',
    category: 'Canadian tax',
    summary: 'See a finalized pay run arrive in LedgerPro as a single balanced journal with the full gross-to-net mapping, and what happens when a run is voided.',
    keywords: ['payroll', 'walkthrough', 'nexvar pay', 'sync', 'journal', 'cpp', 'ei', 'remittance'],
    sections: [
      {
        heading: 'The connection',
        text: 'Nexvar Pay runs payroll; LedgerPro keeps the books. They connect with a per-company API key that can read the chart and post journals — nothing else. Prairie Peak’s connection uses the detailed mapping, so each part of a pay run lands in its own account instead of one lump sum.',
        steps: [
          'In LedgerPro, open Payroll to see the connection state and the account mapping.',
          'In Nexvar Pay, connect the same company and confirm the test connection finds your chart of accounts.',
          'Choose the detailed (granular) mapping: wages, employer taxes, and each deduction get their own accounts.',
        ],
        images: [
          { src: '/help-images/walkthrough-payroll-sync/01.png', alt: 'Payroll page showing the Nexvar Pay connection and mapping', caption: 'Connected, sync on, detailed mapping — the state the Payroll page should show.' },
        ],
      },
      {
        heading: 'One pay run, one journal',
        text: 'When a pay run is finalized in Nexvar Pay, exactly one journal arrives in LedgerPro, marked as payroll from Nexvar Pay. A Prairie Peak monthly run posts: debit Wages $17,280.00 and Employer Payroll Taxes $1,300.22; credit CPP payable $1,804.80, EI payable $681.98, income tax payable $2,986.00, and wages payable $13,107.44 (the net pay). Syncing the same run twice cannot duplicate it — each run carries its own idempotency key.',
        images: [
          { src: '/help-images/walkthrough-payroll-sync/02.png', alt: 'Payroll journal with wage, tax, and deduction lines', caption: 'Gross-to-net in one balanced entry — CPP, EI, and tax each in their own liability account.' },
        ],
        notes: [
          'Employer payroll taxes post to 6940 Employer Payroll Taxes Expense — keep it separate from 6920 Wages so your T4 summary and your P&L both read cleanly.',
          'Voiding a run in Nexvar Pay posts a reversing journal with its own key; the original stays in the audit trail.',
        ],
      },
      {
        heading: 'Paying the crew and CRA',
        steps: [
          'The net-pay amount (wages payable) clears when the bank pays the employees — Prairie Peak’s register shows one net-wage payment per run.',
          'CRA remittances are ordinary bank rows: Prairie Peak remitted $5,472.78 on August 15 and again on September 15, clearing the CPP, EI, and tax liabilities for the prior runs.',
          'At any date, the three payroll liability accounts tell you exactly what the next remittance must be.',
        ],
      },
    ],
    action: { label: 'Open Payroll', href: '/payroll' },
  },
  {
    slug: 'walkthrough-intercompany',
    title: 'Walkthrough: intercompany — a loan and a management fee between sister companies',
    category: 'Reporting and groups',
    summary: 'Link two companies, move a $25,000 loan between them, charge a management fee with GST, and prove the mirror balances agree on both sets of books.',
    keywords: ['intercompany', 'walkthrough', 'related parties', 'loan', 'management fee', 'mirror'],
    sections: [
      {
        heading: 'Link the companies first',
        text: 'Intercompany only works between linked companies. Prairie Peak Renovations and Prairie Peak Holdings are linked with control accounts on both sides: Holdings tracks Due from Renovations (1150) and Due to Renovations (2250); Renovations tracks Due from Holdings (1160) and Due to Holdings (2260). Every intercompany entry posts through those accounts — never through the bank or a suspense account.',
        steps: [
          'Open Related Parties and confirm the link between your companies and its four control accounts.',
          'Do intercompany entries from the link, not as freehand journals, so both sides are written together.',
        ],
        images: [
          { src: '/help-images/walkthrough-intercompany/01.png', alt: 'New Transfer form in Related Parties', caption: 'Record intercompany entries from Related Parties — pick the type, the paying company, and the related party; LedgerPro posts both sides.' },
        ],
      },
      {
        heading: 'The loan: $25,000 from Holdings to Renovations',
        steps: [
          'From the link, record a fund transfer of $25,000 on September 15, from Holdings to Renovations.',
          'LedgerPro writes both sides: Holdings debits Due from Renovations and credits its bank; Renovations debits its bank and credits Due to Holdings.',
          'The bank rows appear in both companies’ registers, so each set of books reconciles on its own.',
        ],
        images: [
          { src: '/help-images/walkthrough-intercompany/02.png', alt: 'IC-0001 fund transfer in Linked Entries', caption: 'IC-0001 in Linked Entries: Holdings Dr 1150 · Cr 1010 — Renovations Dr 1010 · Cr 2260. One event, two journals.' },
        ],
      },
      {
        heading: 'The management fee — with GST',
        text: 'Holdings charges Renovations a $1,500 monthly management fee plus $75 GST. It is a real sale for Holdings (revenue, GST collected) and a real cost for Renovations (expense, ITC) — but it settles through the Due to Holdings account instead of the bank, because sister companies settle on paper first.',
        steps: [
          'Record the recharge from the link: fee $1,500, GST $75, dated September 30.',
          'Check both sides: Holdings shows the fee invoice and the GST in its return; Renovations shows the bill with the payable pointed at Due to Holdings (2260), not at the bank-payable account.',
        ],
        images: [
          { src: '/help-images/walkthrough-intercompany/03.png', alt: 'IC-0002 management fee recharge in Linked Entries', caption: 'IC-0002: the $1,575 recharge — a $1,500 fee plus $75 GST, settled through the control accounts.' },
        ],
      },
      {
        heading: 'Prove the mirror',
        text: 'The whole control in one check: what Holdings says Renovations owes it must equal what Renovations says it owes Holdings. After the loan and the fee, Holdings’ Due from Renovations stands at $26,575.00 debit — and Renovations’ Due to Holdings at $26,575.00 credit. If those two numbers ever disagree, an entry was made in one company only, and the difference is the size of the mistake.',
        images: [
          { src: '/help-images/walkthrough-intercompany/04.png', alt: 'Mirror balances agreeing on both companies', caption: '$26,575.00 on both sides — the mirror check takes ten seconds and catches one-sided entries.' },
        ],
      },
    ],
    action: { label: 'Open Related Parties', href: '/intercompany' },
  },
  {
    slug: 'walkthrough-reports',
    title: 'Walkthrough: reports — trial balance, P&L, balance sheet, workpapers',
    category: 'Reporting and groups',
    summary: 'Read Prairie Peak’s quarter the way an accountant does: prove the trial balance, scan the P&L, check the balance sheet, and pull the tax workpapers.',
    keywords: ['reports', 'walkthrough', 'trial balance', 'profit and loss', 'balance sheet', 'workpapers'],
    sections: [
      {
        heading: 'Start with the trial balance',
        text: 'The trial balance is the proof page: every account in Prairie Peak Renovations at September 30, 2026, totalling $220,498.88 of debits and exactly $220,498.88 of credits. If it does not balance, nothing downstream can be trusted; when it does, every other report is arithmetic on proven numbers.',
        steps: [
          'Open Reports and choose Trial Balance for the period you are reviewing.',
          'Confirm total debits equal total credits before reading anything else.',
          'Scan for accounts that should not be there — a balance in a suspense or clearing account is work unfinished, not a number.',
        ],
        images: [
          { src: '/help-images/walkthrough-reports/01.png', alt: 'Trial balance with equal debit and credit totals', caption: 'Debits equal credits: the quarter is internally proven before it is interpreted.' },
        ],
      },
      {
        heading: 'Profit & loss — how the quarter went',
        text: 'Prairie Peak’s Q3 P&L reads like the business: $69,700 of renovation revenue against $21,079.37 of job costs and $64,813.69 of operating expenses — wages of $51,840 with $3,900.66 of employer payroll taxes are the biggest lines — for a net loss of $16,193.06 in a payroll-heavy quarter. Compare revenue to the GST return’s line 101: the P&L and the return read the same journals, so they tell the same story.',
        images: [
          { src: '/help-images/walkthrough-reports/02.png', alt: 'Profit and loss statement for Q3 2026', caption: 'Revenue, job costs, payroll, and overhead — the quarter in one page.' },
        ],
      },
      {
        heading: 'Balance sheet — what stands at September 30',
        notes: [
          'Bank and Visa agree to the Banking page: TD Chequing $58,627.03, Visa $2,585.24, Cash $210.00.',
          'Receivables on the balance sheet are $20,577.50: the three open invoices (Hartwell $7,245.00, Bow Valley $4,410.00, Maple & Main $2,722.50) plus $6,200 of pre-migration receivables still outstanding from before Prairie Peak moved to LedgerPro.',
          'Payables agree to the open bills; GST owing of $1,993.71 for Q3 agrees to the return, on top of the payroll liabilities for September’s unremitted run.',
          'Due to Holdings $26,575.00 agrees to Holdings’ Due from Renovations — the intercompany mirror, visible from the balance sheet.',
          'Total equity is $71,849.39 — the opening equity of $88,042.45 less the quarter’s $16,193.06 loss, which the balance sheet shows as current-year earnings.',
        ],
        images: [
          { src: '/help-images/walkthrough-reports/03.png', alt: 'Balance sheet at September 30 2026', caption: 'Every balance-sheet line traces to a list you have already seen in these walkthroughs.' },
        ],
      },
      {
        heading: 'The reports index and workpapers',
        steps: [
          'Use the reports index to move between financial reports, the GST/HST return, and tax workpapers without losing the period you set.',
          'Pull the tax workpapers when an accountant or a CRA review asks “where did this number come from” — they carry the detail behind the return.',
          'Print or export from the report page when a lender or partner needs a copy; exports carry the same numbers as the screen.',
        ],
        images: [
          { src: '/help-images/walkthrough-reports/04.png', alt: 'Reports index', caption: 'One index for statements, tax, and workpapers — all reading the same journals.' },
        ],
      },
    ],
    action: { label: 'Open Reports', href: '/reports' },
  },
];
