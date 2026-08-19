/**
 * Snapshot FX normalization — converts non-EUR account balances to the
 * reporting currency (EUR) at the month-end rate for the snapshot month.
 *
 * The logic is kept in its own module so it can be unit-tested without
 * importing the full main.ts side-effect tree.
 */

import type { Snapshot, Account } from '../types';
import { resolveMonthEndRate, APP_CURRENCY } from '../fx';
import { recordFxNormalize } from '../services/fxRateService';

export interface SnapshotFxNormalizationOptions {
  onRateUnavailable?: (currency: string) => void;
}

/**
 * Returns the distinct non-base currencies used by the given accounts.
 * Useful for callers that need to know which currency pairs will be needed
 * before triggering a normalization or prefetch.
 */
export function getNonBaseCurrencies(accounts: Account[]): string[] {
  return [
    ...new Set(
      accounts
        .map((acct) => (acct.currency || APP_CURRENCY).trim().toUpperCase())
        .filter((cur) => !!cur && cur !== APP_CURRENCY),
    ),
  ];
}

/**
 * Returns a memoized async lookup for month-end rates relative to `yearMonth`.
 * The cache is local to one normalization/draft call so rates are fetched at
 * most once per currency pair per call site.
 */
function makeCachedRateLookup(yearMonth: string): (currency: string) => Promise<number | null> {
  const rateCache = new Map<string, number | null>();
  return async (currency: string): Promise<number | null> => {
    if (rateCache.has(currency)) return rateCache.get(currency) ?? null;
    const fxRecord = await resolveMonthEndRate(currency, yearMonth);
    const rate = fxRecord && fxRecord.rate > 0 ? fxRecord.rate : null;
    rateCache.set(currency, rate);
    return rate;
  };
}

/**
 * Apply FX normalization to all snapshot balances.
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
  const getRate = makeCachedRateLookup(snap.date);

  let normalizeAttempted = 0;
  let normalizeResolved = 0;
  let normalizeFailed = 0;

  // Each unavailable currency is reported at most once even when multiple
  // accounts share the same currency or when the same currency is used for
  // both account balances and ETF values.
  const reportedUnavailable = new Set<string>();
  const reportUnavailable = (currency: string): void => {
    if (!reportedUnavailable.has(currency)) {
      reportedUnavailable.add(currency);
      opts?.onRateUnavailable?.(currency);
    }
  };

  const resolveTracked = async (currency: string): Promise<number | null> => {
    normalizeAttempted += 1;
    const rate = await getRate(currency);
    if (rate !== null) {
      normalizeResolved += 1;
    } else {
      normalizeFailed += 1;
    }
    return rate;
  };

  for (const [key, currency] of nonEurPairs) {
    const rawBalance = snap[key];
    if (typeof rawBalance !== 'number' || !isFinite(rawBalance)) continue;

    const rate = await resolveTracked(currency);
    if (rate === null) {
      reportUnavailable(currency);
      continue; // provider unavailable or disabled — keep raw value
    }
    // previousCanonical holds EUR-canonical values while snap holds
    // native-currency values, so they can never be compared directly.  Compute
    // the EUR-converted value first; if it matches the stored canonical the user
    // didn't change this field, preserving the exact stored bits to avoid
    // floating-point drift from repeated rate roundtrips.
    const convertedBalance = rawBalance * rate;
    normalized[key] =
      previousCanonical && convertedBalance === previousCanonical[key]
        ? (previousCanonical[key] as number)
        : convertedBalance;
  }

  const etfCurrency = inferEtfSnapshotCurrency(accounts);
  if (!etfCurrency) {
    recordFxNormalize(normalizeAttempted, normalizeResolved, normalizeFailed).catch(() => {});
    return normalized;
  }

  // Pre-filter on structural checks (key prefix, type, finiteness,
  // account-key exclusion); the canonical comparison happens inside the loop
  // after conversion, because snap values are in native currency while
  // previousCanonical holds EUR-canonical values.
  const pendingEtfEntries = Object.entries(snap).filter(([key, value]) => {
    if (!key.startsWith('etf_') || typeof value !== 'number' || !isFinite(value)) return false;
    if (nonEurPairs.has(key)) return false; // already handled as an account key
    return true;
  });

  if (pendingEtfEntries.length === 0) {
    recordFxNormalize(normalizeAttempted, normalizeResolved, normalizeFailed).catch(() => {});
    return normalized;
  }

  const etfRate = await resolveTracked(etfCurrency);
  if (etfRate === null) {
    reportUnavailable(etfCurrency);
    recordFxNormalize(normalizeAttempted, normalizeResolved, normalizeFailed).catch(() => {});
    return normalized;
  }

  for (const [key, value] of pendingEtfEntries) {
    const converted = (value as number) * etfRate;
    // Same correctness rule as the account loop: preserve exact canonical bits
    // when the converted value matches the stored canonical (unchanged edit).
    normalized[key] =
      previousCanonical && converted === previousCanonical[key]
        ? (previousCanonical[key] as number)
        : converted;
  }

  recordFxNormalize(normalizeAttempted, normalizeResolved, normalizeFailed).catch(() => {});
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
  const getRate = makeCachedRateLookup(snap.date);

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
    // Skip account keys already de-normalized in the account loop above
    // (account ids that happen to start with "etf_") — re-dividing by the ETF
    // currency rate would produce a wrong result when their currency differs
    // from the ETF currency.
    if (nonEurPairs.has(key)) continue;
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
