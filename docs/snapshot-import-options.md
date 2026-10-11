# Snapshot import options — deferred work

## Scope

Future imports should help enter monthly **valuations**, not replace transaction
imports. Transactions explain purchases, quantities and cost basis; snapshots
record account totals and individual position market values at month-end.

Start with one broker format and expand only after testing real, redacted samples.
Historical reconstruction, price feeds and automatic saving are outside this scope.

## Options

| Input                    | Advantages                                                                                 | Limitations                                                                                                                            | Suggested order      |
| ------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Paste a holdings table   | Local, lightweight, no file processing; convenient from broker websites or spreadsheets    | Copied layouts vary; truncated names and missing dates need explicit matching                                                          | First                |
| Holdings/valuation CSV   | Structured identifiers, dates and currencies; predictable validation                       | Broker transaction CSVs usually do not contain closing valuations; support only verified valuation formats                             | First when available |
| Text-based PDF statement | Often dated and includes position values; local text extraction avoids uploading documents | Reading order and table layouts vary; statements may show purchase cost instead of market value                                        | Next                 |
| Screenshot OCR           | Convenient on mobile when the broker has no export                                         | Recognition errors, cropped positions, decimal separators, missing dates and ambiguous price/P&L labels; may need multiple screenshots | Focused prototype    |

Prefer the broker's dated month-end statement to a screenshot of today's portfolio.
A screenshot taken in November is not evidence of October's closing value unless
the broker explicitly shows that historical valuation.

## Shared draft and review flow

Every option should populate an editable draft using the existing snapshot review
experience. Extraction must never persist values automatically.

- Require the target month and identify the source valuation date when available.
  Warn on mismatched dates; never silently relabel current values as historical.
- Match configured accounts explicitly and positions by normalized ISIN. Ambiguous
  names or unknown identifiers require user correction, not guessed assignments.
- Keep unknown ETFs in the collapsed Other ETFs section without creating holdings
  configuration or transactions.
- Distinguish position market value from unit price, cost basis, gain/loss and cash.
- Validate complete finite numeric values, decimal/thousands separators, currencies,
  duplicate entries and account-to-position reconciliation.
- Support partial drafts and multiple images without silently double-counting.
  Missing positions are unknown, not zero.
- Display proposed changes and copied values before confirmation. Preserve manual
  fields unless the user explicitly accepts their replacement.
- Apply the same currency safety rules as manual entry. A failed conversion must
  not write a foreign amount into the EUR reporting values.

## Privacy and resilience

Process documents and images locally by default. Do not send financial documents
to third-party OCR or AI services. Any future remote alternative would require a
separate explicit privacy decision and informed opt-in.

Keep raw files, extracted text, filenames and document metadata ephemeral. Never
include them in the database, Google Drive sync, backups, logs or telemetry.
Persist only reviewed valuation fields; any proposed source-date or conversion
metadata needs a deliberate backward-compatible data contract.

Limit file size and processing time, allow cancellation, release OCR workers and
temporary image resources, and treat all extracted text as untrusted input. Escape
displayed content and allowlist accepted fields and file formats.

Load optional parsing/OCR assets only when needed. Manual entry must remain usable
offline and when extraction fails. Check dependency advisories before introducing
libraries and verify browser, CSP and PWA asset compatibility.

## Acceptance criteria for a future implementation

Use redacted fixtures for supported broker formats and cover wrong dates,
ambiguous ISINs, duplicate positions, localized numbers, partial/cropped documents,
currency conversion failures, cancellation and review/back navigation. Verify that
raw content never reaches persistence or sync. Reuse the existing unit and
cross-browser end-to-end test infrastructure.
