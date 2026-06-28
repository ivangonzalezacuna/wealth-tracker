/**
 * Derived constants. These are computed from src/config.js so the rest
 * of the app can keep importing ISIN / META / ISIN_ORDER / ACCTS unchanged.
 * To customise anything here, edit config.js — not this file.
 */

import { CONFIG } from './config.js';

// ISIN → ticker
export const ISIN = Object.fromEntries(
  CONFIG.holdings.map(h => [h.isin, h.ticker]),
);

// ticker → { color, acc, active }
export const META = Object.fromEntries(
  CONFIG.holdings.map(h => [h.ticker, { color: h.color, acc: h.acc, active: h.active }]),
);

// ISINs in display order
export const ISIN_ORDER = CONFIG.holdings.map(h => h.isin);

// Snapshot accounts (key / label / color)
export const ACCTS = CONFIG.accounts.map(a => ({ key: a.key, label: a.label, color: a.color }));

// Google Sheets tab names
export const SHEET_TABS = {
  SNAPSHOTS:    'Snapshots',
  TRANSACTIONS: 'Transactions',
  META_INFO:    'Meta',
};
