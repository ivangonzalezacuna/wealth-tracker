/**
 * ─────────────────────────────────────────────────────────────
 *  STATIC DEFAULTS - used before the config store loads from Google Sheets.
 * ─────────────────────────────────────────────────────────────
 *  On first sign-in, the config store seeds its sheet tabs from these values.
 *  After that, all data lives in the Accounts / Holdings / Settings sheets
 *  and is managed via the Settings UI tab.
 *
 *  You can add example accounts/holdings here for initial setup, or leave
 *  them empty and configure everything through the Settings UI after sign-in.
 */

import type { ContribInterval } from './types';

export interface StaticAccountForm {
  label: string;
  placeholder: string;
}

export interface StaticAccount {
  key: string;
  label: string;
  color: string;
  form: StaticAccountForm;
}

export interface StaticHolding {
  isin: string;
  ticker: string;
  color: string;
  acc: boolean;
  active: boolean;
  contribAmount?: number;
  interval?: ContribInterval;
  assetClass?: string;
  region?: string;
  foldInto?: string;
}

export interface TargetSlice {
  isin?: string;
  ticker?: string;
  pct: number;
}

export interface AppConfig {
  app: { title: string; subtitle: string };
  accounts: StaticAccount[];
  holdings: StaticHolding[];
  targetAllocation: { slices: TargetSlice[] };
  closedPositions: { rows: { from: string; to: string }[] };
  reinvestmentRules: { rows: { label: string; value: string }[] };
  projection: { annualReturnPct: number; weeklyTarget: number };
}

export const CONFIG: AppConfig = {
  // ── App header ─────────────────────────────────────────────
  app: {
    title: 'New Name',
    subtitle: 'ETF portfolio · Net worth tracker',
  },

  // ── Accounts tracked in each monthly snapshot ──────────────
  //  key   - stable id; column name in the Snapshots sheet.
  //  label - shown in the UI and charts.
  //  color - chart colour.
  //  form  - how the input renders on the Update tab.
  accounts: [
    // Example:
    // { key: 'broker_etf', label: 'Broker ETF', color: '#2a78d6',
    //   form: { label: 'Broker ETF portfolio (€)', placeholder: 'total value' } },
    // { key: 'savings', label: 'Savings', color: '#1baf7a',
    //   form: { label: 'Savings account (€)', placeholder: 'balance' } },
  ],

  // ── Holdings: map each ISIN to display metadata ────────────
  //  Order here = display order across the whole app.
  //  acc    - accumulating (true) vs distributing (false)
  //  active - receiving new contributions (true) vs closed (false)
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
    weeklyTarget: 200,
  },
};
