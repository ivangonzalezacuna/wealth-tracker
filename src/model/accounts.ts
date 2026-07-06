import type { Account, Snapshot } from '../types';

/** Returns an error string if the primary-investment flagging is invalid, else null. */
export function validatePrimaryInvestment(accounts: Account[]): string | null {
  const primary = accounts.filter((a) => a.isPrimaryInvestment);
  if (primary.length > 1) {
    return 'Only one account can be the primary investment account.';
  }
  const bad = primary.find((a) => (a.moneyType || '').toLowerCase() !== 'investment');
  if (bad) {
    return `"${bad.label || bad.id}" is marked primary investment but its type is not "investment".`;
  }
  return null;
}

/** Returns an error string if any account has an out-of-range annualReturnPct, else null. */
export function validateAccountRanges(accounts: Account[]): string | null {
  for (const a of accounts) {
    const pct = a.annualReturnPct ?? 0;
    // Below -100% breaks the math: fractional exponent of a negative number is NaN.
    // Above 1000% is almost certainly a typo (10× annual return is already extreme).
    if (pct < -100 || pct > 1000) {
      return `"${a.label || a.id}": annual return must be between −100% and 1000%.`;
    }
  }
  return null;
}

/** Current market value of the primary investment account(s) from a snapshot. */
export function primaryInvestmentValue(snap: Snapshot | null, accounts: Account[]): number | null {
  if (!snap) return null;
  const primary = accounts.filter((a) => a.isPrimaryInvestment);
  if (!primary.length) return null;

  // Reloaded snapshots are keyed by the lowercased sheet header
  // (parseSnapshotRows). Build a case-insensitive numeric view so id
  // casing never silently breaks the lookup.
  const byLowerKey: Record<string, number> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (typeof v === 'number') byLowerKey[k.toLowerCase()] = v;
  }

  let found = false;
  let sum = 0;
  for (const a of primary) {
    const key = (a.id || '').toLowerCase();
    if (key in byLowerKey) {
      found = true;
      sum += byLowerKey[key];
    }
  }
  return found ? sum : null;
}
