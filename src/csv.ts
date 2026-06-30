/**
 * Legacy CSV parser — thin wrapper around the generic import engine.
 * Keeps `parseCSV()` and `parseNum()` exports for backward compatibility.
 */

import { parseWithProfile, detectProfile } from './import/parse';
import { tradeRepublicProfile } from './import/profiles/trade_republic';
import { parseNumber } from './import/parse';
import type { Transaction } from './types';

/** Normalize a numeric string: handle German 1.234,56 format -> 1234.56
 *  Re-exported for backward compat (used by sheets/transactions.js). */
export function parseNum(s: string | null | undefined): number {
  return parseNumber(s, 'auto');
}

/**
 * Parse a CSV string into transaction objects, auto-detecting the source
 * profile from the header (any built-in profile, not just Trade Republic).
 * Falls back to the Trade Republic profile only if detection fails, to
 * preserve this function's original behavior for legacy callers that
 * always passed TR-shaped data. Delegates to the generic engine.
 */
export function parseCSV(text: string): Transaction[] {
  const headerLine = text.trim().split('\n')[0] || '';
  const profile = detectProfile(headerLine) || tradeRepublicProfile;
  const { transactions } = parseWithProfile(text, profile);
  return transactions;
}
