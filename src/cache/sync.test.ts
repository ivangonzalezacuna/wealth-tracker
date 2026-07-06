/**
 * Tests for fetchDeltaTransactions - specifically the append-only
 * assumption guard (Sheets edited/rows removed out-of-band since the
 * last sync must force a full resync, never silently look like "no new
 * transactions").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../sheets/api', () => ({
  readRange: vi.fn(),
  ensureSheets: vi.fn(async () => {}),
}));

import { readRange } from '../sheets/api';
import { fetchDeltaTransactions, mergeDelta } from './sync';
import type { SyncCursor } from './db';
import type { Transaction } from '../types';

function mkTx(id: string, date: string): Transaction {
  return {
    id,
    date,
    source: '',
    type: 'BUY',
    name: '',
    isin: 'IE1',
    symbol: '',
    shares: 1,
    price: 1,
    amount: -1,
    fee: 0,
    tax: 0,
    currency: 'EUR',
    fxRate: 0,
    note: '',
  } as Transaction;
}

describe('fetchDeltaTransactions', () => {
  beforeEach(() => {
    (readRange as ReturnType<typeof vi.fn>).mockReset();
  });

  it('returns [] when the sheet is unchanged and no new rows exist', async () => {
    const cursor: SyncCursor = { lastDate: '2026-01-01', rowCount: 3 };
    (readRange as ReturnType<typeof vi.fn>).mockImplementation(async (range: string) => {
      if (range.endsWith('!A:A')) return [['header'], ['r1'], ['r2'], ['r3']]; // 3 data rows, matches cursor
      return []; // tail read: nothing new
    });
    const result = await fetchDeltaTransactions(cursor);
    expect(result).toEqual([]);
  });

  it('returns new rows when the sheet only grew (true append-only case)', async () => {
    const cursor: SyncCursor = { lastDate: '2026-01-01', rowCount: 2 };
    (readRange as ReturnType<typeof vi.fn>).mockImplementation(async (range: string) => {
      if (range.endsWith('!A:A')) return [['header'], ['r1'], ['r2'], ['r3']]; // 3 data rows now, cursor expects 2
      return [['tx3', '2026-02-01', ...Array(11).fill('')]]; // one new tail row
    });
    const result = await fetchDeltaTransactions(cursor);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
  });

  it('returns null (forcing full resync) when the sheet has fewer data rows than the cursor expects', async () => {
    const cursor: SyncCursor = { lastDate: '2026-01-01', rowCount: 5 };
    (readRange as ReturnType<typeof vi.fn>).mockImplementation(async (range: string) => {
      if (range.endsWith('!A:A')) return [['header'], ['r1'], ['r2']]; // only 2 data rows now - a historical row was removed
      return []; // would otherwise look like "no new transactions"
    });
    const result = await fetchDeltaTransactions(cursor);
    expect(result).toBeNull();
  });

  it('returns null on a network/API error', async () => {
    const cursor: SyncCursor = { lastDate: '2026-01-01', rowCount: 1 };
    (readRange as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
    const result = await fetchDeltaTransactions(cursor);
    expect(result).toBeNull();
  });
});

describe('mergeDelta - cursor.rowCount must track physical sheet rows, not deduped count', () => {
  /**
   * fetchDeltaTransactions treats cursor.rowCount as a literal physical
   * sheet row count when computing the next tail-read start row
   * (startRow = cursor.rowCount + 2). mergeDelta must therefore report a
   * rowCount equal to the number of physical rows the sheet now has
   * (cached rows + however many rows the tail read returned) - never the
   * post-dedup transaction count. If a delta read ever contains a row
   * that collides with an existing cached txKey (e.g. an overlapping
   * partial sync), the deduped `merged` array is shorter than the real
   * sheet, and using its length would make every future sync re-read
   * that already-seen tail row forever.
   */
  it('rowCount equals cached+delta row count even when the delta contains a duplicate', () => {
    const cached = [mkTx('a', '2026-01-01'), mkTx('b', '2026-01-02')];
    // Delta read from the sheet tail returned 2 physical rows, but one of
    // them (id 'b') collides with an existing cached transaction.
    const delta = [mkTx('b', '2026-01-02'), mkTx('c', '2026-01-03')];

    const { merged, cursor } = mergeDelta(cached, delta);

    // Only 1 of the 2 delta rows was genuinely new...
    expect(merged).toHaveLength(3);
    // ...but the sheet itself now physically has cached.length + delta.length
    // rows (2 + 2 = 4), which is what the next fetchDeltaTransactions call
    // needs in cursor.rowCount to compute the correct next start row.
    expect(cursor.rowCount).toBe(cached.length + delta.length);
  });

  it('rowCount matches merged.length in the normal (no-duplicate) case', () => {
    const cached = [mkTx('a', '2026-01-01')];
    const delta = [mkTx('b', '2026-01-02'), mkTx('c', '2026-01-03')];

    const { merged, cursor } = mergeDelta(cached, delta);

    expect(merged).toHaveLength(3);
    expect(cursor.rowCount).toBe(3);
  });

  it('a subsequent fetchDeltaTransactions uses the corrected rowCount to read exactly the unread tail', async () => {
    const cached = [mkTx('a', '2026-01-01'), mkTx('b', '2026-01-02')];
    const delta = [mkTx('b', '2026-01-02'), mkTx('c', '2026-01-03')];
    const { cursor } = mergeDelta(cached, delta);

    (readRange as ReturnType<typeof vi.fn>).mockReset();
    (readRange as ReturnType<typeof vi.fn>).mockImplementation(async (range: string) => {
      // Sheet now has exactly 4 data rows (header + 4), matching rowCount.
      if (range.endsWith('!A:A')) return [['header'], ['a'], ['b'], ['c'], ['d']];
      // The only unread row is the new one appended after the last sync.
      return [['d', '2026-01-04', ...Array(11).fill('')]];
    });

    const result = await fetchDeltaTransactions(cursor);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe('d');
  });
});
