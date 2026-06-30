# Finance Dashboard

Personal ETF portfolio and net worth tracker — PWA, synced to Google Sheets.

## Stack

- **Vite** — build tool
- **Vanilla JS** — no framework
- **Chart.js** — charts
- **Google Sheets API** — database (your own sheet, your own data)
- **Google OAuth2** — authentication
- **Netlify** — hosting

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

Open `http://localhost:5173` — sign in with Google and you're ready.

### 4. Google Sheet structure

On first sign-in the app will automatically create three tabs in your sheet:

- **Snapshots** — one row per monthly net worth entry
- **Transactions** — imported TR CSV data
- **Meta** — import metadata

You can inspect, back up, or export from the sheet directly at any time.

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

### Google OAuth — add Netlify origin

In Google Cloud Console → Credentials → your OAuth Client ID → **Authorized JavaScript origins** — add your Netlify URL:

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
4. Hit **Save snapshot** — synced instantly to Google Sheets
5. Re-import TR CSV whenever you want updated cost basis / dividend data

---

## Adding to Android home screen

1. Open the app in Chrome on Android
2. Tap the three-dot menu → **Add to Home screen**
3. The app installs as a PWA — works offline for viewing, syncs when online
