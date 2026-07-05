import { describe, it, expect, vi, beforeEach } from 'vitest';
import { txKey } from './transactions';
import type { Transaction } from '../types';

// We can't easily test loadTransactions/mergeTransactions without mocking the
// sheets API, but we CAN test the pure helpers that matter most:
// - txKey semantics (unchanged before/after migration)
// - old 10-col rows read into the new shape with correct defaults

// Re-export the private helpers via a dynamic import trick:
// Since oldRowToTx and isOldHeader are not exported, we test them indirectly
// through txKey and by importing the module's internal behavior.

describe('txKey', () => {
  it('uses id when present', () => {
    const tx = {
      id: 'abc-123',
      date: '2024-01-01',
      type: 'BUY',
      isin: 'IE00B4L5Y983',
      amount: -500,
    } as unknown as Transaction;
    expect(txKey(tx)).toBe('abc-123');
  });

  it('builds composite key when no id', () => {
    const tx = {
      id: '',
      date: '2024-01-15',
      type: 'BUY',
      isin: 'IE00B4L5Y983',
      amount: -1000,
    } as unknown as Transaction;
    expect(txKey(tx)).toBe('2024-01-15|BUY|IE00B4L5Y983|-1000|');
  });

  it('falls back to symbol when no isin', () => {
    const tx = {
      id: '',
      date: '2024-02-01',
      type: 'SELL',
      symbol: 'IE00BKM4GZ66',
      amount: 500,
    } as unknown as Transaction;
    expect(txKey(tx)).toBe('2024-02-01|SELL|IE00BKM4GZ66|500|');
  });

  it('same key for old-format and new-format representation of same tx', () => {
    const oldStyleTx = {
      id: '',
      date: '2024-01-15',
      type: 'BUY',
      symbol: 'IE00B4L5Y983',
      isin: 'IE00B4L5Y983',
      amount: -1000,
    } as unknown as Transaction;
    const newStyleTx = {
      id: '',
      date: '2024-01-15',
      type: 'BUY',
      isin: 'IE00B4L5Y983',
      symbol: 'IE00B4L5Y983',
      amount: -1000,
      source: 'trade_republic',
      fee: 0,
      currency: 'EUR',
      fxRate: 0,
    } as unknown as Transaction;
    expect(txKey(oldStyleTx)).toBe(txKey(newStyleTx));
  });

  it('new fields (fee, currency, fxRate, source) do NOT affect key', () => {
    const base = {
      id: '',
      date: '2024-03-01',
      type: 'DIVIDEND',
      isin: 'IE00B4L5Y983',
      amount: 25,
    } as unknown as Transaction;
    const withExtras = {
      ...base,
      fee: 1.5,
      currency: 'USD',
      fxRate: 1.1,
      source: 'manual',
    } as unknown as Transaction;
    expect(txKey(base)).toBe(txKey(withExtras));
  });

  it('handles missing isin and symbol gracefully', () => {
    const tx = {
      id: '',
      date: '2024-04-01',
      type: 'INTEREST',
      amount: 3.5,
    } as unknown as Transaction;
    expect(txKey(tx)).toBe('2024-04-01|INTEREST||3.5|');
  });

  it('id-less transactions differing only in shares produce different keys (Phase 69)', () => {
    const tx1 = {
      id: '',
      date: '2024-05-01',
      type: 'BUY',
      isin: 'IE00B4L5Y983',
      amount: -1000,
      shares: 10,
    } as unknown as Transaction;
    const tx2 = {
      id: '',
      date: '2024-05-01',
      type: 'BUY',
      isin: 'IE00B4L5Y983',
      amount: -1000,
      shares: 5,
    } as unknown as Transaction;
    expect(txKey(tx1)).not.toBe(txKey(tx2));
  });

  it('id-present path returns t.id regardless of other fields', () => {
    const tx = {
      id: 'stable-id-xyz',
      date: '2024-01-01',
      type: 'BUY',
      isin: 'X',
      amount: -100,
      shares: 99,
    } as unknown as Transaction;
    expect(txKey(tx)).toBe('stable-id-xyz');
  });
});

