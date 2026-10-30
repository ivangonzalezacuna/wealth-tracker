# PDF snapshot import integration guide

Snapshot PDF imports populate monthly account valuations and supplemental ETF
values, not transactions. Files are processed locally with PDF.js. The editable
draft and normal **Review → Save snapshot** flow remain the only way to save
valuations. For usage and account mapping, see the
[README](../README.md#3-log-your-first-monthly-snapshot).

The final review stays open until the snapshot is saved. While saving, its
actions are disabled to prevent duplicate writes or accidental dismissal. If a
sync blocks saving or persistence fails, an explicit error keeps the draft and
review available for retry or **Back to edit**, without re-importing the PDF.

## Supported reports and limits

- **German Trade Republic valuation statements:** printed EUR market values,
  ISINs, fund names and reconciled securities/cash totals. English layouts and
  other report formats are not registered in production.
- The valuation date must be month-end and match the selected completed snapshot
  month. Filenames are not date evidence.
- One text-based PDF at a time: 10 MiB, 20 pages, 25,000 text items,
  1,000,000 characters and a 30-second processing deadline.
- Scans, OCR and password-protected PDFs are unsupported. Cancel or use manual
  entry when extraction fails.
- The normalized contract is EUR-only. A foreign-currency report must not be
  relabelled EUR; supporting it requires an explicit contract/FX extension.

## Single source of truth

After the reviewed account-linked valuation conversion, an investment mapping
selects the destination account for each imported ETF valuation. The same ISIN
can occur in different accounts: imports update `(account, ISIN)` fields and do
not duplicate the global security definition. Reimporting replaces reviewed
fields rather than adding their values again; Undo is scoped to the imported
account. Destinations must be open for the statement month, including historical
accounts that are no longer primary. Each account's ETF subtotal is reconciled
against its own balance. Legacy global valuations remain supported until the
one-time conversion; see the [lifecycle guide](account-closure-plan.md).

The pipeline is **PDF text → registered parser → normalized statement → account
mapping → editable draft → Review → Save**.

| Component                                                                                                              | Responsibility                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [snapshotPdf.ts](../src/import/snapshotPdf.ts)                                                                         | Bounded local extraction, cancellation and worker cleanup               |
| [snapshotStatement.ts](../src/import/snapshotStatement.ts)                                                             | `SnapshotParser`, normalized statements and mapping schema contracts    |
| [snapshotParsers.ts](../src/import/snapshotParsers.ts)                                                                 | Registered report descriptors, recognition and shared output validation |
| [snapshotTradeRepublic.ts](../src/import/snapshotTradeRepublic.ts)                                                     | Verified German Trade Republic layout and reconciliation                |
| [snapshotMapping.ts](../src/import/snapshotMapping.ts), [snapshotDraft.ts](../src/import/snapshotDraft.ts)             | Live destination validation, month checks and valuation proposals       |
| [snapshotMappingFields.ts](../src/ui/snapshotMappingFields.ts)                                                         | Shared schema-driven fields for first-use setup and Settings            |
| [snapshotImportPanel.ts](../src/ui/snapshotImportPanel.ts), [snapshotImportDraft.ts](../src/ui/snapshotImportDraft.ts) | Chooser, automatic fill, transient review context and safe Undo         |
| [snapshotDialog.ts](../src/ui/snapshotDialog.ts)                                                                       | Existing draft, currency handling and final Review/Save                 |

PDF.js and its worker come from the same installed `pdfjs-dist` version. Vite
resolves `pdfjs-dist/build/pdf.worker.min.mjs?url`; do not copy workers into
`public/` or hard-code generated asset names. The worker is same-origin, allowed
by [netlify.toml](../netlify.toml), and precached with parser assets by
[vite.config.mjs](../vite.config.mjs) for installed-PWA offline use.

## Adding a report parser

1. Create a parser module under `src/import/` implementing `SnapshotParser`.
   - `matches(pages)` identifies the provider **and specific report layout**.
   - `parse(pages)` validates printed values, source date, duplicates, page
     completeness and any reconciliation required by that layout.
   - Return a stable `documentType`, `YYYY-MM-DD` date, `currency: 'EUR'`,
     finite safe values and explicit warnings. Do not include raw document text,
     filenames or document account identifiers.
   - Reject conflicting or unsupported data. Unknown/ambiguous reports fail;
     a recognized report's parsing error never falls through to another parser.
2. Register one descriptor in
   [snapshotParsers.ts](../src/import/snapshotParsers.ts), with the stable ID,
   display label, recognition/parse functions and one mapping schema:
   - **`investment`:** use `positions` for supplemental ETF allocations and
     `securities`, `cash`, `total` for verified balances. Reuses the primary
     investment account's combined/split/positions-only mapping. Omit unverified
     totals on partial reports; never invent missing values.
   - **`balances`:** declare named slots with `key`, `label` and eligible
     `moneyTypes`. Return verified values under those keys in
     `statement.balances`, with `positions: []`. Supports ordinary cash, savings,
     pension or other configured account types without a primary investment
     account. Required slots map to distinct live eligible accounts; missing
     values block filling rather than becoming zero.
3. Reuse the existing chooser, mapping persistence, draft fill, currency
   provenance, Undo and Review. Settings automatically lists registered report
   types in one selector/editor instead of stacking forms. No provider-specific
   dialog or Settings handler is needed for either existing schema. A new
   mapping behavior needs its own implementation and tests.
4. Add fictional fixtures and tests. The test-only
   [balanceParser.ts](../tests/fixtures/snapshot-import/balanceParser.ts)
   demonstrates a savings report through the shared pipeline; it is not
   registered in production.

## Persistence and privacy

Only saved snapshot values and explicitly saved account mapping preferences are
persisted. Mappings use the versioned `snapshot_import_mappings` setting, keyed
by provider/report type, and contain mode and internal account IDs. They follow
ordinary backups and Drive sync; cancelling a snapshot does not undo a saved
mapping. Invalid destinations require repair, and unreadable preferences require
an explicit reset.

Files, extracted text, filenames, document metadata and transient review context
are not stored, synced, backed up or sent to telemetry. Importing does not create
transactions or holdings configuration; unknown valid ISINs remain supplemental
snapshot entries.

Generate fixtures independently with invented names, ISINs and financial values.
Never commit/upload private statements, derive fixtures from them or attach them
to CI artifacts. Browser outputs belong only in `test-results/playwright/` and
`test-results/production/`; do not collect or clean the parent folder, which may
contain local private files.

## Validation checklist

1. Cover recognition, localized amounts, dates, duplicate identifiers,
   contradictory totals and incomplete documents in parser unit tests.
2. Test destination eligibility, mapping persistence/reset, partial reports,
   automatic fill, later edits, Undo, Review/Back/Save and currency handling.
3. Run typecheck, focused unit tests and build:
   ```sh
   corepack yarn typecheck
   corepack yarn test src/import/snapshotParsers.test.ts src/import/snapshotTradeRepublic.test.ts src/import/snapshotPdf.test.ts src/import/snapshotMapping.test.ts src/import/snapshotDraft.test.ts src/ui/snapshotImport.test.ts src/ui/snapshotDialog.test.ts src/model/snapshotFx.test.ts src/store/config.test.ts src/backup/exportImport.test.ts src/views/settings.test.ts
   corepack yarn build
   ```
4. Run real-worker browser and production CSP/offline checks:
   ```sh
   corepack yarn playwright test snapshot-pdf-import.spec.ts
   corepack yarn playwright test --config playwright.pdf-production.config.ts
   ```
   These cover Chromium, Firefox and WebKit using generated PDFs. Verify that
   saved/backup data excludes document content and transient provenance.
5. Check formatting with the existing Prettier tooling. When upgrading PDF.js,
   also verify the package's worker export, resource cleanup and cold offline
   loading; no manual asset-path update should be needed.

## Troubleshooting

- **Unsupported or ambiguous statement:** check the registered parser's
  recognition against the actual layout. Do not broaden recognition to accept
  unverified languages or fall back to guessed values.
- **Missing account totals:** incomplete pages or unreconciled positions leave
  balances unverified. Complete them manually; a position sum is not a substitute
  for a verified account total.
- **Mapping needs repair:** edit the selected report in
  **Settings → Integrations → Statement imports**. Check account type, existence
  and primary-investment status where applicable.
- **Unexpected currency conversion:** imported values remain explicitly EUR,
  even in native-account mode. Check retained fields' currencies and final
  Review; a USD fund name does not change a printed EUR valuation.
- **Worker fails or offline import fails:** inspect worker requests, confirm the
  installed package's worker export, rebuild, and check same-origin `worker-src`
  plus PWA precaching. Keep manual entry usable when PDF loading fails.
