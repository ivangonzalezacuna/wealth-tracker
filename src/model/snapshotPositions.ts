import type { Account, Snapshot } from '../types';
import { isValidISIN, normalizeISIN } from './isin';
import { isAccountClosedInMonth } from './accounts';

export const ETF_VALUATION_SCHEMA = 'account-v1';
export const POSITION_TOLERANCE = 0.005;

export function positionKey(accountId: string, isin: string): string {
  if (!/^[a-z0-9_]{1,30}$/.test(accountId) || !isValidISIN(normalizeISIN(isin)))
    throw new Error('ETF valuations require a valid account ID and ISIN.');
  return `position:${accountId}:${normalizeISIN(isin)}`;
}

export function parsePositionKey(key: string): { accountId: string; isin: string } | null {
  const match = /^position:([a-z0-9_]{1,30}):([A-Z]{2}[A-Z0-9]{9}[0-9])$/.exec(key);
  return match ? { accountId: match[1], isin: match[2] } : null;
}

export function accountPositionValues(
  snap: Snapshot | null,
  accountId: string,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(snap || {})) {
    const parsed = parsePositionKey(key);
    if (parsed?.accountId === accountId && typeof value === 'number' && Number.isFinite(value))
      values[parsed.isin] = value;
  }
  return values;
}

export function aggregatePositionValues(snap: Snapshot | null): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(snap || {})) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    const parsed = parsePositionKey(key);
    const isin = parsed?.isin;
    if (!isin) continue;
    values[isin] = (values[isin] || 0) + value;
  }
  return values;
}

export function validateSnapshotPositions(snap: Snapshot, accounts: Account[]): string | null {
  const totals = new Map<string, number>();
  for (const [key, value] of Object.entries(snap)) {
    if (key.startsWith('etf_') && !accounts.some((a) => a.id === key || a.key === key)) {
      return `${snap.date}: legacy ETF valuations are no longer supported. Use an account-linked backup exported after migration in the previous release.`;
    }
    if (!key.startsWith('position:')) continue;
    const parsed = parsePositionKey(key);
    if (!parsed) return `${snap.date}: invalid ETF valuation key "${key}".`;
    const account = accounts.find((a) => (a.id || a.key) === parsed.accountId);
    if (!account || account.moneyType?.toLowerCase() !== 'investment')
      return `${snap.date}: ETF valuation refers to an unknown investment account "${parsed.accountId}".`;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      return `${snap.date}: ETF values must be finite and non-negative (${account.label}, ${parsed.isin}).`;
    if (value !== 0 && isAccountClosedInMonth(account, snap.date))
      return `${snap.date}: ${account.label} is closed; its ETF values must be zero.`;
    totals.set(parsed.accountId, (totals.get(parsed.accountId) || 0) + value);
  }
  for (const [id, total] of totals) {
    const account = accounts.find((a) => (a.id || a.key) === id)!;
    const entries = Object.entries(snap).filter(
      ([key]) =>
        key.toLowerCase() === id.toLowerCase() || key.toLowerCase() === account.key?.toLowerCase(),
    );
    const balance = entries.find(([, value]) => typeof value === 'number')?.[1];
    if (
      typeof balance !== 'number' ||
      !Number.isFinite(balance) ||
      total - balance > POSITION_TOLERANCE
    )
      return `${snap.date}: ETF values for ${account.label} exceed or lack its recorded account balance.`;
  }
  return null;
}
