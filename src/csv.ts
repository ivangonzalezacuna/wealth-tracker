/** Thin wrapper around the generic import engine; keeps `parseCSV()`/`parseNum()` as stable exports. */

import { parseWithProfile, detectProfile } from './import/parse';
import { tradeRepublicProfile } from './import/profiles/trade_republic';
import { parseNumber } from './import/parse';
import type { Transaction } from './types';

/** Normalize a numeric string: handle German 1.234,56 format -> 1234.56. */
export function parseNum(s: string | null | undefined): number {
  return parseNumber(s, 'auto');
}

/**
 * Parse a CSV string into transaction objects, auto-detecting the source
 * profile from the header. Falls back to Trade Republic if no profile
 * matches, since it's the only broker in active use.
 */
export function parseCSV(text: string): Transaction[] {
  const headerLine = text.trim().split('\n')[0] || '';
  const profile = detectProfile(headerLine) || tradeRepublicProfile;
  const { transactions } = parseWithProfile(text, profile);
  return transactions;
}
