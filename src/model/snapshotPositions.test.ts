import { describe, it, expect } from 'vitest';
import type { Account } from '../types';
import {
  positionKey,
  parsePositionKey,
  aggregatePositionValues,
  validateSnapshotPositions,
} from './snapshotPositions';

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
    expect(validateSnapshotPositions(snap, accounts)).toBeNull();
    expect(parsePositionKey(positionKey('spain', isin))).toEqual({ accountId: 'spain', isin });
  });

  it('rejects account-level excess even when global cash covers it', () => {
    expect(
      validateSnapshotPositions(
        { date: '2026-01', spain: 100, france: 10000, [positionKey('spain', isin)]: 200 },
        accounts,
      ),
    ).toContain('Spain');
  });

  it.each([-1, NaN, Infinity])('rejects invalid position value %s', (value) => {
    expect(
      validateSnapshotPositions(
        { date: '2026-01', spain: 100, [positionKey('spain', isin)]: value },
        accounts,
      ),
    ).toContain('non-negative');
  });

  it('rejects unknown IDs and malformed position keys', () => {
    expect(
      validateSnapshotPositions({ date: '2026-01', [positionKey('unknown', isin)]: 1 }, accounts),
    ).toContain('unknown');
    expect(
      validateSnapshotPositions({ date: '2026-01', 'position:spain:invalid': 1 }, accounts),
    ).toContain('invalid ETF valuation key');
  });

  it('rejects legacy ETF values even without a format setting', () => {
    const snapshot = { date: '2026-01', spain: 100, [`etf_${isin}`]: 100 };
    expect(validateSnapshotPositions(snapshot, accounts)).toContain('no longer supported');
    expect(aggregatePositionValues(snapshot)).toEqual({});
  });

  it('allows account IDs starting with etf_ without treating balances as ETF values', () => {
    const account = { id: 'etf_broker', label: 'Broker', moneyType: 'investment' };
    const snapshot = { date: '2026-01', etf_broker: 100, [positionKey(account.id, isin)]: 80 };
    expect(validateSnapshotPositions(snapshot, [account])).toBeNull();
    expect(aggregatePositionValues(snapshot)).toEqual({ [isin]: 80 });
  });

  it('preserves explicit zero and allows account-only histories without position values', () => {
    expect(aggregatePositionValues({ date: '2026-01', [positionKey('spain', isin)]: 0 })).toEqual({
      [isin]: 0,
    });
    expect(validateSnapshotPositions({ date: '2026-01', spain: 100 }, accounts)).toBeNull();
  });
});
