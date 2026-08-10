import type { Account, Snapshot } from '../types';

const ACCOUNT_ID_RE = /^[a-z0-9_]{1,30}$/;
const RESERVED_ETF_PREFIX = 'etf_';

export function validateAccountIds(accounts: Account[]): string | null {
  const seen = new Set<string>();
  for (const a of accounts) {
    const id = (a.id || '').trim();
    if (!id) return `"${a.label || 'Account'}" has an empty ID.`;
    if (!ACCOUNT_ID_RE.test(id)) {
      return `"${a.label || id}" has invalid ID "${id}". Use lowercase letters, numbers, and underscores (max 30).`;
    }
    if (id.startsWith(RESERVED_ETF_PREFIX)) {
      return `"${a.label || id}" has invalid ID "${id}". Prefix "etf_" is reserved for snapshot ETF values.`;
    }
    if (seen.has(id)) {
      return `Duplicate account ID "${id}". Account IDs must be unique.`;
    }
    seen.add(id);
  }
  return null;
}

/** Returns an error string if any account label contains no alphanumeric characters, else null. */
export function validateAccountLabels(accounts: Account[]): string | null {
  const seen = new Map<string, string>();
  for (const a of accounts) {
    const label = (a.label || '').trim();
    if (label && !/[a-zA-Z0-9]/.test(label)) {
      return `"${label}" is not a valid account name. Names must contain at least one letter or digit.`;
    }
    const normalized = normalizeAccountLabel(label);
    if (!normalized) continue;
    if (seen.has(normalized)) {
      return `Duplicate account name "${label}". Account names must be unique.`;
    }
    seen.set(normalized, label);
  }
  return null;
}

export function normalizeAccountLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

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
    // No upper cap; high returns are valid and the isFinite guard in forecast.ts handles edge cases.
    if (pct < -100) {
      return `"${a.label || a.id}": annual return cannot be below −100%.`;
    }
    const taxDragPct = a.annualTaxDragPct ?? 0;
    if (taxDragPct < 0 || taxDragPct > 100) {
      return `"${a.label || a.id}": annual tax drag must be between 0% and 100%.`;
    }
    const annualWithdrawal = a.annualWithdrawal ?? 0;
    if (annualWithdrawal < 0) {
      return `"${a.label || a.id}": annual withdrawal cannot be negative.`;
    }
    const drawdownStartMonth = (a.drawdownStartMonth || '').trim();
    if (drawdownStartMonth && !/^\d{4}-\d{2}$/.test(drawdownStartMonth)) {
      return `"${a.label || a.id}": drawdown start month must use YYYY-MM format.`;
    }
  }
  return null;
}

/** Returns the sum of snapshot values for accounts matching the given list (case-insensitive key lookup). */
function sumSnapshotValues(snap: Snapshot, accounts: Account[]): number | null {
  const byLowerKey: Record<string, number> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (typeof v === 'number') byLowerKey[k.toLowerCase()] = v;
  }
  let found = false;
  let sum = 0;
  for (const a of accounts) {
    const key = (a.id || '').toLowerCase();
    if (key in byLowerKey) {
      found = true;
      sum += byLowerKey[key];
    }
  }
  return found ? sum : null;
}

/** Current market value of the primary investment account(s) from a snapshot. */
export function primaryInvestmentValue(snap: Snapshot | null, accounts: Account[]): number | null {
  if (!snap) return null;
  const primary = accounts.filter((a) => a.isPrimaryInvestment);
  if (!primary.length) return null;
  return sumSnapshotValues(snap, primary);
}

/**
 * Current market value of ALL investment-type accounts from a snapshot.
 *
 * Used for the IRR terminal value in multi-account portfolios where the
 * portfolio spans more than one investment account. Returns null when no
 * investment account has a recorded value in the snapshot.
 */
export function allInvestmentAccountsValue(
  snap: Snapshot | null,
  accounts: Account[],
): number | null {
  if (!snap) return null;
  const investment = accounts.filter((a) => (a.moneyType || '').toLowerCase() === 'investment');
  if (!investment.length) return null;
  return sumSnapshotValues(snap, investment);
}
