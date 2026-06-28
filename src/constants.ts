/**
 * Derived constants — backed by the runtime config store.
 * Before loadConfig() completes, getters return values from config.js defaults.
 * After loadConfig(), they return live data from the sheet.
 */

import { CONFIG } from './config';
import {
  isConfigLoaded, getACCTS, getISINMap, getMETA, getISIN_ORDER,
} from './store/config';

interface StaticHolding {
  isin: string;
  ticker: string;
  color: string;
  acc: boolean;
  active: boolean;
}

interface StaticAccount {
  key: string;
  label: string;
  color: string;
}

const holdings = CONFIG.holdings as StaticHolding[];
const accounts = CONFIG.accounts as StaticAccount[];

interface HoldingMeta {
  color: string;
  acc: boolean;
  active: boolean;
}

interface AccountEntry {
  key: string;
  label: string;
  color: string;
}

// ISIN → ticker (live from store when loaded, else from static config)
export function getISIN(): Record<string, string> {
  if (isConfigLoaded()) return getISINMap();
  return Object.fromEntries(holdings.map(h => [h.isin, h.ticker]));
}

// ticker → { color, acc, active }
export function getMETAMap(): Record<string, HoldingMeta> {
  if (isConfigLoaded()) return getMETA();
  return Object.fromEntries(
    holdings.map(h => [h.ticker, { color: h.color, acc: h.acc, active: h.active }]),
  );
}

// ISINs in display order
export function getISIN_ORDERList(): string[] {
  if (isConfigLoaded()) return getISIN_ORDER();
  return holdings.map(h => h.isin);
}

// Snapshot accounts (key / label / color)
export function getACCTSList(): AccountEntry[] {
  if (isConfigLoaded()) return getACCTS();
  return accounts.map(a => ({ key: a.key, label: a.label, color: a.color }));
}

// Google Sheets tab names
export const SHEET_TABS = {
  SNAPSHOTS:    'Snapshots',
  TRANSACTIONS: 'Transactions',
  META_INFO:    'Meta',
} as const;
