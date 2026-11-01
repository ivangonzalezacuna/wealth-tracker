import type { Account, Snapshot } from '../types';

const ACCOUNT_ID_RE = /^[a-z0-9_]{1,30}$/;
const RESERVED_ETF_PREFIX = 'etf_';

export function accountMonth(value: string): string | null {
  const month = value.slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) &&
    (value.length === 7 || /^\d{4}-\d{2}-\d{2}$/.test(value))
    ? month
    : null;
}

export function isAccountClosedInMonth(account: Account, month: string): boolean {
  const normalized = accountMonth(month);
  if (!normalized) throw new Error(`Invalid account month "${month}".`);
  return (account.closedPeriods || []).some(
    (period) =>
      normalized >= period.closedFromMonth &&
      (!period.reopenedFromMonth || normalized < period.reopenedFromMonth),
  );
}

export function isAccountOpenNow(account: Account): boolean {
  const now = new Date();
  return !isAccountClosedInMonth(
    account,
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
}

export function validateClosedPeriods(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return 'Closed periods must be a list.';
  let previousEnd = '';
  for (const [index, period] of value.entries()) {
    if (!period || typeof period !== 'object') return 'Invalid closed period.';
    const { closedFromMonth: start, reopenedFromMonth: end } = period;
    if (typeof start !== 'string' || start.length !== 7 || !accountMonth(start))
      return 'Closure requires a valid YYYY-MM month.';
    if (
      end !== undefined &&
      (typeof end !== 'string' || end.length !== 7 || !accountMonth(end) || end <= start)
    )
      return 'Reopening must be a valid month after closure.';
    if (index && (!previousEnd || start <= previousEnd))
      return 'Closed periods must be ordered, separated and non-overlapping.';
    previousEnd = end || '';
  }
  return null;
}

export function validateAccountLifecycle(
  accounts: Account[],
  snapshots: Snapshot[],
): string | null {
  for (const account of accounts) {
    const malformed = validateClosedPeriods(account.closedPeriods);
    if (malformed) return `${account.label}: ${malformed}`;
    const aliases = new Set(
      [account.id, account.key].filter(Boolean).map((id) => id!.toLowerCase()),
    );
    const values = (snap: Snapshot) =>
      Object.entries(snap).filter(([key]) => aliases.has(key.toLowerCase()));
    for (const period of account.closedPeriods || []) {
      const boundary = snapshots.filter(
        (snap) => accountMonth(snap.date) === period.closedFromMonth,
      );
      if (
        !boundary.length ||
        !boundary.some((snap) =>
          values(snap).some(([, value]) => typeof value === 'number' && value === 0),
        )
      )
        return `${account.label}: save an explicit zero balance for ${period.closedFromMonth} before closing.`;
    }
    for (const snap of snapshots) {
      if (!(account.closedPeriods || []).length) continue;
      if (!accountMonth(snap.date)) return `Invalid snapshot month "${snap.date}".`;
      if (!isAccountClosedInMonth(account, snap.date)) continue;
      for (const [, value] of values(snap)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value !== 0)
          return `${account.label}: ${snap.date} has a nonzero or invalid balance in a closed period.`;
      }
      for (const [key, value] of Object.entries(snap)) {
        const parts = key.split(':');
        if (
          parts[0] === 'position' &&
          aliases.has((parts[1] || '').toLowerCase()) &&
          (typeof value !== 'number' || !Number.isFinite(value) || value !== 0)
        )
          return `${account.label}: ${snap.date} still has a nonzero ETF valuation (${parts[2]}).`;
      }
    }
    if (
      !isAccountOpenNow(account) &&
      (account.isPrimaryInvestment ||
        (account.contribAmount || 0) !== 0 ||
        (account.extraContrib || 0) !== 0)
    )
      return `${account.label}: closed accounts cannot receive planned contributions or be primary.`;
  }
  return null;
}

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
