/**
 * Snapshot FX normalization converts non-EUR account balances to the
 * reporting currency (EUR) at the month-end rate for the snapshot month.
 *
 * The logic is kept in its own module so it can be unit-tested without
 * importing the full main.ts side-effect tree.
 */

import type { Snapshot, Account } from '../types';
import { resolveMonthEndRate, APP_CURRENCY } from '../fx';
import { recordFxNormalize } from '../services/fxRateService';

export interface SnapshotReviewResult {
  snapshot?: Snapshot;
  error?: string;
  rates?: Record<string, number>;
}

/** Normalize only explicitly entered fields; hidden/retired canonical keys stay untouched. */
export async function normalizeSnapshotReview(
  snap: Snapshot,
  currencies: Record<string, string>,
): Promise<SnapshotReviewResult> {
  const normalized = { ...snap };
  const getRate = makeCachedRateLookup(snap.date);
  const rates: Record<string, number> = {};
  let attempted = 0;
  let resolved = 0;
  let failed = 0;
  try {
    for (const [key, currency] of Object.entries(currencies)) {
      const value = snap[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { error: 'Every entered balance must be a finite number.' };
      }
      if (currency === APP_CURRENCY) continue;
      attempted += 1;
      let rate: number | null;
      try {
        rate = await getRate(currency);
      } catch {
        failed += 1;
        throw new Error('FX unavailable');
      }
      if (rate === null) {
        failed += 1;
        return {
          error: `FX unavailable for ${currency}. Retry Review or choose explicit EUR entry and enter converted values.`,
        };
      }
      resolved += 1;
      rates[currency] = rate;
      const converted = value * rate;
      if (!Number.isFinite(converted)) return { error: 'Converted amount is too large.' };
      normalized[key] = converted;
    }
    return { snapshot: normalized, rates };
  } catch {
    return { error: 'FX rate fetch failed. Retry Review or choose explicit EUR entry.' };
  } finally {
    if (attempted) void recordFxNormalize(attempted, resolved, failed).catch(() => {});
  }
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
 * The cache is local to one review so rates are fetched at
 * most once per currency pair per call site.
 */
function makeCachedRateLookup(yearMonth: string): (currency: string) => Promise<number | null> {
  const rateCache = new Map<string, number | null>();
  return async (currency: string): Promise<number | null> => {
    if (rateCache.has(currency)) return rateCache.get(currency) ?? null;
    const fxRecord = await resolveMonthEndRate(currency, yearMonth);
    const rate =
      fxRecord && Number.isFinite(fxRecord.rate) && fxRecord.rate > 0 ? fxRecord.rate : null;
    rateCache.set(currency, rate);
    return rate;
  };
}
