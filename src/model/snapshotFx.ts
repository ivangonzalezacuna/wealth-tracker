/**
 * Snapshot FX normalization — converts non-EUR account balances to the
 * reporting currency (EUR) at the month-end rate for the snapshot month.
 *
 * This is the Phase 3 domain wiring that bridges account currency data
 * with the FX service layer. The logic is kept in its own module so it can
 * be unit-tested without importing the full main.ts side-effect tree.
 */

import type { Snapshot, Account } from '../types';
import { resolveMonthEndRate, APP_CURRENCY } from '../fx';

export interface SnapshotFxNormalizationOptions {
  onRateUnavailable?: (currency: string) => void;
}

/**
 * Apply Frankfurter FX normalization to all snapshot balances.
 *
 * For each account key in the snapshot whose account denomination currency
 * differs from APP_CURRENCY (EUR), this function fetches the month-end rate
 * and multiplies the stored balance so that all values reaching the database
 * are in EUR.
 *
 * Graceful degradation: when the FX service is disabled, offline, or returns
 * an error for a particular pair, the original (unconverted) balance is kept
 * so existing offline-first behavior is fully preserved.
 *
 * EUR-only portfolios (no account with a non-EUR currency) skip all async
 * work and return the snapshot unchanged.
 */
export async function applySnapshotFxNormalization(
  snap: Snapshot,
  accounts: Account[],
  previousCanonical?: Snapshot,
  opts?: SnapshotFxNormalizationOptions,
): Promise<Snapshot> {
  const nonEurPairs = new Map<string, string>();
  for (const acct of accounts) {
    const key = acct.id || acct.key || '';
    const currency = (acct.currency || APP_CURRENCY).toUpperCase();
    if (key && currency !== APP_CURRENCY) {
      nonEurPairs.set(key, currency);
    }
  }

  if (nonEurPairs.size === 0) return snap;

  const normalized: Snapshot = { ...snap };
  const rateCache = new Map<string, number | null>();

  const getRate = async (currency: string): Promise<number | null> => {
    if (rateCache.has(currency)) return rateCache.get(currency) ?? null;
    const fxRecord = await resolveMonthEndRate(currency, snap.date);
    const rate = fxRecord && fxRecord.rate > 0 ? fxRecord.rate : null;
    rateCache.set(currency, rate);
    return rate;
  };

  for (const [key, currency] of nonEurPairs) {
    const rawBalance = snap[key];
    if (typeof rawBalance !== 'number' || !isFinite(rawBalance)) continue;
    if (previousCanonical && rawBalance === previousCanonical[key]) continue;

    const rate = await getRate(currency);
    if (rate === null) {
      opts?.onRateUnavailable?.(currency);
      continue; // provider unavailable or disabled — keep raw value
    }
    normalized[key] = rawBalance * rate;
  }

  const etfCurrency = inferEtfSnapshotCurrency(accounts);
  if (!etfCurrency) return normalized;

  const etfRate = await getRate(etfCurrency);
  if (etfRate === null) {
    opts?.onRateUnavailable?.(etfCurrency);
    return normalized;
  }

  for (const [key, value] of Object.entries(snap)) {
    if (!key.startsWith('etf_') || typeof value !== 'number' || !isFinite(value)) continue;
    if (previousCanonical && value === previousCanonical[key]) continue;
    normalized[key] = value * etfRate;
  }

  return normalized;
}

/**
 * Prepare a stored (canonical EUR) snapshot for editing by converting account
 * and ETF values back to the user-entered account currency when possible.
 *
 * Graceful degradation: if a rate is unavailable, the canonical value is kept
 * unchanged so users can still edit and save.
 */
export async function prepareSnapshotFxEditDraft(
  snap: Snapshot,
  accounts: Account[],
): Promise<Snapshot> {
  const nonEurPairs = new Map<string, string>();
  for (const acct of accounts) {
    const key = acct.id || acct.key || '';
    const currency = (acct.currency || APP_CURRENCY).toUpperCase();
    if (key && currency !== APP_CURRENCY) nonEurPairs.set(key, currency);
  }
  if (nonEurPairs.size === 0) return snap;

  const draft: Snapshot = { ...snap };
  const rateCache = new Map<string, number | null>();

  const getRate = async (currency: string): Promise<number | null> => {
    if (rateCache.has(currency)) return rateCache.get(currency) ?? null;
    const fxRecord = await resolveMonthEndRate(currency, snap.date);
    const rate = fxRecord && fxRecord.rate > 0 ? fxRecord.rate : null;
    rateCache.set(currency, rate);
    return rate;
  };

  for (const [key, currency] of nonEurPairs) {
    const canonical = snap[key];
    if (typeof canonical !== 'number' || !isFinite(canonical)) continue;
    const rate = await getRate(currency);
    if (rate === null) continue;
    draft[key] = canonical / rate;
  }

  const etfCurrency = inferEtfSnapshotCurrency(accounts);
  if (!etfCurrency) return draft;

  const etfRate = await getRate(etfCurrency);
  if (etfRate === null) return draft;
  for (const [key, value] of Object.entries(snap)) {
    if (!key.startsWith('etf_') || typeof value !== 'number' || !isFinite(value)) continue;
    draft[key] = value / etfRate;
  }
  return draft;
}

function inferEtfSnapshotCurrency(accounts: Account[]): string | null {
  const currencies = new Set(
    accounts
      .filter(
        (acct) => acct.isPrimaryInvestment && (acct.moneyType || '').toLowerCase() === 'investment',
      )
      .map((acct) => (acct.currency || APP_CURRENCY).toUpperCase())
      .filter((cur) => cur !== APP_CURRENCY),
  );
  if (currencies.size !== 1) return null;
  return currencies.values().next().value ?? null;
}
