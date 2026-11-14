# Wealth Tracker

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Netlify Status](https://api.netlify.com/api/v1/badges/a53c2ee7-c5fa-406a-a39b-69e0126bb5bb/deploy-status)](https://app.netlify.com/projects/wealth-tracker-app/deploys)
[![CI](https://github.com/ivangonzalezacuna/wealth-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/ivangonzalezacuna/wealth-tracker/actions/workflows/ci.yml)

A self-hosted ETF portfolio and net worth tracker. Runs in the browser as an
offline-capable PWA, with local SQLite storage and Google Drive sync. There is no
application backend or shared user database.

## Quick start

Requires **Node.js 24+**, **Yarn via Corepack**, and a Google Cloud project with
OAuth credentials and the Drive API enabled.

```sh
git clone https://github.com/ivangonzalezacuna/wealth-tracker.git
cd wealth-tracker
corepack enable
yarn install --immutable
cp .env.example .env.local
# Set VITE_GOOGLE_CLIENT_ID in .env.local.
yarn dev
```

Open `http://localhost:5173` and sign in with Google.

### Google Cloud setup

1. Enable the **Google Drive API** in your Google Cloud project.
2. Create an **OAuth 2.0 Client ID** of type **Web application**. Add
   `http://localhost:5173` and your deployment URL as authorized JavaScript origins.
3. Configure Google Auth Platform **Branding**: app name, support email, home
   page, authorized domain and privacy policy URL (`<your-site>/privacy.html`).
   Update the contact link in `public/privacy.html` before self-deploying.
4. Add the `https://www.googleapis.com/auth/drive.appdata` scope under **Data Access**.
5. Configure an **External** audience. Testing mode is suitable for development;
   publish the production app to avoid Testing-mode grant expiry. The
   `drive.appdata` scope is non-sensitive; branding choices or other scopes may
   introduce separate Google verification requirements.

Only the hidden app-data folder is accessible, not ordinary Drive files, Sheets,
email or contacts. Each Google account has its own data. Use separate Google
Cloud projects and OAuth clients for development and production to isolate their
Drive data; the development banner alone does not prevent sync.

### Environment and deployment

Keep local configuration in the git-ignored `.env.local`; see [.env.example](.env.example).

| Variable                | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `VITE_GOOGLE_CLIENT_ID` | Public OAuth Client ID                              |
| `VITE_APP_ENV`          | `DEVELOPMENT` shows a banner; `PRODUCTION` hides it |

Deploy to any static host with build command `yarn build` and output directory
`dist/`. Set the environment variables in the host's settings and authorize its
origin in Google Cloud.

[netlify.toml](netlify.toml) supplies the Netlify build and security headers.
Other hosts should apply equivalent headers, including the CSP permissions for
WASM, the same-origin PDF worker, Google APIs and `api.frankfurter.dev`.

## Data, privacy and sync

- **Working data:** sql.js runs SQLite in the browser; writes are persisted in
  IndexedDB. A separate IndexedDB cache accelerates startup.
- **Cloud copy:** the SQLite file syncs to your Google Drive AppData folder.
  Writes are local first and upload automatically when connected.
- **Optional FX lookup:** Frankfurter receives currency codes and dates, not
  balances, transactions or documents. Results are cached locally.
- **Statement PDFs:** processed locally with PDF.js; documents and extracted
  text are not uploaded or included in backups.

OAuth access tokens last about an hour and are stored in memory and
`localStorage`. Reconnecting requires a user click; the app does not open
authentication popups in the background. Once a browser is set up, editing
continues offline or after token expiry. Cancelling reconnection leaves changes
on the device.

The header sync chip shows pending changes, transfer progress, failures and
offline state. Select it to reconnect or retry. A browser that has never synced
loads Drive before publishing its own data, rather than overwriting Drive with
an empty database.

If both copies changed, sync pauses. Select the chip or use
**Settings > Advanced > Cache & sync > Resolve sync conflict** to export a backup
and choose which copy to keep. Cancelling preserves both copies. Drafts remain
available, but saving requires resolution and an explicit retry. Keeping a local
copy with no snapshots or transactions is blocked.

Signing out attempts to sync and warns if changes remain local. It revokes the
current token but does not erase local data. See the [privacy policy](public/privacy.html)
for storage and deletion details.

## Using the app

### Accounts and holdings

In **Settings**, add accounts and the ETFs/funds you track. Accounts can carry
country, currency, group, contribution and expected-return settings. A security
has one definition even when held in several accounts.

Closing an account preserves its history; reopening does not automatically
restart contributions. Locked pension/retirement balances count toward total
net worth, but not liquid goal progress or the accumulation forecast. Retirement
projections release them from their configured unlock year.

The global contribution budget goes to the primary investment account.
Additional accounts can have their own contribution amounts and cadences.
Holding targets enable allocation drift and buy-only rebalancing suggestions;
TER values enable annual fee estimates. These projections are illustrative,
not trading advice.

### Monthly snapshots

1. Open **Log data** and add a snapshot for a **completed month**.
2. Enter that month's closing balance for each account, including explicit zero
   where appropriate. Copied balances are starting points, not verified values.
3. Optionally enter **ETF breakdowns** for investment accounts. Values belong
   to an `(account, ISIN)` pair. **Other ETFs** accepts additional positions
   without creating holdings configuration or transactions.
4. Review totals, allocations, currency conversions and any replacement of an
   existing month, then select **Save snapshot**.

ETF subtotals may be below their account balance, but not above it. A remainder
could be cash or unrecorded positions; it is not automatically classified as
cash. Blank ETF fields are omitted, not saved as zero. Amber/green field
indicators and Review hints distinguish missing/copied values from edits.

The month identifies the valuation date, not the entry date: record October's
closing balances as October even when entering them in November. Snapshot
position changes include trades and transfers, so they are not investment returns.

#### Import values from a statement PDF

Select **Choose statement PDF** inside the snapshot dialog. Text-based **German
Trade Republic valuation statements** are supported. The statement must be dated
at month-end and match the selected completed month.

Set a combined securities/cash, split-account or positions-only mapping. Imported
fields replace draft values; unrelated fields remain unchanged. **Undo import**
preserves subsequent edits. Finish with the normal **Review > Save snapshot** flow.

Mappings can target investment accounts open in the statement month, including
historical accounts that are no longer primary. Explicitly saved mappings follow
backups and Drive sync, even if the snapshot is cancelled. Edit or reset them in
**Settings > Integrations > Statement imports**.

English layouts, other brokers, scans/OCR and password-protected PDFs are not
supported. See the [PDF import guide](docs/pdf-snapshot-import.md) for limits,
parser contracts and maintenance.

### Transactions and CSV import

Use **Log data > Import CSV** for Trade Republic full transaction history or N26
savings transactions. Review the preview before confirming. Repeated imports
deduplicate by provider ID or deterministic profile-based ID; existing rows are
not overwritten.

You can also add, edit and delete transactions manually, including BUY and SELL.
The ledger supports search, filters and bulk deletion. Cost basis uses the
configured average-cost, FIFO, LIFO or HIFO method.

Standalone fees with an ISIN belong to that holding; fees without one remain
portfolio-level. Imported taxes/refunds are informational cash-flow history,
not jurisdiction-aware tax reporting or filing guidance.

### Portfolio and analytics

**Portfolio** provides holdings, contributions, dividends/interest, allocation
drift and contribution-based rebalancing. Account filters select holdings rows;
they do not produce account-specific transaction cost basis or P&L.

**Analytics** separates net worth growth from investment performance. TWR is
cumulative and adjusts for external flows; IRR is annualized and also reflects
their timing. Both require complete balances and cash-flow records.

Account allocation uses snapshot balances; holding allocation uses purchase
costs, so their totals differ. Risk summaries require at least 24 valid monthly
investment-return periods with no skipped gaps or missing valuations, normally
25 snapshots. The return heatmap has its own history-count gate.

Recorded income follows the latest transaction month rather than today's date.
Amounts are summed without separately deducting tax; gross/net treatment depends
on the source. Income and valuation denominators can cover different accounts.

### Goals and projections

Configure named goals and milestones in Settings. Progress uses liquid net worth,
excluding locked accounts.

The **Net worth > Projections** card provides forecast scenarios and retirement
withdrawals: fixed monthly amounts, inflation-linked amounts or an annual
percentage of the remaining balance paid monthly. Withdrawal amounts are pre-tax.
Projections assume fixed returns and do not model sequence-of-returns risk.

### Charts and navigation

Charts support zoom/pan, reset, a data table, fullscreen and keyboard-operable
legends. On desktop, use Ctrl + wheel to zoom; on touch screens, pinch to zoom
and swipe sideways to pan. Chart drill-down opens the relevant ledger, snapshot
or holding; on touch screens, use the tooltip's **Open** button.

Expandable table rows respond to click, Enter or Space. The header menu controls
Light, Dark or System theme. Install the PWA through your browser's install or
**Add to Home Screen** action for offline use.

### Backup and restore

**Settings > Advanced > Backup & restore** exports a human-readable JSON backup
of accounts, holdings, settings, snapshots, transactions, import metadata and FX
cache. Restore asks for confirmation, replaces local data and explicitly replaces
the Drive copy when sync succeeds. Export a backup before destructive recovery.
The app flags backups older than 30 days.

Old backups containing global ETF valuations are rejected without replacing live
data. Use an account-linked backup exported after conversion in the previous release.

## Currency model and limitations

Reporting and display currency is **EUR**, not configurable. Accounts can have
native currencies; snapshot Review converts entered foreign amounts at the
snapshot month's closing FX rate. Missing rates block conversion rather than
silently saving foreign balances as EUR; retry or explicitly enter converted EUR.

Transactions store their original `currency` and a date-specific `fxRate`
**from that currency to EUR**. For example, `100 USD` at `0.92` is `92 EUR`.
Broker-provided/manual rates remain authoritative; optional Frankfurter lookups
help resolve missing context. There are no live prices or background FX polling.

**ETF merger cost-basis carryover is not implemented.** The `foldInto` field does
not yet consolidate multi-leg fund mergers. Cross-check affected cost basis and
realized P&L against broker statements. Monthly purchase/contribution figures
measure BUY activity, not net cash invested after sales.

## Development

The app uses vanilla TypeScript, Vite, sql.js, IndexedDB, Apache ECharts and PDF.js.

```sh
yarn lint          # ESLint unused-code errors, then formatting check
yarn lint:fix      # ESLint fixes, then formatting
yarn format        # Formatting only
yarn typecheck     # Source, browser tests, scripts and configuration
yarn test          # Vitest unit/DOM tests
yarn test:e2e      # Playwright: Chromium, Firefox and WebKit
yarn build
```

CI runs lint, typecheck, unit tests and build on pull requests and pushes to
`main`. A browser matrix also runs E2E and production PDF/CSP/offline checks.
Dependency audits run on pull requests to `main` and weekly; findings are warnings,
not deployment blockers. Dependabot proposes grouped weekly updates.

Keep comments for invariants, units, compatibility and non-obvious decisions,
not line-by-line narration. Tests should call production code or exercise real
interactions rather than reproduce implementation logic.

- [sql.js and WASM maintenance](docs/sqljs-wasm.md)
- [PDF snapshot import maintenance](docs/pdf-snapshot-import.md)
- [Roadmap](ROADMAP.md)

### Adding a CSV provider

Create an `ImportProfile` in `src/import/profiles/<bank>.ts`, then register it in
`src/import/profiles/index.ts`. Profiles define column mappings, locale/date
rules, transaction types and identifying headers. Follow the existing Trade
Republic and N26 profiles and add fictional fixtures in `src/import/parse.test.ts`.
Unmapped types must appear in the preview rather than disappear silently.
