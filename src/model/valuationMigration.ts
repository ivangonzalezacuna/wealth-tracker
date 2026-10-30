import type { Account, Snapshot } from '../types';
import { accountMonth } from './accounts';
import { isValidISIN } from './isin';
import {
  coverageKey,
  positionKey,
  POSITION_TOLERANCE,
  validateSnapshotPositions,
} from './snapshotPositions';

export interface LegacyPositionAssignment {
  month: string;
  isin: string;
  allocations: Record<string, number>;
}
export interface LegacyCoverageReview {
  month: string;
  accountId: string;
  complete: boolean | null;
}

export interface ValuationMigrationReview {
  assignments: LegacyPositionAssignment[];
  coverage: LegacyCoverageReview[];
}

export function legacyPositionEntries(
  snapshots: Snapshot[],
): Array<{ month: string; isin: string; value: number }> {
  return snapshots.flatMap((snap) =>
    Object.entries(snap)
      .filter(([key]) => key.startsWith('etf_'))
      .map(([key, value]) => {
        if (
          !isValidISIN(key.slice(4)) ||
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0
        )
          throw new Error(
            `${snap.date}: invalid legacy ETF valuation "${key}". Correct it before migration.`,
          );
        return { month: snap.date, isin: key.slice(4), value };
      }),
  );
}

export function valuationMigrationFingerprint(accounts: Account[], snapshots: Snapshot[]): string {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object')
      return `{${Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => `${JSON.stringify(key)}:${stable(v)}`)
        .join(',')}}`;
    return JSON.stringify(value);
  };
  return stable({ accounts, snapshots });
}

export function migratePositionSnapshots(
  snapshots: Snapshot[],
  accounts: Account[],
  assignments: LegacyPositionAssignment[],
  coverage: LegacyCoverageReview[] = [],
): Snapshot[] {
  const coverageLookup = new Map<string, LegacyCoverageReview>();
  for (const review of coverage) {
    const key = `${review.month}:${review.accountId}`;
    const account = accounts.find((a) => a.id === review.accountId && a.moneyType === 'investment');
    const snapshot = snapshots.find((s) => s.date === review.month);
    const balance =
      snapshot?.[review.accountId] ?? (account?.key ? snapshot?.[account.key] : undefined);
    if (
      !account ||
      !snapshot ||
      typeof balance !== 'number' ||
      !Number.isFinite(balance) ||
      (review.complete !== null && typeof review.complete !== 'boolean') ||
      coverageLookup.has(key)
    )
      throw new Error(
        'Coverage review requires a unique saved account/month with a recorded balance.',
      );
    coverageLookup.set(key, review);
  }
  const lookup = new Map<string, LegacyPositionAssignment>();
  for (const assignment of assignments) {
    const key = `${assignment.month}:${assignment.isin}`;
    if (lookup.has(key)) throw new Error(`Duplicate ETF assignment for ${key}.`);
    lookup.set(key, assignment);
  }
  const entries = legacyPositionEntries(snapshots);
  if (entries.length !== lookup.size)
    throw new Error('Every legacy month/ISIN needs exactly one reviewed assignment.');
  return snapshots.map((snapshot) => {
    const next = { ...snapshot };
    for (const entry of entries.filter((entry) => entry.month === snapshot.date)) {
      const assignment = lookup.get(`${entry.month}:${entry.isin}`);
      if (!assignment || !Object.keys(assignment.allocations).length)
        throw new Error(`${entry.month}: assign ${entry.isin} to an account.`);
      let total = 0;
      for (const [id, value] of Object.entries(assignment.allocations)) {
        if (!Number.isFinite(value) || value < 0)
          throw new Error('Allocation amounts must be finite and non-negative.');
        const key = positionKey(id, entry.isin);
        if (next[key] !== undefined)
          throw new Error(`${entry.month}: ${entry.isin} already has an account-linked valuation.`);
        next[key] = value;
        total += value;
      }
      if (Math.abs(total - entry.value) > POSITION_TOLERANCE)
        throw new Error(`${entry.month}: allocations for ${entry.isin} must total ${entry.value}.`);
      delete next[`etf_${entry.isin}`];
    }
    if (!accountMonth(next.date)) throw new Error(`Invalid snapshot date ${next.date}.`);
    for (const review of coverageLookup.values()) {
      if (review.month !== next.date) continue;
      if (review.complete === null) delete next[coverageKey(review.accountId)];
      else next[coverageKey(review.accountId)] = review.complete ? 1 : 0;
    }
    const error = validateSnapshotPositions(next, accounts, true);
    if (error) throw new Error(error);
    return next;
  });
}
