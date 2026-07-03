# Wealth Tracker

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
cd finance-dashboard
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

---

## Adding support for a new bank

Only Trade Republic is supported today, but the import engine is bank-agnostic.
Adding a second bank does **not** require touching the parser — you add one
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
4. **Add a test** in `src/import/parse.test.ts` — see the existing
   `fakeBankProfile` fixture for the pattern (a minimal profile + a
   handful of CSV rows asserted against expected canonical output).

An interactive column-mapper (build a profile from the UI instead of hand-
writing one) isn't built yet, but `buildProfileFromMapping()` in
`src/import/profile.ts` already produces the same `ImportProfile` shape —
it's the extension point a future mapper UI would call into.

---

## Netlify deployment

### Environment variables

In Netlify: **Site settings → Environment variables → Add variable**

| Key                     | Value                |
| ----------------------- | -------------------- |
| `VITE_GOOGLE_CLIENT_ID` | Your OAuth Client ID |
| `VITE_GOOGLE_SHEET_ID`  | Your Google Sheet ID |

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

## Data portability

All data lives in **your Google Sheet**. To migrate away:

- Export the sheet as CSV/Excel at any time
- The app has no vendor lock-in beyond Google Drive

---

## Monthly workflow

1. Open the app on any device
2. Go to **＋ Log** tab
3. Enter account balances (takes ~2 min)
4. Hit **Save snapshot** (synced instantly to Google Sheets)
5. Re-import TR CSV whenever you want updated cost basis / dividend data

---

## Adding to Android home screen

1. Open the app in Chrome on Android
2. Tap the three-dot menu → **Add to Home screen**
3. The app installs as a PWA (works offline for viewing, syncs when online)
