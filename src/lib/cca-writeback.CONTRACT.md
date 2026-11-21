# Contract `cca-writeback/1` — Nexvar Tax → LedgerPro

**Status: v1, emitted by Nexvar Tax after a T2 is filed; received by LedgerPro.**
Design: `improvement-plan/DESIGN-TAX-DOMAIN.md` §3.4 (the write-back loop).
Receiver implementation: `src/lib/cca-writeback.ts` (validation) and
`src/lib/cca/writeback-server.ts` (import, versioning, journal approval).
Sibling contracts: `tb-gifi/1`, `cca-register/1`, `gst-worksheet/1`,
`year-end-package/1` — this contract follows the same house conventions.

This is the return leg of the loop that `cca-register/1` opens. LedgerPro
sends Nexvar Tax the asset facts; after the return is filed, Nexvar Tax
sends back what was actually claimed and where each CCA pool closed —
**as filed**. LedgerPro keeps no shadow UCC of its own: the figures in
this payload are the only UCC numbers it holds, and its next
`cca-register/1` export opens from them.

## Payload

```json
{
  "contractVersion": "cca-writeback/1",
  "companyId": "cmvnlbehi0001unwk7sm0dnbb",
  "businessNumber": "731893160RC0001",
  "fiscalYear": { "start": "2025-10-01", "end": "2026-09-30" },
  "classes": [
    { "class": "8",  "ccaClaimed": "4120.00",  "closingUcc": "16480.00" },
    { "class": "10", "ccaClaimed": "6900.00",  "closingUcc": "16100.00" }
  ],
  "schedule1Adjustments": [
    { "description": "Schedule 1: add back book amortization", "amount": "9850.00", "direction": "add" },
    { "description": "Schedule 1: deduct capital cost allowance", "amount": "11020.00", "direction": "deduct" }
  ],
  "source": {
    "product": "nexvar-tax",
    "returnId": "370290a0-dc98-45fd-9b2c-0320c9d010da",
    "filedAt": "2027-03-28T14:03:11.000Z",
    "confirmationNumber": "optional — the CRA confirmation number when one exists"
  },
  "hash": "sha256 hex of the canonical payload without this field"
}
```

## Field rules

| Field | Rule |
|---|---|
| `contractVersion` | Exactly `"cca-writeback/1"`. |
| `companyId` | The LedgerPro company id, as carried in the `cca-register/1` export the return was prepared from. The receiver refuses a payload whose id does not match the importing company. |
| `businessNumber` | Full CRA business-number account form (e.g. `731893160RC0001`) — the same form `tb-gifi/1` / `cca-register/1` carry. Must match the company's BN on file. |
| `fiscalYear.start` / `.end` | `YYYY-MM-DD`. Must equal one of the company's own fiscal years exactly (the receiver derives its fiscal years from the company's year-end; a payload for a period that is not a company fiscal year is refused). |
| `classes[]` | One line per CCA class on the filed Schedule 8. May be empty (a return with no CCA). |
| `classes[].class` | A class code Nexvar Tax models — the same 19 codes the register's picker offers: `1, 3, 6, 8, 10, 10.1, 12, 13, 14, 14.1, 17, 29, 38, 41, 43, 45, 50, 52, 53`. No duplicates. |
| `classes[].ccaClaimed` | The CCA claimed for the class **on the filed return**, decimal string, ≥ 0. |
| `classes[].closingUcc` | The class's closing UCC **as filed**, decimal string, ≥ 0. |
| `schedule1Adjustments[]` | The CCA book/tax Schedule 1 lines from the filing (see below). May be empty. |
| `schedule1Adjustments[].amount` | Decimal string, ≥ 0 — the `direction` field carries the sign, never the amount. |
| `schedule1Adjustments[].direction` | `"add"` (added back to net income on Sch 1) or `"deduct"` (deducted on Sch 1). |
| `source.product` | Exactly `"nexvar-tax"`. The receiver accepts filings from no other product. |
| `source.returnId` | The Nexvar Tax return id. Stored on the record and named in the proposed journal's description. |
| `source.filedAt` | ISO 8601 date or datetime of filing. |
| `source.confirmationNumber` | Optional. The CRA confirmation number when the filing produced one. |
| `hash` | SHA-256 (hex) of the **canonical payload**: the payload object without the `hash` field, serialized as stable JSON (object keys sorted recursively, no whitespace) — the identical convention to `tb-gifi/1` (`canonicalPayloadHash` in LedgerPro's `src/lib/tb-gifi.ts`; Nexvar Tax's contracts mirror it). |

**Money** is always a decimal string with exactly two fraction digits
(`"16480.00"`), built from integer-cent math — never a JSON number.

## The Schedule 1 lines

`schedule1Adjustments` carries the CCA book/tax adjustment lines of the
filing (design §3.1): typically the add-back of the book amortization
the books recorded, and the deduction of the CCA actually claimed. On
import, LedgerPro turns these lines into a **proposed** year-end
journal — it never posts on its own:

- an `"add"` line reverses book expense: **Dr 1695 Accumulated
  Depreciation / Cr depreciation expense**;
- a `"deduct"` line records the tax deduction in the books:
  **Dr depreciation expense / Cr 1695 Accumulated Depreciation**;
- the expense account is **6860 Depreciation Expense (GIFI 8670)**, or
  **6870 Amortization Expense (GIFI 8570)** when the write-back covers
  only intangible classes (14 / 14.1) — the CCA register's own chart
  hygiene accounts, get-or-created on posting.

The journal is dated the fiscal year end, stamped
`sourceType 'cca_writeback'` with the write-back record as its source,
and posts only when a preparer approves it in LedgerPro. Posting into
a closed period is refused. If `schedule1Adjustments` is empty, no
journal is proposed and the Fixed Assets page says so plainly.

## Receiver behaviour (what Nexvar Tax can rely on)

1. **Hash first.** A payload whose hash does not verify is rejected
   whole, with the reason shown to the user. Nothing is imported from
   an unverifiable file.
2. **Identity is checked three ways**: company id, business number,
   and fiscal year must all match the importing company. Any mismatch
   refuses the import.
3. **Versioning, never silent replacement.** A second payload for the
   same fiscal year is kept alongside the first and becomes the
   latest (an amended filing is a real event; its predecessor stays
   on record). All effects — export sourcing, variance, the journal
   proposal — flow from the latest version only. Re-importing the
   byte-identical payload (same hash) is refused as a duplicate.
4. **Effects of the latest version:**
   - the next `cca-register/1` export for the following year carries
     each class's `openingUccAsFiled` from this payload's
     `closingUcc`, and the export for the filed year itself carries
     `schedule1.ccaClaimed` (the classes' claimed total);
   - the Fixed Assets page shows a per-class variance: filed closing
     UCC vs the register's own projection from the filed opening,
     with the likely cause named where the data supports one (claim
     differed from the projection / register facts changed after
     filing / unexplained);
   - the Sch 1 journal proposal described above.
5. **Nothing is silent and nothing auto-posts.** The import, each
   version, and the journal's state are all visible on the Fixed
   Assets page.
