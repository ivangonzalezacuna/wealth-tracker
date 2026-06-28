/**
 * Derived constants — backed by the runtime config store.
 * Before loadConfig() completes, getters return values from config.js defaults.
 * After loadConfig(), they return live data from the sheet.
 */

import { CONFIG } from './config';
import {
  isConfigLoaded, getACCTS, getISINMap, getMETA, getISIN_ORDER,
} from './store/config';

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

// Google Sheets tab names
export const SHEET_TABS = {
  SNAPSHOTS:    'Snapshots',
  TRANSACTIONS: 'Transactions',
  META_INFO:    'Meta',
};
