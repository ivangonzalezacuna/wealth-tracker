/** Stable `parseCSV()`/`parseNum()` exports wrapping the generic import engine. */

import { parseWithProfile, detectProfile } from './import/parse';
import { parseNumber } from './import/parse';
import type { Transaction } from './types';

/** Normalize a numeric string: handle German 1.234,56 format -> 1234.56. */
export function parseNum(s: string | null | undefined): number {
  return parseNumber(s, 'auto');
}

/**
 * Parse a CSV string into transaction objects, auto-detecting the source
 * profile from the header. Throws when no supported profile matches.
 */
export function parseCSV(text: string): Transaction[] {
  const headerLine = text.trim().split('\n')[0] || '';
  const profile = detectProfile(headerLine);
  if (!profile) throw new Error('Unsupported CSV format: no known profile matches the header.');
  const { transactions } = parseWithProfile(text, profile);
  return transactions;
}
