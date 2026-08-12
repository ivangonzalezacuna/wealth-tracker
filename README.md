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

1. **OAuth consent screen** - configure it (External, test mode is fine for personal use)
2. **OAuth 2.0 Client ID** (Web application type):
   - Authorized JavaScript origins: `http://localhost:5173` + your production URL
3. **Drive API** - enable it (APIs & Services > Library > Google Drive API)

The app only requests the `drive.appdata` scope, which gives access to a hidden per-app folder in Drive. No Sheets, no Picker, no API keys needed.

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

All writes (snapshots, CSV imports, settings changes, backup restores) go to local SQLite immediately, regardless of connectivity. On startup, the app checks whether the Google Drive copy is newer than the local one; if it is, the cloud copy is downloaded and replaces the local database (for example, when picking up changes made on another device). Drive sync is otherwise opportunistic: changes are pushed automatically after a short debounce when online, and any writes made offline are pushed the next time connectivity is restored.

## Stack

- **Vite** - build tool
- **TypeScript** - vanilla, no framework
- **sql.js (WASM)** - in-browser SQLite database
- **Google Drive AppData** - cloud backup and cross-device sync
- **IndexedDB** - local persistence (SQLite blob + fast-boot cache)
- **Chart.js** - charts
- **Google OAuth2** - authentication (`drive.appdata` scope only)

---

## Using the app

When you open the app for the first time, a setup banner guides you through three steps:

### 1. Sign in with Google

Click **Sign in** to authorize the app. It requests only the `drive.appdata` scope: access to a hidden app-specific folder that no one else can see. No access to your files, sheets, or any other Drive content.

### 2. Add your accounts

Go to **Settings** and add your investment accounts (e.g. "Trade Republic", "Interactive Brokers"). For each account, add the holdings (ETFs/funds) you track. This defines the structure of your portfolio.

Accounts can optionally be marked as **locked** (e.g. pension or AVD accounts) with an expected accessibility year. Locked accounts are included in total net worth but shown separately as "Liquid" (accessible now) and "Locked" (retirement) net worth KPIs. Locked accounts are excluded from goal progress calculations and from the accumulation forecast — they only become available in the retirement projection from their unlock year onward.

You can also configure extra contributions (employer match, state subsidies) that factor into DCA forecast projections. The **global monthly contribution budget** is routed to your primary investment account. To split contributions across multiple accounts, configure per-account contribution amounts in the account settings for each additional account.

Each holding can be given a **target allocation percentage** (set in the holding dialog). Once at least one target is configured, the Portfolio tab's drift table compares your actual allocation against those targets and the rebalance plan suggests top-up amounts based on your **calibration interval** (weekly / monthly / quarterly).

### 3. Log your first monthly snapshot

Go to the **+ Log** tab. Enter the current value for each account, then hit **Save snapshot**. This records your net worth for the month.

Once these three steps are done, the setup banner transitions to a **"Recommended next steps"** prompt with two optional-but-important actions:

- **Import transactions** — imports your broker CSV to unlock cost-basis tracking, realized P&L, and dividend analytics (Portfolio and Dividends tabs)
- **Configure holdings** — adds ETF/fund definitions to your investment account in Settings, enabling the Portfolio drift view. For each holding you can set the **TER** (total expense ratio in %) to see annual cost estimates, and a **target allocation %** to power the drift table and rebalance plan. The **cost-basis method** (average cost, FIFO, LIFO, or HIFO) is configured globally in Settings.

The banner disappears automatically once both are completed, or you can dismiss it manually at any time.

### Monthly workflow

1. Open the app on any device
2. Go to the **+ Log** tab
3. Enter account balances (~2 min)
4. For investment accounts, optionally expand **ETF breakdown** to record the current market value of each ETF position (see below)
5. Hit **Save snapshot** (saved immediately; synced to Drive within seconds when online)
6. Re-import your broker CSV whenever you want updated cost-basis or dividend data

#### Per-ETF market values in snapshots

When recording a snapshot for your primary investment account, you can expand the **ETF breakdown** section to enter the current market value of each individual ETF position.

This is optional, but enables two additional features:

- **Drift table**: uses actual market values instead of cost basis, giving a more accurate picture of your current allocation vs. target allocation.
- **Holdings detail panel**: shows a "Market value" and "Unrealized gain" column for each position when ETF values are available for the latest snapshot.

**How to use it**

