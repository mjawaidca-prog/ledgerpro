# P1-E tax workpapers

P1-E adds legal-registrant and filing-period workpapers without enabling tax posting for any company or submitting a return to a tax authority.

## Delivered workflow

- Separate workpapers for GST/HST, QST, PST, and Manitoba RST registrations.
- Regular-method GST/HST lines 101, 103–110, 112, 113A–113C, 114, and 115.
- QST and provincial supporting schedules labelled as schedules rather than official return forms.
- Source-document tax snapshots, reversal links, tax treatment, recovery, general-ledger lines, opening balances, and control-account movements in one drill-down model.
- Evidence-backed classification for manual and legacy journal lines. Unclassified lines block preparation.
- `draft → prepared → reviewed → filed recorded` controls. Owner/admin review and an external filing confirmation are required. “Filed recorded” means the user recorded a filing completed outside LedgerPro.
- Frozen version exports and source hashes. Changes after preparation block review; changes after a recorded filing are shown and can be handled in a new amendment version.
- CSV exports use spreadsheet-formula injection protection and show `NOT FILED` until external filing is recorded.

## Boundaries

The first release supports the regular method and CAD filing reconciliation. Quick Method, charity and special methods, rebates, self-assessment, direct CRA/Revenu Québec submission, payment initiation, and automated provincial return forms remain out of scope. Consolidated reports are not tax returns.

The database migration is additive, enables row-level security on the new workpaper table, and revokes direct `anon` and `authenticated` access. Application access remains through authenticated, tenant-checked server routes.
