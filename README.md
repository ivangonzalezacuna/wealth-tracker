# Wealth Tracker

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Netlify Status](https://api.netlify.com/api/v1/badges/a53c2ee7-c5fa-406a-a39b-69e0126bb5bb/deploy-status)](https://app.netlify.com/projects/wealth-tracker-app/deploys)
[![CI](https://github.com/ivangonzalezacuna/wealth-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/ivangonzalezacuna/wealth-tracker/actions/workflows/ci.yml)

Personal ETF portfolio and net worth tracker. PWA, synced to Google Sheets.

## Stack

- **Vite** - build tool
- **Vanilla JS** - no framework
- **Chart.js** - charts
- **Google Sheets API** - database (your own sheet, your own data)
- **Google OAuth2** - authentication
- **Netlify** - hosting

## First-time setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd wealth-tracker
yarn install
```

### 2. Local environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_GOOGLE_SHEET_ID=your-google-sheet-id
```

`.env.local` is git-ignored and never committed.

### 3. Run locally

```bash
yarn dev
```

Open `http://localhost:5173`, sign in with Google and you're ready.

### 4. Google Sheet structure

On first sign-in the app will automatically create three tabs in your sheet:

- **Snapshots** - one row per monthly net worth entry
- **Transactions** - imported TR CSV data
- **Meta** - import metadata

You can inspect, back up, or export from the sheet directly at any time.

**A note on deleting Accounts or Holdings:** removing one from Settings only removes it from your configuration, historical data already saved in the Sheet is not affected. The deleted item's column/slot is also never reused by a future Account or Holding, so you may see reserved-but-unlabeled columns in the raw Sheet over time. This is intentional, it guarantees an old Snapshot row is never silently misread as belonging to a different, newer Account.

---

## Development

```bash
yarn lint        # prettier --check .
yarn typecheck   # tsc --noEmit
yarn test        # vitest run
yarn build       # vite build
```

Every push and PR to `main` runs lint → typecheck → test → build automatically via GitHub Actions (`.github/workflows/ci.yml`), in that order, each step gating the next. A separate weekly + PR-triggered dependency audit (`.github/workflows/deploy-check.yml`) surfaces high-severity vulnerabilities as non-blocking warnings. Dependabot opens grouped, weekly dependency-update PRs (`.github/dependabot.yml`).

Run `yarn lint:fix` to auto-format before committing; CI's `yarn lint` only checks, it does not write.

---

## Adding support for a new bank

Only Trade Republic is supported today, but the import engine is bank-agnostic.
Adding a second bank does **not** require touching the parser: you add one
data file and register it.

1. **Create a profile** at `src/import/profiles/<bank>.ts` exporting an
   `ImportProfile` object:
   ```ts
   export const myBankProfile: ImportProfile = {
     id: 'my_bank',
     label: 'My Bank',
     delimiter: 'auto', // or ',' / ';' / '\t'
     decimal: 'auto', // 'dot' | 'comma' | 'auto'
     dateFormat: 'DD.MM.YYYY', // or 'YYYY-MM-DD' / 'DD/MM/YYYY' / 'MM/DD/YYYY'
     defaultCurrency: 'EUR',
     columns: {
       date: 'Datum', // header name OR numeric column index
       type: 'Typ',
       name: 'Bezeichnung',
       amount: 'Betrag',
       // ...map every canonical field the source CSV provides
     },
     typeMap: {
       // source type string -> canonical TxType
       KAUF: TxType.BUY,
       VERKAUF: TxType.SELL,
     },
     match: {
       // header substrings used to auto-detect this profile from the
       // first line of an uploaded CSV
       headerIncludes: ['Datum', 'Typ', 'Betrag'],
     },
   };
   ```
2. **Register it** in `src/import/profiles/index.ts`:
   ```ts
   export const builtInProfiles: ImportProfile[] = [tradeRepublicProfile, myBankProfile];
   ```
3. **Done.** `detectProfile()` picks the new profile automatically from the
   CSV header on next import; `parseWithProfile()` handles parsing with no
   further changes. Rows whose source `type` isn't in `typeMap` are surfaced
   as "unmapped" in the import preview rather than silently dropped.
4. **Add a test** in `src/import/parse.test.ts`, see the existing
   `fakeBankProfile` fixture for the pattern (a minimal profile + a
   handful of CSV rows asserted against expected canonical output).

An interactive column-mapper (build a profile from the UI instead of hand-
writing one) isn't built yet, but `buildProfileFromMapping()` in
`src/import/profile.ts` already produces the same `ImportProfile` shape:
it's the extension point a future mapper UI would call into.

---

## Netlify deployment

### Environment variables

In Netlify: **Site settings → Environment variables → Add variable**

| Key                     | Value                | Notes                                                                                                                               |
| ----------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_GOOGLE_CLIENT_ID` | Your OAuth Client ID | App-level, client-exposed (non-secret, see "Security & trust model" below)                                                          |
| `VITE_GOOGLE_SHEET_ID`  | Your Google Sheet ID | App-level, client-exposed. Build-time constant, see "Design note" below                                                             |
| `NODE_VERSION`          | `24`                 | Netlify build platform setting, already set in `netlify.toml`, listed here for completeness, no action needed unless upgrading Node |

**Design note:** the Sheet ID is a build-time constant (`import.meta.env.VITE_GOOGLE_SHEET_ID`), not a runtime setting. One deployed build talks to exactly one Google Sheet for its entire life, until the env var changes and the site rebuilds. This is intentional: it keeps the app server-less and avoids adding any runtime "which Sheet am I pointed at" state that could be silently wrong.

To use a separate Sheet for testing (branch deploys / PR previews) without touching production data:

1. In Netlify, when adding `VITE_GOOGLE_SHEET_ID`, click **Edit variable** and scope it per deploy context instead of "All".
2. Set the **Production** value to your live Sheet ID.
3. Set the **Deploy Previews** and/or **Branch deploys** value to your test Sheet ID.
4. Every PR preview and branch build now automatically uses the test Sheet; `main`/production automatically uses the live Sheet, with no manual switching and no risk of a forgotten toggle pointing production at test data or vice versa.

Local development still uses `.env.local` (see above), independent of Netlify's context scoping.

### Build settings

Netlify auto-detects from `netlify.toml`:

- Build command: `yarn build`
- Publish directory: `dist`

### Google OAuth: add Netlify origin

In Google Cloud Console → Credentials → your OAuth Client ID → **Authorized JavaScript origins**, add your Netlify URL:

```
https://your-app.netlify.app
```

---

## Security & trust model

This app has no backend and no server-side secrets. Everything that could be called a "trust model" question resolves to: **it's exactly as trusted as your own Google account.**

- **Your data lives only in your own Google Sheet.** The app never sends data anywhere except the Google Sheets API, using your own OAuth grant.
- **The OAuth token is cached in your browser's `localStorage`**, not a server, so the app can restore your session instantly on reload without a repeated consent prompt. Tokens are short-lived (~1 hour) and refreshed silently in the background through your existing Google session. This is the standard pattern for a client-only OAuth app; there is no backend that could hold or leak the token instead.
- **`VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_SHEET_ID` are visible in the built JavaScript.** This is intentional, not an oversight: an OAuth Client ID is meant to be public (Google's own model assumes it's visible to the browser), and a bare Sheet ID grants no access to anyone without your own OAuth token, it's an address, not a key.
- **Outbound writes are sanitized against formula injection.** Any free-text field starting with `=`, `+`, `-`, or `@` is escaped before being written to the Sheet, so a value that ends up in a re-exported CSV can't turn into a live formula when opened in Excel or LibreOffice later.
- **A Content-Security-Policy is enforced at the Netlify edge** (`netlify.toml`), restricting script execution, framing, and outbound connections to exactly the origins this app talks to: Google Identity Services, the Google Sheets API, and Google Fonts. `style-src` allows `'unsafe-inline'` because views template inline styles directly into markup; every other directive (`script-src`, `object-src`, `frame-ancestors`, `connect-src`, `base-uri`, `form-action`) is locked down, which is where the real leverage for exfiltration or remote code execution would come from.
- **This is a single-user, single-deployment design.** One Netlify site talks to exactly one Google Sheet, configured at build time (see "Environment variables" above). It is not built to serve multiple people from one deployment.

---

## Data portability

All data lives in **your Google Sheet**. To migrate away:

- Export the sheet as CSV/Excel at any time
- The app has no vendor lock-in beyond Google Drive

### In-app backup & restore

Separately from exporting the raw Sheet, Settings → **Backup & restore** gives you a one-click safety net:

- **Export backup** downloads a single JSON file containing everything the app persists: Accounts, Holdings, Settings, Snapshots, Transactions, and import metadata.
- **Restore from file…** reads that file back and fully replaces the live Sheet's contents. This is disaster recovery, not routine sync, restoring is all-or-nothing (not a merge) and asks for confirmation first.
- If it's been 30+ days since your last export, the card nudges you to run a fresh one. Takes a few seconds; worth doing before any account/holding restructuring.

---

## Known limitations

- **Multi-leg SELL consolidation (ETF fund mergers) is unverified in production.** When a provider folds one ETF into another (for example iShares merging IEEM into CMEIU, or merging CECBE and EGB7Y into GABE), the cost-basis engine has a code path (`foldInto`) meant to carry the original position's cost basis forward instead of treating it as a full sell-then-rebuy. That path is implemented and unit-tested against synthetic data, but has not yet been exercised against a real consolidation event end to end. If one of your holdings undergoes this kind of provider-side merge, treat the resulting Realized P&L and cost-basis figures as unverified until you've manually cross-checked them against your broker statement.

---

## Monthly workflow

1. Open the app on any device
2. Go to **＋ Log** tab
3. Enter account balances (takes ~2 min)
4. Hit **Save snapshot** (synced instantly to Google Sheets)
5. Re-import TR CSV whenever you want updated cost basis / dividend data

---

## Installing as an app

The app is a PWA, it installs like a native app and works offline for viewing (writes still require a connection). Sign-in and data are shared across every device that points at the same Netlify deployment.

### Android (Chrome)

1. Open the app in Chrome
2. Tap the three-dot menu → **Add to Home screen**

### iOS (Safari)

1. Open the app in Safari
2. Tap the **Share** icon → **Add to Home Screen**

### Desktop (Chrome / Edge)

1. Open the app
2. Click the install icon in the address bar (or the three-dot menu → **Install Wealth Tracker…**)
