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

  for (const [key, currency] of nonEurPairs) {
    const rawBalance = snap[key];
    if (typeof rawBalance !== 'number' || !isFinite(rawBalance)) continue;

    const fxRecord = await resolveMonthEndRate(currency, snap.date);
    if (fxRecord === null) continue; // provider unavailable or disabled — keep raw value
    normalized[key] = rawBalance * fxRecord.rate;
  }

  return normalized;
}