1. Enter the account total in the main balance field as usual.
2. Click **ETF breakdown** to expand the section.
3. Enter the current market value for each ETF (visible in your broker app, e.g. Trade Republic's Vermogensübersicht).
4. The reconciliation bar at the bottom shows **Allocated** (sum of ETF values entered) and **Remaining** (account total minus allocated), helping you catch typos before saving.
   - Remaining turns amber if you have over-allocated (sum exceeds total).
   - Remaining stays green when ETF values are at or below the account total (the difference is unallocated cash).

**Storage format**

Per-ETF market values are stored in the snapshot record as `etf_<ISIN>` keys alongside the regular account balance keys (e.g. `etf_IE00B4L5Y983: 12500`). No separate database migration is needed; missing keys are treated as "no data".

**Inactive but held positions**

ETFs that you have stopped contributing to but still hold are listed under "Held, not contributing" in the breakdown section. They should still be included when recording values, as they remain part of your total portfolio allocation. The drift table will show these with a 0% target, reflecting that they are being wound down over time.

### Importing transactions

For detailed cost-basis, realized P&L, and dividend tracking, import your broker's CSV export:

1. Go to **+ Log** > **Import CSV**
2. Select or drag your broker CSV (Trade Republic full transaction history, and N26 savings account CSV, are supported built-in — [adding more banks](#adding-support-for-a-new-bank) takes ~10 minutes)
3. Review the detected transactions and confirm

After import, transactions appear in the **transaction ledger** at the bottom of the **+ Log** tab, where you can review, filter, and delete individual records.

Transactions are merged with existing data using an append-only strategy: new rows are inserted, but rows that already exist (matched by date + type + amount) are not overwritten. This means re-importing an updated CSV is safe — it will add genuinely new transactions — but amended or corrected rows from your broker will not replace what is already stored. The import preview will warn you if the file contains rows that differ from existing records.

Income analytics on the Analytics tab are anchored to your latest imported transaction month, so
trailing-12-month income and income growth do not drift just because calendar time passed. Dividend
yield is calculated against the current value of investment accounts, not total household net worth.

Tax amounts in the app are **aggregated informational context** from imported transactions
(withholding + refunds), meant to help you understand personal cashflow history across providers.
They are **not** jurisdiction-aware tax reporting or tax filing guidance, and if your tax residence
changes over time those figures may become incomplete or no longer map cleanly to your local tax
rules.

### Portfolio tab

The Portfolio tab has three subviews:

- **Holdings** — your ETF positions with cost basis, unrealized gain, market value (when snapshot ETF values are recorded), and the drift table.
- **Contributions** — month-by-month DCA history and contribution split across holdings.
- **Dividends** — dividend and interest income history, yield, and growth metrics.

### Analytics tab

The Analytics tab surfaces two layers of metrics:

**Level 1 — Balance KPIs** (net worth change, no cash-flow adjustment): Total Return, Net Worth Gain, Investment Gain, YTD Return, CAGR. These include the effect of deposits and withdrawals.

**Level 2 — Investment performance KPIs** (cash-flow adjusted): TWR (Time-Weighted Return) and IRR (Internal Rate of Return). These isolate market performance by neutralizing deposits and withdrawals, so they reflect your investment skill rather than your savings rate. Both require at least a few months of history and improve in accuracy with longer data.

**Risk metrics**: Volatility, Max Drawdown, Sharpe, Sortino, and Calmar ratios. All are computed from investment-account-only monthly returns. They are gated behind a 24-month minimum history requirement to avoid statistically meaningless early values.

The risk-free rate used for Sharpe and Sortino is configurable in Settings (default 2%).

### Goals

Named savings goals can be configured in **Settings > Goals**. Each goal has a target net worth amount and an optional target date. Goal progress cards appear on the **Net Worth** tab and show how much of your _liquid_ net worth (excluding locked pension/retirement accounts) has been accumulated toward each goal.

### Retirement planning

The **Net Worth** tab includes a **Drawdown** forecast alongside the standard accumulation projection. Configure a retirement date and select a withdrawal strategy:

- **Fixed amount** — withdraw a fixed €/month (nominal, not inflation-adjusted)
- **4% rule (SWR)** — withdraw 4% of the starting retirement balance per year, indexed annually for inflation
- **% of portfolio** — withdraw a fixed percentage of the current balance each month

The chart shows your projected portfolio balance through the drawdown period. If the balance reaches zero, the depletion date is displayed. **Note:** All withdrawal amounts shown are pre-tax. Actual spendable income will be lower depending on your jurisdiction and account type. Projections use a fixed expected return and do not model sequence-of-returns risk.

### Theme

The **theme button** in the top navigation bar cycles between Light, Dark, and System (follows your OS preference). The choice is saved locally and applied on each page load.

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
`docs/sqljs-wasm.md`.

---

## Adding support for a new bank

Trade Republic (full transaction history) and N26 savings account CSV are supported today. N26 does not export investment transactions; for investment data from N26 you would need a custom profile or manual entry. The import engine is bank-agnostic, so adding another bank does **not** require touching the parser.

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
- `VITE_GOOGLE_CLIENT_ID` is visible in the built JavaScript. This is intentional: OAuth Client IDs are public by design and grant zero access alone.
- Separate OAuth apps for dev/prod means separate Drive AppData folders. Data can never cross environments.
- A Content-Security-Policy is enforced via headers (see `netlify.toml`), restricting script execution and outbound connections.
- This is a single-user, single-deployment design. One site serves one person.

---

## Data portability

### In-app backup and restore

Settings > **Backup & restore** provides:

- **Export backup** downloads a single JSON file with everything (accounts, holdings, settings, snapshots, transactions, import metadata)
- **Restore from file** reads that JSON back and replaces the local database entirely (asks for confirmation)
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
