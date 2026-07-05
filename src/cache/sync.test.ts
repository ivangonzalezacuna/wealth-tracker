/**
 * Tests for the incremental sync module (fetchDeltaTransactions + mergeDelta).
 * Covers the append-only assumption guard, normal delta fetch, empty tail,
 * error handling, and merge deduplication.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transaction } from '../types';

// ── Mock dependencies ───────────────────────────────────────────

vi.mock('../sheets/api', () => ({
  readRange: vi.fn(async () => []),
  ensureSheets: vi.fn(async () => {}),
}));

vi.mock('../constants', () => ({
  SHEET_TABS: { TRANSACTIONS: 'Transactions', SNAPSHOTS: 'Snapshots', META_INFO: 'Meta' },
}));

vi.mock('../sheets/transactions', () => ({
  txKey: (t: Transaction) => t.id || `${t.date}|${t.type}|${t.isin}|${t.amount}`,
}));

vi.mock('../model/txRow', () => ({
  newRowToTx: (row: (string | number | boolean)[]) => ({
    id: String(row[0] ?? ''),
    date: String(row[1] ?? ''),
    source: String(row[2] ?? ''),
    type: String(row[3] ?? ''),
    name: String(row[4] ?? ''),
    isin: String(row[5] ?? ''),
    symbol: String(row[5] ?? ''),
    shares: Number(row[6] ?? 0),
    price: Number(row[7] ?? 0),
    amount: Number(row[8] ?? 0),
    fee: Number(row[9] ?? 0),
    tax: Number(row[10] ?? 0),
    currency: String(row[11] ?? '') || 'EUR',
    fxRate: Number(row[12] ?? 0),
    note: String(row[13] ?? ''),
  }),
}));

import { fetchDeltaTransactions, mergeDelta } from './sync';
import { readRange, ensureSheets } from '../sheets/api';

// ── Helpers ──────────────────────────────────────────────────────

function makeTx(id: string, date: string, type = 'BUY'): Transaction {
  return {
    id,
    date,
    source: 'test',
    type,
    name: `Test ${id}`,
    isin: 'IE00TEST1234',
    symbol: 'IE00TEST1234',
    shares: 10,
    price: 100,
    amount: -1000,
    fee: 1,
    tax: 0,
    currency: 'EUR',
    fxRate: 0,
    note: '',
  };
}

// ── fetchDeltaTransactions ───────────────────────────────────────

describe('fetchDeltaTransactions', () => {
  beforeEach(() => {
    vi.mocked(readRange).mockReset();
    vi.mocked(ensureSheets).mockReset().mockResolvedValue(undefined);
  });

  it('returns null (force full resync) when current row count < cursor rowCount', async () => {
    // Sheet has 3 data rows (+ 1 header = 4 total) but cursor says 5
    vi.mocked(readRange).mockResolvedValueOnce([['hdr'], ['r1'], ['r2'], ['r3']]);

    const result = await fetchDeltaTransactions({ lastDate: '2024-03-15', rowCount: 5 });
    expect(result).toBeNull();
  });

  it('returns [] when tail is empty (no new rows, count matches)', async () => {
    // Count check: header + 3 data rows = 4 rows, cursor.rowCount = 3
    vi.mocked(readRange)
      .mockResolvedValueOnce([['hdr'], ['r1'], ['r2'], ['r3']]) // count read
      .mockResolvedValueOnce([]); // tail read

    const result = await fetchDeltaTransactions({ lastDate: '2024-03-15', rowCount: 3 });
    expect(result).toEqual([]);
  });

  it('returns parsed transactions from tail rows', async () => {
    // Count check: 5 rows total (1 header + 4 data)
    vi.mocked(readRange)
      .mockResolvedValueOnce([['hdr'], ['r1'], ['r2'], ['r3'], ['r4']]) // count
      .mockResolvedValueOnce([
        ['tx4', '2024-04-15', 'test', 'BUY', 'New ETF', 'IE00NEW', 10, 50, -500, 0, 0, 'EUR', 0],
      ]); // tail

    const result = await fetchDeltaTransactions({ lastDate: '2024-03-15', rowCount: 3 });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe('tx4');
    expect(result![0].date).toBe('2024-04-15');
  });

  it('filters out empty rows (no date in column 1)', async () => {
    vi.mocked(readRange)
      .mockResolvedValueOnce([['hdr'], ['r1'], ['r2']]) // count
      .mockResolvedValueOnce([
        ['tx3', '2024-03-15', 'test', 'BUY', 'ETF', 'IE00', 10, 50, -500, 0, 0, 'EUR', 0],
        ['', '', '', '', '', '', '', '', '', '', '', '', ''], // empty row
      ]); // tail

    const result = await fetchDeltaTransactions({ lastDate: '2024-02-15', rowCount: 1 });
    expect(result).toHaveLength(1);
  });

  it('returns null on network error (catch branch)', async () => {
    vi.mocked(ensureSheets).mockRejectedValueOnce(new Error('network'));

    const result = await fetchDeltaTransactions({ lastDate: '2024-01-01', rowCount: 5 });
    expect(result).toBeNull();
  });

  it('returns null when readRange throws during count check', async () => {
    vi.mocked(readRange).mockRejectedValueOnce(new Error('API error'));

    const result = await fetchDeltaTransactions({ lastDate: '2024-01-01', rowCount: 2 });
    expect(result).toBeNull();
  });

  it('passes currentDataRowCount == cursor.rowCount (no shrinkage)', async () => {
    // Exactly equal: 3 data rows, cursor says 3 - should proceed with tail read
    vi.mocked(readRange)
      .mockResolvedValueOnce([['hdr'], ['r1'], ['r2'], ['r3']]) // count: 3 data rows
      .mockResolvedValueOnce([]); // tail: no new rows

    const result = await fetchDeltaTransactions({ lastDate: '2024-03-15', rowCount: 3 });
    expect(result).toEqual([]);
  });
});

// ── mergeDelta ───────────────────────────────────────────────────

describe('mergeDelta', () => {
  it('deduplicates by txKey and appends only new rows', () => {
    const cached = [makeTx('tx1', '2024-01-15'), makeTx('tx2', '2024-02-15')];
    const delta = [
      makeTx('tx2', '2024-02-15'), // duplicate
      makeTx('tx3', '2024-03-15'), // new
    ];

    const { merged, newCount, cursor } = mergeDelta(cached, delta);
    expect(merged).toHaveLength(3);
    expect(newCount).toBe(1);
    expect(cursor.rowCount).toBe(3);
    expect(cursor.lastDate).toBe('2024-03-15');
  });

  it('sorts merged result by date', () => {
    const cached = [makeTx('tx3', '2024-03-15')];
    const delta = [makeTx('tx1', '2024-01-15')];

    const { merged } = mergeDelta(cached, delta);
    expect(merged[0].date).toBe('2024-01-15');
    expect(merged[1].date).toBe('2024-03-15');
  });

  it('returns empty cursor when both cached and delta are empty', () => {
    const { merged, newCount, cursor } = mergeDelta([], []);
    expect(merged).toHaveLength(0);
    expect(newCount).toBe(0);
    expect(cursor.lastDate).toBe('');
    expect(cursor.rowCount).toBe(0);
  });

  it('handles empty delta (no new rows)', () => {
    const cached = [makeTx('tx1', '2024-01-15')];
    const { merged, newCount, cursor } = mergeDelta(cached, []);
    expect(merged).toHaveLength(1);
    expect(newCount).toBe(0);
    expect(cursor.rowCount).toBe(1);
    expect(cursor.lastDate).toBe('2024-01-15');
  });

  it('handles empty cache with new delta', () => {
    const delta = [makeTx('tx1', '2024-01-15'), makeTx('tx2', '2024-02-15')];
    const { merged, newCount, cursor } = mergeDelta([], delta);
    expect(merged).toHaveLength(2);
    expect(newCount).toBe(2);
    expect(cursor.rowCount).toBe(2);
    expect(cursor.lastDate).toBe('2024-02-15');
  });
});
