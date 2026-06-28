/**
 * Derived constants — now backed by the runtime config store.
 * Before loadConfig() completes, these return values derived from config.js defaults.
 * After loadConfig(), they return live data from the sheet.
 *
 * Modules that import ISIN / META / ISIN_ORDER / ACCTS get getter-backed objects
 * so they always reflect current config at read time.
 */

import { CONFIG } from './config.js';
import {
  isConfigLoaded, getACCTS, getISINMap, getMETA, getISIN_ORDER,
} from './store/config.js';

// ISIN → ticker (live from store when loaded, else from static config)
export function getISIN() {
  if (isConfigLoaded()) return getISINMap();
  return Object.fromEntries(CONFIG.holdings.map(h => [h.isin, h.ticker]));
}

// ticker → { color, acc, active }
export function getMETAMap() {
  if (isConfigLoaded()) return getMETA();
  return Object.fromEntries(
    CONFIG.holdings.map(h => [h.ticker, { color: h.color, acc: h.acc, active: h.active }]),
  );
}

// ISINs in display order
export function getISIN_ORDERList() {
  if (isConfigLoaded()) return getISIN_ORDER();
  return CONFIG.holdings.map(h => h.isin);
}

// Snapshot accounts (key / label / color)
export function getACCTSList() {
  if (isConfigLoaded()) return getACCTS();
  return CONFIG.accounts.map(a => ({ key: a.key, label: a.label, color: a.color }));
}

// Static references for backward compat (read at call time via getter)
// These are used by snapshots.js and other modules that import at module level.
// They reference the static CONFIG so module-level code (HDR, RANGE) works.
export const ISIN = Object.fromEntries(
  CONFIG.holdings.map(h => [h.isin, h.ticker]),
);
export const META = Object.fromEntries(
  CONFIG.holdings.map(h => [h.ticker, { color: h.color, acc: h.acc, active: h.active }]),
);
export const ISIN_ORDER = CONFIG.holdings.map(h => h.isin);
export const ACCTS = CONFIG.accounts.map(a => ({ key: a.key, label: a.label, color: a.color }));

// Google Sheets tab names
export const SHEET_TABS = {
  SNAPSHOTS:    'Snapshots',
  TRANSACTIONS: 'Transactions',
  META_INFO:    'Meta',
};