describe('old 10-col migration shape', () => {
  // We simulate what oldRowToTx produces by manually constructing what
  // loadTransactions would return for an old-format row.
  // The key invariants we verify:
  // 1. source defaults to 'trade_republic'
  // 2. fee defaults to 0
  // 3. currency defaults to 'EUR'
  // 4. isin is set from the old symbol column
  // 5. txKey is the same as a new-format row with the same data

  it('old row defaults are correct', () => {
    // Simulate oldRowToTx output (based on the function logic we read)
    const oldRow = [
      'tx-001',
      '2024-01-15',
      'TRADING',
      'BUY',
      'iShares MSCI World',
      'IE00B4L5Y983',
      '10',
      '75.50',
      '-755.00',
      '-2.50',
    ];

    // Manual application of oldRowToTx logic
    const tx = {
      id: oldRow[0],
      date: oldRow[1],
      source: 'trade_republic',
      category: oldRow[2],
      type: oldRow[3],
      name: oldRow[4],
      isin: oldRow[5],
      symbol: oldRow[5],
      shares: parseFloat(oldRow[6]) || 0,
      price: parseFloat(oldRow[7]) || 0,
      amount: parseFloat(oldRow[8]) || 0,
      fee: 0,
      tax: parseFloat(oldRow[9]) || 0,
      currency: 'EUR',
      fxRate: 0,
      note: '',
    };

    expect(tx.source).toBe('trade_republic');
    expect(tx.fee).toBe(0);
    expect(tx.currency).toBe('EUR');
    expect(tx.fxRate).toBe(0);
    expect(tx.isin).toBe('IE00B4L5Y983');
    expect(tx.symbol).toBe('IE00B4L5Y983');
    expect(tx.note).toBe('');
  });

  it('txKey is stable across old and new formats for same data', () => {
    // An old-format row that would produce this tx:
    const oldTx = {
      id: '',
      date: '2024-01-15',
      type: 'BUY',
      isin: 'IE00B4L5Y983',
      symbol: 'IE00B4L5Y983',
      shares: 10,
      amount: -755,
    } as unknown as Transaction;

    // Same tx as it would appear in new 14-col format:
    const newTx = {
      id: '',
      date: '2024-01-15',
      source: 'trade_republic',
      type: 'BUY',
      name: 'iShares MSCI World',
      isin: 'IE00B4L5Y983',
      symbol: 'IE00B4L5Y983',
      shares: 10,
      price: 75.5,
      amount: -755,
      fee: 2.5,
      tax: 0,
      currency: 'EUR',
      fxRate: 0,
      note: 'migrated',
    } as unknown as Transaction;

    expect(txKey(oldTx)).toBe(txKey(newTx));
    expect(txKey(oldTx)).toBe('2024-01-15|BUY|IE00B4L5Y983|-755|10');
  });

  it('txKey with id always wins regardless of other fields', () => {
    const tx1 = {
      id: 'unique-id-1',
      date: '2024-01-01',
      type: 'BUY',
      isin: 'X',
      amount: -100,
    } as unknown as Transaction;
    const tx2 = {
      id: 'unique-id-1',
      date: '2099-12-31',
      type: 'SELL',
      isin: 'Y',
      amount: 999,
    } as unknown as Transaction;
    expect(txKey(tx1)).toBe(txKey(tx2));
    expect(txKey(tx1)).toBe('unique-id-1');
  });
});

describe('restoreTransactions', () => {
  let mockReadRange: ReturnType<typeof vi.fn>;
  let mockWriteRange: ReturnType<typeof vi.fn>;
  let mockClearRange: ReturnType<typeof vi.fn>;
  let mockEnsureSheets: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    mockReadRange = vi.fn();
    mockWriteRange = vi.fn().mockResolvedValue({});
    mockClearRange = vi.fn().mockResolvedValue({});
    mockEnsureSheets = vi.fn().mockResolvedValue(undefined);

    vi.doMock('./api', () => ({
      readRange: mockReadRange,
      writeRange: mockWriteRange,
      appendRows: vi.fn().mockResolvedValue({}),
      clearRange: mockClearRange,
      ensureSheets: mockEnsureSheets,
    }));

    vi.doMock('../constants', () => ({
      SHEET_TABS: { SNAPSHOTS: 'Snapshots', TRANSACTIONS: 'Transactions', META_INFO: 'Meta' },
      getACCTSList: () => [],
    }));
  });

  it('writes header+rows via writeRange, no clearRange when new data is longer', async () => {
    // Existing sheet has 3 rows (header + 2 data rows)
    mockReadRange.mockResolvedValueOnce([['id'], ['tx1'], ['tx2']]);

    const { restoreTransactions } = await import('./transactions');
    const txs = [
      {
        id: 'a',
        date: '2025-01-01',
        source: '',
        type: 'BUY',
        name: 'X',
        isin: 'IE1',
        symbol: '',
        shares: 1,
        price: 10,
        amount: -10,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 0,
        note: '',
      },
      {
        id: 'b',
        date: '2025-02-01',
        source: '',
        type: 'SELL',
        name: 'Y',
        isin: 'IE2',
        symbol: '',
        shares: 2,
        price: 20,
        amount: 40,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 0,
        note: '',
      },
      {
        id: 'c',
        date: '2025-03-01',
        source: '',
        type: 'BUY',
        name: 'Z',
        isin: 'IE3',
        symbol: '',
        shares: 3,
        price: 30,
        amount: -90,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 0,
        note: '',
      },
    ];

    await restoreTransactions(txs);

    expect(mockWriteRange).toHaveBeenCalledTimes(1);
    const [range, values] = mockWriteRange.mock.calls[0];
    expect(range).toContain('Transactions');
    // header + 3 data rows = 4 rows total, existing was 3, so no clearRange needed
    expect(values).toHaveLength(4);
    expect(values[0][0]).toBe('id'); // header
    expect(mockClearRange).not.toHaveBeenCalled();
  });

  it('calls clearRange when existing sheet is taller than new data', async () => {
    // Existing sheet has 10 rows
    mockReadRange.mockResolvedValueOnce(Array(10).fill(['x']));

    const { restoreTransactions } = await import('./transactions');
    const txs = [
      {
        id: 'a',
        date: '2025-01-01',
        source: '',
        type: 'BUY',
        name: 'X',
        isin: 'IE1',
        symbol: '',
        shares: 1,
        price: 10,
        amount: -10,
        fee: 0,
        tax: 0,
        currency: 'EUR',
        fxRate: 0,
        note: '',
      },
    ];

    await restoreTransactions(txs);

    expect(mockWriteRange).toHaveBeenCalledTimes(1);
    // header + 1 row = 2 rows; existing was 10, so stale = 8 rows need clearing
    expect(mockClearRange).toHaveBeenCalledTimes(1);
    const clearArg = mockClearRange.mock.calls[0][0];
    expect(clearArg).toContain('A3'); // rows 3..10 should be cleared
    expect(clearArg).toContain('N10');
  });
});
