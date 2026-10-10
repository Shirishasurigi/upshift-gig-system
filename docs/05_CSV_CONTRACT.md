# CSV Data Contract (19 columns)

> ⚠ Column names/order below come from the FRD §18 table. **The CSV template file itself was not in the files provided** – confirm exact header spelling/order against it before coding; the contract is centralised in `packages/shared/csvColumns.ts` so a change is one edit.

## Format
UTF-8 (with BOM optional for Excel), RFC-4180 quoting, header row required, comma separator, `\n` or `\r\n` rows. Empty cell = unknown/not applicable. Never `N/A`, `0`, `unknown` or placeholder text for missing facts.

## Columns (in order)
| # | Column | Type / allowed values | Required for publish | Rule |
|---|---|---|---|---|
| 1 | external_gig_id | string ≤191 | where source provides | dedup key with source |
| 2 | title | string ≤255 | **yes** | |
| 3 | track_id | `M1`–`M6` | **yes** | |
| 4 | payment_amount | string ≤120 | where applicable | human readable, e.g. `$45 / hr`, `$600 fixed`; original wording also kept internally |
| 5 | compensation_type | `hourly`,`fixed` (+`per_task`,`monthly`,`other`) | where known | |
| 6 | min_amount | decimal, `.` separator, no symbol | when applicable | ≤ max |
| 7 | max_amount | decimal | when applicable | |
| 8 | currency | ISO-4217 `USD`,`INR`… | when payment known | |
| 9 | priority | integer | by template | higher first; default 0 |
| 10 | is_featured | `true`/`false` | – | import also accepts 1/0/yes/no |
| 11 | is_local_business | `true`/`false` | – | |
| 12 | posted_at | `YYYY-MM-DD` | when source provides | blank if not found – never inferred |
| 13 | origin_url | absolute http(s) URL | **yes** | |
| 14 | short_description | string ≤500 | **yes** | |
| 15 | overview | text | **yes** | |
| 16 | responsibilities | list | – | see list format |
| 17 | deliverables | list | – | |
| 18 | requirements | list | – | |
| 19 | proof_spec | list | – | |

## List format (columns 16–19) – the "documented delimiter"
Items are joined by `" | "` (space-pipe-space). On export a literal `|` inside an item is replaced by `/`; on import the cell is split on `|` and each item trimmed; empty items dropped. Newlines inside an item are collapsed to a space. Example:
`Edit 3 reels per week | Add captions | Deliver in 9:16`

## Import behaviour
1. Validate every row (types, enums, URL, min≤max, currency, date). Invalid rows → reported in `csv_jobs.error_report` (`row, field, message`); valid rows proceed (or whole file fails if `strict=true`).
2. Upsert key: `(source, external_gig_id)` → else normalised `origin_url` → else content similarity flag. Re-importing the same file creates **0** new records (T05/T06).
3. Imported rows enter **Review Pending** like any discovery – CSV import never bypasses review or verification.

## Export behaviour
`scope=approved` (default) = human-approved dataset (`v_gig_csv_export`: approved / publish_ready / published) · `published` · `all` (admin only). Export of the sample must round-trip: `import → export` yields the same 19 values (T13).

## Sample reference rows (from FRD)
`GIG-RR-101 · AI Reels Content Producer · M1 · $45 / hr · 2026-09-18` and `GIG-VF-102 · Brand Asset Generator · M2 · $600 fixed · 2026-09-19` (origin: Upwork-type opportunity URLs).
