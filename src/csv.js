/**
 * Legacy CSV parser — thin wrapper around the generic import engine.
 * Keeps `parseCSV()` and `parseNum()` exports for backward compatibility.
 */

import { parseWithProfile } from './import/parse.js';
import { tradeRepublicProfile } from './import/profiles/trade_republic.js';
import { parseNumber } from './import/parse.js';

/** Normalize a numeric string: handle German 1.234,56 format → 1234.56
 *  Re-exported for backward compat (used by sheets/transactions.js). */
export function parseNum(s) {
  return parseNumber(s, 'auto');
}

/** Parse a TR Transaktionsexport CSV string into transaction objects.
 *  Delegates to the generic engine with the Trade Republic profile. */
export function parseCSV(text) {
  const { transactions } = parseWithProfile(text, tradeRepublicProfile);
  return transactions;
}
