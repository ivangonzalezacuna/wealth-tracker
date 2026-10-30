# Wealth Tracker

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Netlify Status](https://api.netlify.com/api/v1/badges/a53c2ee7-c5fa-406a-a39b-69e0126bb5bb/deploy-status)](https://app.netlify.com/projects/wealth-tracker-app/deploys)
[![CI](https://github.com/ivangonzalezacuna/wealth-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/ivangonzalezacuna/wealth-tracker/actions/workflows/ci.yml)

Personal ETF portfolio and net worth tracker. Runs entirely in the browser as a PWA, with offline support and Google Drive sync.

## Changelog note (2026-08)

- Snapshot ETF breakdown now supports partial allocation: ETF subtotals may stay below the account total (tracked as unallocated cash), while over-allocation is still blocked.
- Trade Republic `TRANSFER_INSTANT_INBOUND` is now treated as an internal transfer, so it is excluded from TWR and IRR calculations, which measure only market-driven returns.

## What you need

This app is designed to be cloned and self-deployed. Each person runs their own instance. There is no shared backend or multi-tenant hosting.

**Prerequisites:**

1. A **Google Cloud project** with OAuth 2.0 credentials and the Drive API enabled
2. A **static hosting platform** (Netlify is used here, but Vercel, Cloudflare Pages, or any static host works)
3. **Node.js 24+** and **Yarn** (via Corepack)

## Quick start

```bash
git clone https://github.com/ivangonzalezacuna/wealth-tracker.git
cd wealth-tracker
corepack enable
yarn install
cp .env.example .env.local
# Edit .env.local with your Google OAuth Client ID
yarn dev
```

Open `http://localhost:5173`, sign in with Google, and you're running.

## Google Cloud setup

Create a Google Cloud project (or reuse an existing one):

1. **Drive API** - enable it (APIs & Services > Library > Google Drive API)
2. **OAuth 2.0 Client ID** (Google Auth Platform > Clients, Web application type):
   - Authorized JavaScript origins: `http://localhost:5173` + your production URL
3. **Branding** (Google Auth Platform > Branding):
   - App name and user support email
   - App home page: your production URL
   - Privacy policy: `<your production URL>/privacy.html` (shipped in `public/privacy.html`; change the contact link to your own before deploying)
   - Authorized domain: your site's domain (for example `your-site.netlify.app`; `netlify.app` is a public suffix, so the subdomain is accepted)
   - No logo needed: adding one triggers Google's brand verification
4. **Data Access**: add the `.../auth/drive.appdata` scope
5. **Audience**: User type External, then **Publish app** to move it to _In production_

The app only requests the `drive.appdata` scope, which gives access to a hidden per-app folder in Drive. No Sheets, no Picker, no API keys needed.

**Why publish instead of staying in Testing?** In _Testing_ mode Google shows a "Google hasn't verified this app" warning on every sign-in, and each grant expires after 7 days, forcing a full consent screen again. `drive.appdata` is a non-sensitive scope, so publishing needs no Google review: the warning disappears and the grant no longer expires. Publishing does not make your data visible to anyone: every Google account only ever reaches its own hidden AppData folder. After publishing, sign out and sign in once so the browser gets a fresh, non-expiring grant. For a development client, Testing mode is fine.

## Environment variables

All configuration lives in `.env.local` (git-ignored). See `.env.example` for the full reference:

| Variable                | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `VITE_GOOGLE_CLIENT_ID` | Your OAuth Client ID from Google Cloud Console          |
| `VITE_APP_ENV`          | `DEVELOPMENT` or `PRODUCTION` (controls the dev banner) |

**Recommended:** use two separate OAuth applications (one for dev, one for prod). Since Drive AppData is isolated per OAuth app, dev and production data can never mix.

When deploying, set these same variables in your hosting platform's environment settings rather than committing them.

## Hosting

This is a static PWA with no server-side logic. Any platform that can serve a `dist/` folder works.

### Netlify (used here)

The included `netlify.toml` configures:

- Build command: `yarn build`
- Publish directory: `dist`
- Security headers (CSP, X-Frame-Options, etc.)

Set `VITE_GOOGLE_CLIENT_ID` and `VITE_APP_ENV` in Site settings > Environment variables.

Add your Netlify URL to the OAuth Client ID's **Authorized JavaScript origins** in Google Cloud Console.

### Other platforms

For Vercel, Cloudflare Pages, or similar:

- Build command: `yarn build`
- Output directory: `dist`
- Set the same environment variables
- Add security headers equivalent to those in `netlify.toml` (optional but recommended)

---

## How it works

The app stores all your data in a **local SQLite database** (sql.js WASM) running in the browser. This database is:

1. **Persisted locally** in IndexedDB (survives reloads and restarts) — this is the primary working store for all reads and writes
2. **Synced to Google Drive AppData** (hidden per-app folder) as a cloud backup and cross-device copy
3. **Cached in a separate IDB store** for instant page load (~50ms from cache while full sync runs in background)

There is no backend. Your data never leaves your browser except to your own Google Drive.

Writes (snapshots, CSV imports, settings changes, backup restores) go to local SQLite immediately, regardless of connectivity, unless a known sync conflict first needs resolving. On startup, the app checks whether the Google Drive copy is newer than the local one; if it is and there are no unsynced local changes, the cloud copy is downloaded (for example, when picking up changes made on another device). If both copies changed, sync pauses rather than silently choosing a copy. Drive sync is otherwise opportunistic: changes are pushed automatically after a short debounce when online and connected, and any writes made offline or while not connected to Google are pushed on the next sync.

A browser that has never synced (new device, or site data cleared) always loads the Drive copy first and only adds the snapshots and transactions it saved itself, so it can never overwrite Drive with an empty or default database. If both copies changed, sync pauses and asks which one to keep; keeping this device's copy is blocked when it has no snapshots or transactions.

## Stack

- **Vite** - build tool
- **TypeScript** - vanilla, no framework
- **sql.js (WASM)** - in-browser SQLite database
- **Google Drive AppData** - cloud backup and cross-device sync
- **IndexedDB** - local persistence (SQLite blob + fast-boot cache)
- **Apache ECharts** - interactive charts (zoom and pan, linked timelines, drill-down, data table, fullscreen), tree-shaken and lazy-loaded
- **Google OAuth2** - authentication (`drive.appdata` scope only)

---

## Using the app

When you open the app for the first time, a setup banner guides you through three steps:

### 1. Sign in with Google

Click **Sign in** to authorize the app. It requests only the `drive.appdata` scope: access to a hidden app-specific folder that no one else can see. No access to your files, sheets, or any other Drive content.

You only do this once per browser. Google access tokens last about an hour and can only be renewed from a click (Google opens a short popup that closes by itself), so the app never interrupts you on load. After the token expires the app keeps working on this device: you can keep logging snapshots, importing CSVs and changing settings. Your next save reconnects to Google from that same click and syncs; if you close that popup, changes stay on the device and the sync chip shows _Not synced_ until you select it. The popup preselects the account you used before, and the app warns you if you connect a different Google account, since each account keeps separate data.

### 2. Add your accounts

Go to **Settings** and add your investment accounts (e.g. "Trade Republic", "Interactive Brokers"). For each account, add the holdings (ETFs/funds) you track. This defines the structure of your portfolio. Once the lists grow, both cards offer a search box and chips (account types in use for accounts; All / Active / Closed for holdings). Adding or editing an item clears the filter so it stays visible.

Dialog fields that reuse earlier values (institution, country, group and currency for accounts; name and ISIN for holdings and transactions; transaction currency) show a dropdown arrow when there is something to pick. The arrow lists every known value, typing narrows the list, and you can always type a new value, which is offered from then on. A value drops out once nothing stores it any more, including items marked for removal; currency lists only the codes in use plus EUR. Picking a known security fills its paired ISIN or name and its last-used currency.

For accounts, institution suggestions stand alone; only country and currency are linked. The country list shows your own countries first, then common countries, and names are recognised in several languages (Suiza, Schweiz and Switzerland all work). Unless you typed or picked a currency yourself, choosing a country, also on an existing account, sets the currency your accounts in that country use, otherwise the country's usual one (e.g. Switzerland → CHF). Changing the currency never changes the country.

Accounts can optionally be marked as **locked** (e.g. pension or AVD accounts) with an expected accessibility year. Locked accounts are included in total net worth but shown separately as "Liquid" (accessible now) and "Locked" (retirement) net worth KPIs. Locked accounts are excluded from goal progress calculations and from the accumulation forecast — they only become available in the retirement projection from their unlock year onward.

You can also configure extra contributions (employer match, state subsidies) that factor into DCA forecast projections. The **global monthly contribution budget** is routed to your primary investment account. To split contributions across multiple accounts, configure per-account contribution amounts in the account settings for each additional account. The **contribution interval** (weekly / bi-weekly / monthly / quarterly) controls how often you invest and normalises the budget into a per-execution amount.

Each holding can be given a **target allocation percentage** (set in the holding dialog). Once at least one target is configured, the Portfolio tab's allocation drift chart compares your actual allocation against those targets (one bar per holding, largest gap first, with your drift alert threshold shaded around zero; click a bar to open the holding) and the collapsible **Rebalance with contributions** section suggests top-up amounts based on your **calibration interval** (weekly / every 2 weeks / monthly / quarterly, picked from a compact select next to the 1 mo – 1 yr horizon toggles). It leads with one line showing how far max drift falls over the chosen horizon, lists funded holdings first, and folds holdings that get nothing this period under a single "N holdings get 0 €" row. It is flagged as suggested once drift reaches the high band of your alert threshold. The assumptions (new contributions only, no selling, no market moves) sit in an info tip, and a short warning appears when some holdings would still be above target after 12 months. When max drift crosses your alert threshold, a dot appears on the **Portfolio** tab and the **Holdings** chip (amber for moderate, red for high) so you can follow it to the drift card. A backup older than 30 days (or no backup yet) is flagged the same way: a dot on **Settings** and **Advanced**, and a **Backup due** badge on the Backup & restore card header. Hover a marked tab or the badge (or tap the dot or badge on touch screens) to see what needs attention; tapping the dot shows the note without switching tabs.

### 3. Log your first monthly snapshot

Go to the **+ Log** tab. Enter the closing value for each account for the selected month, review the draft, then hit **Save snapshot**. This records your net worth for the month.

Holdings, snapshot history and the income **By year** table share an outline
chevron: right means closed, down means open, on desktop and mobile alike.
Click a row or focus it and press Enter or Space to toggle its details. The
chevron is decorative, not a separate control. Snapshot ETF breakdowns and
transaction/import disclosures use the same indicator.

The slim colour bar beside each history total previews the positive account
balance mix. Expand a month to see matching account colours, balances and
percentage shares, largest first in the same order as the bar, without relying
on hover or a separate legend. These shares exclude negative
balances; net worth still includes them. Remainders that round to zero cents
display as `0,00 €`, not negative zero.

To avoid copying ETF values manually, click **Choose statement PDF** inside the snapshot
dialog and select a text-based **German Trade Republic valuation statement**.
The primary investment account is selected automatically. Set up combined,
separate securities/cash, or positions-only mapping once; it is remembered in
**Settings → Integrations** and follows backups/Drive sync. Valid ETF values and
mapped totals automatically replace existing draft values; unrelated fields stay
unchanged. **Undo import** preserves later edits. Complete other balances, then
**Review → Save snapshot** as usual—the only valuation confirmation step.
Unknown ETFs stay in **Other ETFs**; final Review includes extracted names,
before/after context, retained-data warnings and expandable/searchable positions.

PDFs are processed locally, one at a time, with no document uploads. The statement
must be dated at month-end and match the selected completed month. English layouts
remain gated pending verified broker labels; scans/OCR and other brokers are not
supported. See the [PDF snapshot import guide](docs/pdf-snapshot-import.md) for
limits, privacy, implementation and adding report parsers.

**Change mapping** reapplies the import to the current draft. Settings edits or
resets the mapping for future imports; cancelling a snapshot does not undo an
explicitly saved mapping. Settings uses one mapping editor per selected report
type rather than stacking a form for every provider.

Slim amber input edges and Review dots identify copied or missing values; green
marks modified, new or imported values. Hover hints and screen-reader descriptions
provide details, including imported EUR currency. Copied values are not verified
for the new month. Missing ETF values are omitted, not saved as zero.

Once these three steps are done, the setup banner transitions to a **"Recommended next steps"** prompt with two optional-but-important actions:

- **Import transactions** — imports your broker CSV to unlock cost-basis tracking, realized P&L, and dividend analytics (Portfolio and Dividends tabs)
- **Configure holdings** — adds ETF/fund definitions to your investment account in Settings, enabling the Portfolio drift view. For each holding you can set the **TER** (total expense ratio in %) to see annual cost estimates, and a **target allocation %** to power the drift chart and rebalance plan. The **cost-basis method** (average cost, FIFO, LIFO, or HIFO) is configured globally in Settings.

The banner disappears automatically once both are completed, or you can dismiss it manually at any time.

### Monthly workflow

1. Open the app on any device
2. Go to the **+ Log** tab
3. Select a completed month and enter its closing account balances. New snapshots default to the last completed month; current and future months cannot be selected.
4. For the primary investment account, optionally expand **ETF breakdown** to record the closing market value of each ETF position (see below).
5. Review the draft, then hit **Save snapshot** (saved locally; synced to Drive when online).
6. Re-import your broker CSV whenever you want updated cost-basis or dividend data

#### Per-ETF market values in snapshots

The month describes when the balances were valued, not when you type them in. For example, record October's closing balances as **October**, even if you enter them in November. October ends on 31 October; a screenshot of November's current portfolio does not necessarily show October's closing values.

Copied values are starting points, not fresh valuations. Update them before saving. Review warns when all numeric balances and ETF values remain unchanged from the source month; changed drafts do not show a copied-value notice. Enter an explicit balance for every account, including zero where appropriate. Non-EUR balances must be converted successfully or explicitly entered in EUR; an unavailable FX rate must not silently mix currencies in your saved snapshot.

Subtle input edges and tiny Review dots distinguish untouched values (amber)
from modified/new/imported values (green), without extra label rows. Hover a
field or dot for details; screen readers receive the status too. Saved-snapshot
values that are unchanged stay neutral. Blank values use amber; blank ETF values
are omitted, never treated as zero. Indicators update as you edit or revert and
are temporary, not saved.

When recording a snapshot for your primary investment account, you can expand the **ETF breakdown** section to enter the closing market value of each individual ETF position.

This is optional, but enables two additional features:

- **Drift chart**: uses actual market values instead of cost basis, giving a more accurate picture of your current allocation vs. target allocation.
- **Holdings detail panel**: shows a "Market value" and "Unrealized gain" column for each position when ETF values are available for the latest snapshot.

**How to use it**

1. Enter the account total in the main balance field as usual.
2. Click **ETF breakdown** to expand the section.
3. Enter the closing market value for each ETF (from your broker's dated portfolio view or statement). Use the collapsed **Other ETFs** section for additional configured or untracked positions, identified by ISIN. These entries do not create transactions or holdings configuration.
   - Existing holdings keep their identifiers and allow balance changes.
   - Manual entries allow ISIN and value changes, or removal from this snapshot. Removing a manual entry does not delete transactions, holdings configuration or other months' values.
4. The reconciliation bar at the bottom shows **Allocated** (sum of ETF values entered) and **Remaining** (account total minus allocated), helping you catch typos before saving.
   - Remaining turns amber if you have over-allocated (sum exceeds total).
   - Remaining stays green when ETF values are at or below the account total. The difference is an unexplained remainder: it may be cash or positions you have not recorded, not automatically confirmed cash.
5. Review account totals, ETF allocation, currency conversion and any existing-month replacement. Use **Back to edit** to make corrections without losing your draft, then save.

**Storage format**

Per-ETF market values are stored in the snapshot record as `etf_<ISIN>` keys alongside the regular account balance keys (e.g. `etf_IE00B4L5Y983: 12500`). No separate database migration is needed; missing keys are treated as "no data".

To fill these values from a supported PDF, use the
[monthly snapshot import workflow](#3-log-your-first-monthly-snapshot).

**Inactive but held positions**

ETFs that you have stopped contributing to but still hold remain separate from manual entries inside **Other ETFs**. They should still be included when recording values, as they remain part of your total portfolio allocation. The drift chart will show these as legacy holdings with a 0% target, reflecting that they are being wound down over time.

### Importing transactions

For detailed cost-basis, realized P&L, and dividend tracking, import your broker's CSV export:

1. Go to **+ Log** > **Import CSV**
2. Select or drag your broker CSV (Trade Republic full transaction history and N26 savings account transactions are supported built-in; N26 does not export investment transactions — for those use Trade Republic or a custom profile. [Adding more banks](#adding-support-for-a-new-bank) takes ~10 minutes)
3. Review the detected transactions and confirm

After import, transactions appear in the **transaction ledger** at the bottom of the **+ Log** tab, where you can review, filter, and delete individual records. Filter by type with the chips (each shows its count), search by name, ISIN or source, and use **Clear filters** on the "x of y" line to reset. Chart drill-downs mark the filter as **From chart**. To delete several rows at once, press **Select** first.

Transactions are merged with existing data using an append-only strategy: new rows are inserted, but rows that already exist are not overwritten. Matching is done by transaction ID (provider ID when available, otherwise deterministic profile-based IDs for providers without native IDs). This makes repeated imports deterministic across sessions while still preserving distinct same-key rows.

`TAX` rows are canonicalized at import time so tax value handling is deterministic (`tx.tax` is the source of truth; legacy rows may still fall back to `tx.amount`). For standalone `FEE` rows, entries with an ISIN are attributed to that holding's costs, while non-ISIN fees remain portfolio-level fees.

Income analytics on the Analytics tab are anchored to your latest imported transaction month, so
trailing-12-month income and income growth do not drift just because calendar time passed. Dividend
yield is calculated against the current value of investment accounts, not total net worth.

Tax amounts in the app are **aggregated informational context** from imported transactions
(withholding + refunds), meant to help you understand personal cashflow history across providers.
They are **not** jurisdiction-aware tax reporting or tax filing guidance, and if your tax residence
changes over time those figures may become incomplete or no longer map cleanly to your local tax
rules.

#### Transaction ledger interface

The transaction ledger at the bottom of the **+ Log** tab uses a compact stacked layout:

- **Header row:** Date, transaction type chip, and source chip
- **Body rows:** Name, ISIN, amount, and extra metadata (for example shares or interest tax)
- **Actions:** Edit/delete buttons per transaction

On narrow screens, each transaction is shown as a stacked card and actions stay pinned in the
top-right corner to keep them accessible while scrolling.

Long ETF names are truncated with ellipsis in the row, and you can click the name to open a
popover with the full ETF name/ISIN. Rows with no name value are automatically hidden in stacked
mobile view to reduce visual noise.

### Portfolio tab

The Portfolio tab has three subviews:

- **Holdings** — your ETF positions with cost basis, unrealized gain, market value (when snapshot ETF values are recorded), and the allocation drift chart. Search by ISIN or name; the All / Held / Closed chips only appear once you have closed positions. Choose 10, 25 or 50 rows per page.
- **Contributions** — month-by-month DCA history and contribution split across holdings.
- **Dividends** — dividend and interest income history, yield, and growth metrics.

### Analytics tab

The Analytics tab separates net worth changes from investment returns:

**Overview:** Net worth change is the lead balance figure. A compact investment summary shows investment value minus purchase cost, cumulative TWR (Time-Weighted Return), and annualized IRR (Internal Rate of Return). Investment value minus cost is not comprehensive profit: investment-account balances can include cash.

**Net worth growth details:** Expand this section for net worth growth, YTD growth, annualized CAGR, and year-over-year change. These include deposits and withdrawals; they are not investment-performance measures.

**Investment returns:** TWR adjusts for external cash flows; IRR also reflects their timing and amounts. Cumulative TWR and annualized IRR are not directly comparable, and both depend on complete balances and cash-flow records. Monthly heatmap and annual returns share a card and both appear once 24 monthly returns are available. Each year shows its return, its market gain (value change not explained by deposits or withdrawals) and its net contributions; partial years show how many months they cover. Blank periods are not zero returns.

**Allocation:** Two matching donuts. **Accounts** splits the latest snapshot balances (savings and pensions included) by account, country, group or type. **Holdings** splits purchase costs, not market values, by asset class, region or individual holding. It opens on the first breakdown that has more than one slice, and offers **Include inactive** when inactive holdings still carry cost (the button switches to **Hide inactive** while they are included). The two donuts use different totals. They sit side by side on wide screens and stack on phones and tablets.

**Advanced analytics:** Volatility, Max Drawdown, Sharpe, Sortino, Calmar, Average Drawdown, and Drawdown Duration use investment-account-only monthly returns. Risk summaries require at least 24 valid monthly return periods with no skipped gaps or missing investment valuations across the supplied history; normally this means at least 25 snapshots. The heatmap has a separate history-count gate. These historical measures are descriptive, not forecasts or universal investment targets.

**Recorded income:** The income summary and chart include recorded dividends and interest. Amount magnitudes are summed without separately deducting tax or withholding; gross/net treatment depends on the source. The trailing window ends at the latest import, and the income numerator can cover a different account scope from the investment-value or purchase-cost denominator.

The risk-free rate used for Sharpe and Sortino is configurable in Settings (default 2%).

### Goals

Named savings goals can be configured in **Settings > Goals**. Each goal has a target net worth amount and an optional target date. Goal progress cards appear on the **Net Worth** tab and show how much of your _liquid_ net worth (excluding locked pension/retirement accounts) has been accumulated toward each goal.

### Retirement planning

The **Net Worth** tab has a **Projections** card with two tabs that share one inflation setting:

- **Forecast** leads with the projected net worth at the end of the visible window (and in today's euros when inflation is set); zoom the chart to change the horizon. **Compare scenarios** adds editable optimistic and pessimistic what-ifs, drawn as a shaded band around the baseline. Goal deadlines and the retirement start are marked on the timeline. Per-account assumptions, the grouped summary and the model limitations sit in collapsible sections under the chart.
- **Retirement withdrawals** leads with how long the money lasts, then the first withdrawal and the break-even amount. Configure a start date and a withdrawal strategy:
  - **Fixed €** — the same €/month every month (nominal, not inflation-adjusted)
  - **Inflation-linked €** — a starting €/month raised each year by the inflation rate (the classic "4% rule")
  - **% of balance** — a fixed yearly percentage of the remaining balance, paid monthly

The withdrawal starts at a suggestion of 4% of the balance at retirement and follows the start date until you type your own amount; typed amounts are kept per strategy and survive reloads (↺ returns to the suggestion). The chart shows the projected balance and the monthly withdrawal; if the balance reaches zero, the depletion date is marked and the empty period shaded. **Note:** All withdrawal amounts shown are pre-tax. Actual spendable income will be lower depending on your jurisdiction and account type. Projections use a fixed expected return and do not model sequence-of-returns risk.

### Charts

All charts share the same controls and follow the light/dark theme:

- **Zoom and pan** on timelines instead of fixed range buttons. Each chart opens on a sensible default view (full history; the last 12 months for monthly bars; 5 years for forecasts) and **Reset view** returns to it. On a computer, drag inside the plot to pan, use Ctrl + mouse wheel (or a trackpad pinch) to zoom, or drag the slider under the chart. On touch screens, **pinch** inside the chart to zoom and drag sideways to pan; vertical swipes keep scrolling the page. Forecast titles follow the visible horizon (e.g. "12 years").
- **Toolbox** (top-right): box zoom and undo (desktop), reset view, **data table** (a compact, scrollable table of the plotted values with headings that stay in place; close it with × or Escape), save as image (desktop) and **expand** to full screen.
- **Lines** are drawn with gentle curves on every line chart.
- **Legend** entries are buttons that toggle series on and off (keyboard accessible); long legends wrap onto extra rows instead of paging.
- **Linked timelines:** the Analytics growth, drawdown and rolling CAGR charts share their zoom window and hover position.
- **Drill-down:** click a point to jump to the underlying data. On touch screens a tap only shows the tooltip; tap its **Open …** button to navigate, so scrolling past a chart never jumps away. Net worth history and growth points open that month's snapshot in **Log › Snapshots** (the history is filtered to that month and marked **From chart**; **Clear filters** shows all again); contribution and income months open **Log › Transactions** filtered to that month; cost-basis and allocation drift bars reveal the holding in the Holdings table. The tooltip shows a hint (or the button on touch) on charts that support it.
- **Return heatmap** (Analytics): one row per year, one cell per month and the compounded year total on the right, with a shared colour scale across pages. Five years are shown at a time; use ‹ › to page through older years, and the Annual investment returns table below follows the same page (return bar centred on zero, market gain, net contributions). Hover or tap a cell for the exact return and starting value; on very narrow screens the cell numbers are hidden and the tooltip carries them.

### Header, theme and sync status

The **⋯ menu** in the top-right corner holds the theme choice (Light, Dark, or System, which follows your OS preference) and, when signed in, **Sign out**. Signing out first tries to sync; if changes still could not reach Drive, the app asks before signing out (they stay on this device and sync the next time you sign in). The theme is saved locally and applied on each page load.

The **sync chip** under the title shows the Google Drive state in one place. _Changes pending_ means a local save has not reached Drive yet; select it to connect or sync immediately. When connected, progress labels explain the current phase: _Checking Drive…_, _Uploading…_, _Downloading…_, or _Updating local data…_. _Syncing…_ covers other in-progress saves. _Synced · 5 min ago_ appears only after the applicable transfer and local refresh finish, with no newer changes waiting to upload. _Sync failed_ offers a retry, with the reason and any pending changes in its tooltip. _Offline_ (or _Offline · not synced_ when changes are waiting), _Not connected_ (editing on this device; select to connect), and _Read-only_ (cached data in a browser that never signed in) explain unavailable sync.

_Sync paused_ means this device and Drive both changed. Select the chip or **Settings → Advanced → Cache & sync → Resolve sync conflict** to export a backup and explicitly choose which copy to keep. Closing the dialog with Cancel, Escape, or a click outside it leaves both copies unchanged and sync paused. Browsing and draft preparation remain available, but a save attempt reopens the resolver without saving or discarding the draft. After resolving, retry the save yourself. If the Drive operation succeeds but refreshing local views/cache fails, the chip retries only that refresh, not the destructive overwrite/replacement.

On narrow screens the tab bar scrolls sideways, with a fade at the edge showing more tabs.

### Currency and FX model

The app currently uses a single **reporting currency** for calculations and display. Today that
currency is hard-coded to `EUR`.

> **⚠️ All display values are in EUR.** If your accounts hold assets in other currencies, ensure FX rates are populated at import time so that cost-basis and income figures are converted correctly.

Transactions may still be stored in other currencies via the `currency` and `fxRate` fields. The
expected contract is:

- `currency` = the original transaction currency from the broker/export
- `fxRate` = the rate that converts **from `currency` into the app reporting currency**
- the rate should correspond to the **transaction date**, not the current/live FX rate

Examples while the reporting currency is EUR:

- EUR transaction → no conversion needed
- USD transaction with `fxRate = 0.92` → `100 USD` is treated as `92 EUR`
- DKK transaction with `fxRate = 0.134` → `1000 DKK` is treated as `134 EUR`

This means mixed-currency portfolios are supported only by normalizing each transaction into one
canonical reporting currency. The app does **not** currently model multiple reporting currencies at
the same time.

If the reporting currency ever changes in the future (for example from EUR to DKK), historical
transactions would also need valid FX rates into that new reporting currency. In practice, the most
stable approach is to capture and store the broker-provided or externally-fetched FX rate at import
time, rather than recomputing old transactions from live rates later.

What is still missing for full multi-currency support:

- **Account-level currency metadata.** Accounts and snapshots do not yet have a first-class
  currency contract that says "this account balance was entered in DKK" or "this one stays in EUR".
- **Snapshot FX normalization.** Monthly snapshot balances are not yet converted with a
  snapshot-date FX rate before being aggregated into total net worth.
- **A configurable reporting currency.** The reporting currency is still hard-coded to `EUR`, so
  switching the app base currency later is not yet a settings-level feature.
- **Import/logging fallback FX lookup.** When a broker export or manual snapshot does not already
  contain the needed FX rate, the app does not yet fetch and persist one automatically.
- **UI/validation for missing FX.** There is not yet a dedicated user flow that blocks, warns, or
  requests correction when a non-base snapshot/account value is missing its required FX context.
- **End-to-end mixed-account coverage.** Transaction normalization exists, but mixed EUR/DKK/USD
  accounts need explicit support and tests across imports, manual snapshots, totals, history, and
  analytics.

---

## Development

```bash
yarn lint        # prettier --check .
yarn lint:fix    # prettier --write .
yarn typecheck   # tsc --noEmit
yarn test        # vitest run
yarn build       # vite build
```

CI runs lint, typecheck, test, and build on every push and PR to `main`. A separate weekly audit surfaces dependency vulnerabilities. Dependabot opens grouped weekly PRs for updates.

Run `yarn lint:fix` to auto-format before committing.

### sql.js and WASM maintenance

For architecture notes, upgrade steps, and troubleshooting, see
[sql.js + WASM integration](docs/sqljs-wasm.md).

### PDF snapshot import maintenance

For parser registration, account mapping schemas, worker loading, validation and
troubleshooting, see the [PDF snapshot import integration guide](docs/pdf-snapshot-import.md).

---

## Adding support for a new bank

Trade Republic full transaction history is supported today. The import engine is bank-agnostic, so adding another bank does **not** require touching the parser.

1. **Create a profile** at `src/import/profiles/<bank>.ts` exporting an `ImportProfile` object:
   ```ts
   export const myBankProfile: ImportProfile = {
     id: 'my_bank',
     label: 'My Bank',
     delimiter: 'auto',
     decimal: 'auto',
     dateFormat: 'DD.MM.YYYY',
     defaultCurrency: 'EUR',
     columns: {
       date: 'Datum',
       type: 'Typ',
       name: 'Bezeichnung',
       amount: 'Betrag',
     },
     typeMap: {
       KAUF: TxType.BUY,
       VERKAUF: TxType.SELL,
     },
     match: {
       headerIncludes: ['Datum', 'Typ', 'Betrag'],
     },
   };
   ```
2. **Register it** in `src/import/profiles/index.ts`:
   ```ts
   export const builtInProfiles: ImportProfile[] = [tradeRepublicProfile, myBankProfile];
   ```
3. **Done.** `detectProfile()` picks it automatically from the CSV header. Rows with unmapped types show in the import preview rather than being silently dropped.
4. **Add a test** in `src/import/parse.test.ts` (see the `fakeBankProfile` fixture for the pattern).

---

## Security model

There is no backend and no server-side secrets.

- Your data lives only in your browser and your own Drive AppData. The app never sends data anywhere except the Google Drive API, using your own OAuth grant.
- The OAuth token only accesses a hidden app-specific folder, not your files or anything else in Drive. `drive.appdata` is the most restrictive Drive scope available.
- Publishing the OAuth app to production lets any Google account sign in, but each account only ever sees its own AppData folder: nobody can read another person's data, including yours. Remove the browser's access at any time from your Google Account's third-party connections page, or with **Sign out**, which also revokes the token.
- Access tokens live about an hour and are kept in `localStorage`. There is no refresh token, and the app never requests a token in the background.
- `VITE_GOOGLE_CLIENT_ID` is visible in the built JavaScript. This is intentional: OAuth Client IDs are public by design and grant zero access alone.
- Separate OAuth apps for dev/prod means separate Drive AppData folders. Data can never cross environments.
- A Content-Security-Policy is enforced via headers (see `netlify.toml`), restricting script execution and outbound connections.
- This is a single-user, single-deployment design. One site serves one person.

---

## Data portability

### In-app backup and restore

Settings > **Backup & restore** provides:

- **Export backup** downloads a single JSON file with everything (accounts, holdings, settings, snapshots, transactions, import metadata)
- **Restore from file** reads that JSON back and replaces the local database entirely (asks for confirmation), then overwrites the Drive copy with it
- If it has been 30+ days since your last export, the settings card nudges you to run a fresh one

The JSON backup is human-readable and can be processed by any tool. The SQLite database can also be exported directly for raw SQL access.

---

## Installing as an app (PWA)

The app installs like a native app and works offline. All writes (snapshots, imports, settings) are saved immediately to the local SQLite database. They sync to Drive automatically when connectivity is restored.

- **Android (Chrome):** three-dot menu > Add to Home screen
- **iOS (Safari):** Share icon > Add to Home Screen
- **Desktop (Chrome/Edge):** install icon in address bar, or three-dot menu > Install Wealth Tracker

---

## Known limitations

- **Selling is not supported.** The app is designed for long-term buy-and-hold portfolios. SELL transactions are recognized by the cost-basis engine (FIFO, LIFO, HIFO, and average-cost all dequeue lots correctly), but there is no UI to record a sale and the monthly investment KPIs do not subtract sell proceeds.
- **Multi-leg SELL consolidation (ETF fund mergers) is unverified in production.** When a provider folds one ETF into another (for example iShares merging IEEM into CMEIU, or merging CECBE and EGB7Y into GABE), a `foldInto` field exists in the data model to carry the original position's cost basis forward instead of treating it as a full sell-then-rebuy. That computation path is **not yet implemented**. If one of your holdings undergoes this kind of provider-side merge, treat the resulting Realized P&L and cost-basis figures as incorrect until it is built — cross-check against your broker statement.
