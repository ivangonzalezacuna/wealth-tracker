import { describe, it, expect } from 'vitest';
import type { Account } from '../types';
import {
  positionKey,
  parsePositionKey,
  aggregatePositionValues,
  validateSnapshotPositions,
  hasCompletePositionCoverage,
  coverageKey,
} from './snapshotPositions';
import { migratePositionSnapshots, valuationMigrationFingerprint } from './valuationMigration';

const isin = 'IE00B4L5Y983';
const accounts: Account[] = [
  { id: 'spain', label: 'Spain', moneyType: 'investment', isPrimaryInvestment: true },
  { id: 'france', label: 'France', moneyType: 'investment' },
];
describe('account-linked ETF valuations', () => {
  it('aggregates shared ISINs without duplicating account balances', () => {
    const snap = {
      date: '2026-01',
      spain: 4500,
      france: 6500,
      [positionKey('spain', isin)]: 4000,
      [positionKey('france', isin)]: 6000,
    };
    expect(aggregatePositionValues(snap)).toEqual({ [isin]: 10000 });
    expect(validateSnapshotPositions(snap, accounts, true)).toBeNull();
    expect(parsePositionKey(positionKey('spain', isin))).toEqual({ accountId: 'spain', isin });
  });
  it('rejects account-level excess even when global cash covers it', () => {
    expect(
      validateSnapshotPositions(
        { date: '2026-01', spain: 100, france: 10000, [positionKey('spain', isin)]: 200 },
        accounts,
        true,
      ),
    ).toContain('Spain');
  });
  it('rejects unknown IDs, invalid numbers and ambiguous legacy/scoped collisions', () => {
    expect(
      validateSnapshotPositions(
        { date: '2026-01', [positionKey('unknown', isin)]: 1 },
        accounts,
        true,
      ),
    ).toContain('unknown');
    expect(
      validateSnapshotPositions(
        { date: '2026-01', spain: 10, [positionKey('spain', isin)]: -1 },
        accounts,
        true,
      ),
    ).toContain('non-negative');
    expect(
      validateSnapshotPositions(
        { date: '2026-01', spain: 10, [positionKey('spain', isin)]: 1, [`etf_${isin}`]: 1 },
        accounts,
        false,
      ),
    ).toContain('both');
  });
  it('does not infer complete coverage from a shared ISIN appearing once', () => {
    const snap = { date: '2026-01', [positionKey('spain', isin)]: 4000, [coverageKey('spain')]: 1 };
    expect(hasCompletePositionCoverage(snap, accounts)).toBe(false);
    expect(hasCompletePositionCoverage({ ...snap, [coverageKey('france')]: 1 }, accounts)).toBe(
      true,
    );
  });
});

describe('one-time historical conversion', () => {
  const snapshots = [
    { date: '2026-01', spain: 4000, france: 6000, [`etf_${isin}`]: 10000, notes: 'original' },
  ];
  it('preserves totals, notes, balances and source objects with explicit shared-ISIN split', () => {
    const converted = migratePositionSnapshots(snapshots, accounts, [
      { month: '2026-01', isin, allocations: { spain: 4000, france: 6000 } },
    ]);
    expect(converted[0]).toEqual({
      date: '2026-01',
      spain: 4000,
      france: 6000,
      notes: 'original',
      [positionKey('spain', isin)]: 4000,
      [positionKey('france', isin)]: 6000,
    });
    expect(aggregatePositionValues(converted[0])).toEqual(aggregatePositionValues(snapshots[0]));
    expect(snapshots[0][`etf_${isin}`]).toBe(10000);
  });
  it('requires reviewed complete assignments and rejects mismatched sums/duplicates', () => {
    expect(() => migratePositionSnapshots(snapshots, accounts, [])).toThrow('Every legacy');
    expect(() =>
      migratePositionSnapshots(snapshots, accounts, [
        { month: '2026-01', isin, allocations: { spain: 4000 } },
      ]),
    ).toThrow('must total');
    const assignment = { month: '2026-01', isin, allocations: { spain: 4000, france: 6000 } };
    expect(() => migratePositionSnapshots(snapshots, accounts, [assignment, assignment])).toThrow(
      'Duplicate',
    );
  });
  it('allows cash-only completeness, leaves unknown by default and rejects duplicate decisions', () => {
    const cashOnly = [{ date: '2026-01', spain: 4000, france: 6000 }];
    expect(migratePositionSnapshots(cashOnly, accounts, [])[0]).not.toHaveProperty(
      coverageKey('spain'),
    );
    const coverage = [{ month: '2026-01', accountId: 'spain', complete: true }];
    expect(
      migratePositionSnapshots(cashOnly, accounts, [], coverage)[0][coverageKey('spain')],
    ).toBe(1);
    expect(() =>
      migratePositionSnapshots(cashOnly, accounts, [], [...coverage, ...coverage]),
    ).toThrow('unique saved account/month');
    expect(() => migratePositionSnapshots([{ date: '2026-01' }], accounts, [], coverage)).toThrow(
      'recorded balance',
    );
    expect(cashOnly[0]).not.toHaveProperty(coverageKey('spain'));
  });

  it('fingerprints account and snapshot changes and handles no-data activation', () => {
    expect(valuationMigrationFingerprint(accounts, snapshots)).not.toEqual(
      valuationMigrationFingerprint(accounts, []),
    );
    expect(migratePositionSnapshots([], accounts, [])).toEqual([]);
  });
  it('persists explicit complete/partial coverage, permits cash remainder and preserves notes', () => {
    const converted = migratePositionSnapshots(
      [{ ...snapshots[0], france: 7000 }],
      accounts,
      [{ month: '2026-01', isin, allocations: { spain: 4000, france: 6000 } }],
      [
        { month: '2026-01', accountId: 'spain', complete: false },
        { month: '2026-01', accountId: 'france', complete: true },
      ],
    );
    expect(converted[0][coverageKey('spain')]).toBe(0);
    expect(converted[0][coverageKey('france')]).toBe(1);
    expect(converted[0].notes).toBe('original');
    expect(snapshots[0]).not.toHaveProperty(coverageKey('france'));
    expect(() =>
      migratePositionSnapshots(
        snapshots,
        accounts,
        [{ month: '2026-01', isin, allocations: { spain: 4000, france: 6000 } }],
        [{ month: '2026-02', accountId: 'france', complete: true }],
      ),
    ).toThrow('unique saved account/month');
  });
});
