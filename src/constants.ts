/** Config-store accessors with static-config fallback (before loadConfig() completes). */

import { CONFIG } from './config';
import type { StaticHolding, StaticAccount } from './config';
import { isConfigLoaded, getACCTS, getISINMap, getMETA, getISIN_ORDER } from './store/config';

const holdings: StaticHolding[] = CONFIG.holdings;
const accounts: StaticAccount[] = CONFIG.accounts;

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
  return Object.fromEntries(holdings.map((h) => [h.isin, h.ticker]));
}

// ticker → { color, acc, active }
export function getMETAMap(): Record<string, HoldingMeta> {
  if (isConfigLoaded()) return getMETA();
  return Object.fromEntries(
    holdings.map((h) => [h.ticker, { color: h.color, acc: h.acc, active: h.active }]),
  );
}

// ISINs in display order
export function getISIN_ORDERList(): string[] {
  if (isConfigLoaded()) return getISIN_ORDER();
  return holdings.map((h) => h.isin);
}

// Snapshot accounts (key / label / color)
export function getACCTSList(): AccountEntry[] {
  if (isConfigLoaded()) return getACCTS();
  return accounts.map((a) => ({ key: a.key, label: a.label, color: a.color }));
}
