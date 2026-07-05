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
import { fetchDeltaTransactions } from './sync';
import type { SyncCursor } from './db';

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
