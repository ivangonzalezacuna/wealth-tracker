/**
 * ─────────────────────────────────────────────────────────────
 *  STATIC DEFAULTS — used before the config store loads from Google Sheets.
 * ─────────────────────────────────────────────────────────────
 *  On first sign-in, the config store seeds its sheet tabs from these values.
 *  After that, all data lives in the Accounts / Holdings / Settings sheets
 *  and is managed via the Settings UI tab.
 *
 *  You can add example accounts/holdings here for initial setup, or leave
 *  them empty and configure everything through the Settings UI after sign-in.
 */

export const CONFIG = {
  // ── App header ─────────────────────────────────────────────
  app: {
    title:    'Finance Dashboard',
    subtitle: 'ETF portfolio · Net worth tracker',
  },

  // ── Accounts tracked in each monthly snapshot ──────────────
  //  key   — stable id; column name in the Snapshots sheet.
  //  label — shown in the UI and charts.
  //  color — chart colour.
  //  form  — how the input renders on the Log tab.
  accounts: [
    // Example:
    // { key: 'broker_etf', label: 'Broker ETF', color: '#2a78d6',
    //   form: { label: 'Broker ETF portfolio (€)', placeholder: 'total value' } },
    // { key: 'savings', label: 'Savings', color: '#1baf7a',
    //   form: { label: 'Savings account (€)', placeholder: 'balance' } },
  ],

  // ── Holdings: map each ISIN to display metadata ────────────
  //  Order here = display order across the whole app.
  //  acc    — accumulating (true) vs distributing (false)
  //  active — receiving new contributions (true) vs closed (false)
  holdings: [
    // Example:
    // { isin: 'IE00B4L5Y983', ticker: 'IWDA', color: '#2a78d6', acc: true, active: true },
  ],

  // ── Target allocation (used by first-run migration only) ───
  targetAllocation: {
    slices: [],
  },

  // ── Closed positions (migrated to Holdings foldInto field) ─
  closedPositions: {
    rows: [],
  },

  // ── Reinvestment rules (migrated to Settings key-value) ────
  reinvestmentRules: {
    rows: [],
  },

  // ── 5-year projection assumptions ─────────────────────────
  projection: {
    annualReturnPct: 7,
    weeklyTarget:    200,
  },
};
