import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  snapshotHeader,
  snapToRow,
  rowToSnap,
  parseSnapshotRows,
  reconcileSnapshotHeader,
  snapToRowForHeader,
} from './snapshots';

describe('snapshot persistence helpers', () => {
  const accts3 = [
    { key: 'a', label: '', color: '' },
    { key: 'b', label: '', color: '' },
    { key: 'c', label: '', color: '' },
  ];

  it('snapToRow produces the expected row', () => {
    const snap = { date: '2026-01', a: 100, b: 200, c: 300, notes: 'x' };
    expect(snapToRow(snap, accts3)).toEqual(['2026-01', 100, 200, 300, 'x']);
  });

  it('round-trip: rowToSnap(snapToRow(snap)) reproduces the snapshot', () => {
    const snap = { date: '2026-01', a: 100, b: 200, c: 300, notes: 'x' };
    const hdr = snapshotHeader(accts3);
    const row = snapToRow(snap, accts3);
    const result = rowToSnap(row, hdr, accts3);
    expect(result).toEqual(snap);
  });

  it('reads present columns and defaults missing ones to 0', () => {
    // Snapshot saved with 3 accounts
    const snap = { date: '2026-01', a: 100, b: 200, c: 300, notes: 'test' };
    const hdr3 = snapshotHeader(accts3);
    const row = snapToRow(snap, accts3);

    // Reload against a 2-account header (account 'c' removed)
    const accts2 = [
      { key: 'a', label: '', color: '' },
      { key: 'b', label: '', color: '' },
    ];
    const result = rowToSnap(row, hdr3, accts2);

    expect(result.date).toBe('2026-01');
    expect(result.a).toBe(100);
    expect(result.b).toBe(200);
    expect(result.notes).toBe('test');
    // 'c' is not in accts2, so it should not appear
    expect(result.c).toBeUndefined();

    // New account 'd' not in the sheet header → defaults to 0
    const accts2d = [
      { key: 'a', label: '', color: '' },
      { key: 'b', label: '', color: '' },
      { key: 'd', label: '', color: '' },
    ];
    const result2 = rowToSnap(row, hdr3, accts2d);
    expect(result2.a).toBe(100);
    expect(result2.b).toBe(200);
    expect(result2.d).toBe(0);
  });

  it('snapshotHeader builds the correct header', () => {
    expect(snapshotHeader(accts3)).toEqual(['date', 'a', 'b', 'c', 'notes']);
  });
});

describe('rowToSnap locale-safe parsing (Commit 1B)', () => {
  const accts = [
    { key: 'tr_portfolio', label: '', color: '' },
    { key: 'n26', label: '', color: '' },
  ];
  const hdr = ['date', 'tr_portfolio', 'n26', 'notes'];

  it('parses German-comma balance string "1.234,56" as 1234.56', () => {
    const row = ['2026-03', '1.234,56', '500', ''];
    const snap = rowToSnap(row, hdr, accts);
    expect(snap.tr_portfolio).toBeCloseTo(1234.56);
    expect(snap.n26).toBe(500);
  });

  it('passes through numeric cells (UNFORMATTED_VALUE) unchanged', () => {
    const row = ['2026-03', 1234.56, 500, ''];
    const snap = rowToSnap(row, hdr, accts);
    expect(snap.tr_portfolio).toBe(1234.56);
    expect(snap.n26).toBe(500);
  });

  it('parses "12.345,67" (German) as 12345.67 - the regression fix', () => {
    const row = ['2026-03', '12.345,67', '100', ''];
    const snap = rowToSnap(row, hdr, accts);
    expect(snap.tr_portfolio).toBeCloseTo(12345.67);
  });

  it('both "1.234,56" (German string) and 1234.56 (number) round-trip to same value', () => {
    const row1 = ['2026-03', '1.234,56', '0', ''];
    const row2 = ['2026-03', 1234.56, 0, ''];
    const snap1 = rowToSnap(row1, hdr, accts);
    const snap2 = rowToSnap(row2, hdr, accts);
    expect(snap1.tr_portfolio).toBeCloseTo(snap2.tr_portfolio as number);
    expect(snap1.tr_portfolio).toBeCloseTo(1234.56);
  });
});

describe('parseSnapshotRows - header-driven, config-independent', () => {
  it('derives account keys from the sheet header (no account list needed)', () => {
    const rows = [
      ['date', 'tr_portfolio', 'n26', 'savings', 'notes'],
      ['2026-06', '12345,67', '2.500,00', '8000', 'x'],
    ];
    const snaps = parseSnapshotRows(rows);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].tr_portfolio).toBeCloseTo(12345.67);
    expect(snaps[0].n26).toBeCloseTo(2500);
    expect(snaps[0].savings).toBe(8000);
    expect(snaps[0].notes).toBe('x');
  });

  it('returns [] when date column is missing', () => {
    const rows = [
      ['account_a', 'account_b', 'notes'],
      ['100', '200', ''],
    ];
    expect(parseSnapshotRows(rows)).toEqual([]);
  });

  it('sorts multiple rows ascending by date', () => {
    const rows = [
      ['date', 'a', 'notes'],
      ['2026-03', '300', ''],
      ['2026-01', '100', ''],
      ['2026-02', '200', ''],
    ];
    const snaps = parseSnapshotRows(rows);
    expect(snaps.map((s) => s.date)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('returns [] for empty rows', () => {
    expect(parseSnapshotRows([])).toEqual([]);
  });
});

// ── Phase 16 tests ────────────────────────────────────────

describe('reconcileSnapshotHeader', () => {
  it('empty current header + keys [a,b] → [date,a,b,notes]', () => {
    expect(reconcileSnapshotHeader([], ['a', 'b'])).toEqual(['date', 'a', 'b', 'notes']);
  });

  it('existing [date,a,notes] + live [a,b] → [date,a,b,notes] (b appended, a not moved)', () => {
    expect(reconcileSnapshotHeader(['date', 'a', 'notes'], ['a', 'b'])).toEqual([
      'date',
      'a',
      'b',
      'notes',
    ]);
  });

  it('existing [date,a,b,notes] + live [a] (account removed) → header unchanged', () => {
    expect(reconcileSnapshotHeader(['date', 'a', 'b', 'notes'], ['a'])).toEqual([
      'date',
      'a',
      'b',
      'notes',
    ]);
  });

  it('handles case-insensitive matching', () => {
    expect(reconcileSnapshotHeader(['Date', 'A', 'Notes'], ['a', 'b'])).toEqual([
      'date',
      'a',
      'b',
      'notes',
    ]);
  });

  it('handles header without notes column', () => {
    expect(reconcileSnapshotHeader(['date', 'a'], ['a', 'b'])).toEqual(['date', 'a', 'b', 'notes']);
  });

  it('invalid header (no date) returns fresh header', () => {
    expect(reconcileSnapshotHeader(['a', 'b'], ['x', 'y'])).toEqual(['date', 'x', 'y', 'notes']);
  });
});

describe('snapToRowForHeader', () => {
  it('aligns values to header order', () => {
    const snap = { date: '2026-01', a: 100, b: 200, notes: 'hi' };
    const header = ['date', 'b', 'a', 'notes'];
    expect(snapToRowForHeader(snap, header)).toEqual(['2026-01', 200, 100, 'hi']);
  });

  it('missing account key in snap defaults to 0 (no liveKeys arg, backward compat)', () => {
    const snap = { date: '2026-01', a: 100, notes: '' };
    const header = ['date', 'a', 'b', 'notes'];
    expect(snapToRowForHeader(snap, header)).toEqual(['2026-01', 100, 0, '']);
  });

  it('date and notes placed correctly', () => {
    const snap = { date: '2026-03', x: 42, notes: 'test note' };
    const header = ['date', 'x', 'notes'];
    expect(snapToRowForHeader(snap, header)).toEqual(['2026-03', 42, 'test note']);
  });

  it('live key absent from snap → 0; orphaned key absent from snap → empty string', () => {
    const snap = { date: '2026-01', notes: '' };
    const header = ['date', 'live_acct', 'orphaned_acct', 'notes'];
    const liveKeys = ['live_acct'];
    expect(snapToRowForHeader(snap, header, liveKeys)).toEqual(['2026-01', 0, '', '']);
  });

  it('snap has explicit 0 for a live key → still 0 (real zero not blanked)', () => {
    const snap = { date: '2026-01', live_acct: 0, notes: '' };
    const header = ['date', 'live_acct', 'notes'];
    const liveKeys = ['live_acct'];
    expect(snapToRowForHeader(snap, header, liveKeys)).toEqual(['2026-01', 0, '']);
  });

  it('snap has value for orphaned key → value preserved', () => {
    const snap = { date: '2026-01', orphaned: 500, notes: '' };
    const header = ['date', 'orphaned', 'notes'];
    const liveKeys: string[] = [];
    expect(snapToRowForHeader(snap, header, liveKeys)).toEqual(['2026-01', 500, '']);
  });
});

describe('upsertSnapshot - integration with mocked API', () => {
  let mockReadRange: ReturnType<typeof vi.fn>;
  let mockWriteRange: ReturnType<typeof vi.fn>;
  let mockAppendRows: ReturnType<typeof vi.fn>;
  let mockClearRange: ReturnType<typeof vi.fn>;
  let mockEnsureSheets: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    mockReadRange = vi.fn();
    mockWriteRange = vi.fn().mockResolvedValue({});
    mockAppendRows = vi.fn().mockResolvedValue({});
    mockClearRange = vi.fn().mockResolvedValue({});
    mockEnsureSheets = vi.fn().mockResolvedValue(undefined);

    vi.doMock('./api', () => ({
      readRange: mockReadRange,
      writeRange: mockWriteRange,
      appendRows: mockAppendRows,
      clearRange: mockClearRange,
      batchWriteRanges: vi.fn().mockResolvedValue({}),
      blankRows: (rowCount: number, colCount: number) =>
        Array.from({ length: Math.max(rowCount, 0) }, () => Array(colCount).fill('')),
      ensureSheets: mockEnsureSheets,
    }));

    vi.doMock('../constants', () => ({
      SHEET_TABS: { SNAPSHOTS: 'Snapshots', TRANSACTIONS: 'Transactions', META_INFO: 'Meta' },
      getACCTSList: () => [
        { key: 'a', label: 'A', color: '' },
        { key: 'b', label: 'B', color: '' },
      ],
    }));
  });

  it('new month → appendRows called, clearRange never called', async () => {
    // Header exists, no matching date
    mockReadRange
      .mockResolvedValueOnce([['date', 'a', 'b', 'notes']]) // header read
      .mockResolvedValueOnce([['date'], ['2026-01']]); // A:A column read

    const { upsertSnapshot } = await import('./snapshots');
    await upsertSnapshot({ date: '2026-02', a: 500, b: 600, notes: '' });

    expect(mockAppendRows).toHaveBeenCalledTimes(1);
    expect(mockClearRange).not.toHaveBeenCalled();
    // Verify appended row
    const appendedRow = mockAppendRows.mock.calls[0][1][0];
    expect(appendedRow).toEqual(['2026-02', 500, 600, '']);
  });

  it('existing month → targeted writeRange to that row, clearRange never called', async () => {
    // Header exists, matching date at row index 2 (sheet row 3)
    mockReadRange
      .mockResolvedValueOnce([['date', 'a', 'b', 'notes']]) // header read
      .mockResolvedValueOnce([['date'], ['2026-01'], ['2026-02']]); // A:A column read

    const { upsertSnapshot } = await import('./snapshots');
    await upsertSnapshot({ date: '2026-02', a: 700, b: 800, notes: 'updated' });

    expect(mockClearRange).not.toHaveBeenCalled();
    expect(mockAppendRows).not.toHaveBeenCalled();
    // writeRange for the row (row index 2 → sheet row 3)
    const writeCalls = mockWriteRange.mock.calls;
    const rowWrite = writeCalls.find((c) => c[0].includes('A3'));
    expect(rowWrite).toBeDefined();
    expect(rowWrite![1][0]).toEqual(['2026-02', 700, 800, 'updated']);
  });

  it('new account key → header writeRange to A1 fires before row write', async () => {
    // Header has [date, a, notes] but live keys include 'b'
    mockReadRange
      .mockResolvedValueOnce([['date', 'a', 'notes']]) // header read (missing 'b')
      .mockResolvedValueOnce([['date'], ['2026-01']]); // A:A column read

    const { upsertSnapshot } = await import('./snapshots');
    await upsertSnapshot({ date: '2026-01', a: 100, b: 200, notes: '' });

    expect(mockClearRange).not.toHaveBeenCalled();
    // First writeRange should be the header update
    const firstWrite = mockWriteRange.mock.calls[0];
    expect(firstWrite[0]).toContain('A1');
    expect(firstWrite[1][0]).toEqual(['date', 'a', 'b', 'notes']);
  });

  it('empty sheet → writes header and appends row to row 2', async () => {
    mockReadRange
      .mockResolvedValueOnce([]) // header read (empty)
      .mockResolvedValueOnce([]); // A:A column read (empty)

    const { upsertSnapshot } = await import('./snapshots');
    await upsertSnapshot({ date: '2026-05', a: 10, b: 20, notes: 'first' });

    expect(mockClearRange).not.toHaveBeenCalled();
    // Header written
    expect(mockWriteRange).toHaveBeenCalledTimes(1);
    expect(mockWriteRange.mock.calls[0][1][0]).toEqual(['date', 'a', 'b', 'notes']);
    // Row appended (not written to specific row)
    expect(mockAppendRows).toHaveBeenCalledTimes(1);
    expect(mockAppendRows.mock.calls[0][1][0]).toEqual(['2026-05', 10, 20, 'first']);
  });

  it('orphaned column in header → written row has empty string there', async () => {
    // Header has [date, a, b, orphaned, notes] but live keys are only [a, b]
    mockReadRange
      .mockResolvedValueOnce([['date', 'a', 'b', 'orphaned', 'notes']]) // header read
      .mockResolvedValueOnce([['date'], ['2026-01']]); // A:A column read

    const { upsertSnapshot } = await import('./snapshots');
    await upsertSnapshot({ date: '2026-01', a: 100, b: 200, notes: '' });

    // The row written should have '' for the orphaned column, not 0
    const writeCalls = mockWriteRange.mock.calls;
    const rowWrite = writeCalls.find((c) => c[0].includes('A2'));
    expect(rowWrite).toBeDefined();
    expect(rowWrite![1][0]).toEqual(['2026-01', 100, 200, '', '']);
  });
});

describe('saveSnapshots - no silent column purge', () => {
  let mockReadRange: ReturnType<typeof vi.fn>;
  let mockWriteRange: ReturnType<typeof vi.fn>;
  let mockAppendRows: ReturnType<typeof vi.fn>;
  let mockClearRange: ReturnType<typeof vi.fn>;
  let mockBatchWriteRanges: ReturnType<typeof vi.fn>;
  let mockEnsureSheets: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    mockReadRange = vi.fn();
    mockWriteRange = vi.fn().mockResolvedValue({});
    mockAppendRows = vi.fn().mockResolvedValue({});
    mockClearRange = vi.fn().mockResolvedValue({});
    mockBatchWriteRanges = vi.fn().mockResolvedValue({});
    mockEnsureSheets = vi.fn().mockResolvedValue(undefined);

    vi.doMock('./api', () => ({
      readRange: mockReadRange,
      writeRange: mockWriteRange,
      appendRows: mockAppendRows,
      clearRange: mockClearRange,
      batchWriteRanges: mockBatchWriteRanges,
      blankRows: (rowCount: number, colCount: number) =>
        Array.from({ length: Math.max(rowCount, 0) }, () => Array(colCount).fill('')),
      ensureSheets: mockEnsureSheets,
    }));

    vi.doMock('../constants', () => ({
      SHEET_TABS: { SNAPSHOTS: 'Snapshots', TRANSACTIONS: 'Transactions', META_INFO: 'Meta' },
      getACCTSList: () => [
        { key: 'a', label: 'A', color: '' },
        { key: 'b', label: 'B', color: '' },
      ],
    }));
  });

  it('sheet wider than live accounts → clearRange NOT called for orphaned columns', async () => {
    // Existing sheet has 5 columns (date, a, b, orphaned, notes) but live is only (date, a, b, notes)
    mockReadRange
      .mockResolvedValueOnce([['date', 'a', 'b', 'orphaned', 'notes']]) // header read (5 cols)
      .mockResolvedValueOnce([['date'], ['2026-01'], ['2026-02']]); // A:A (3 rows)

    const { saveSnapshots } = await import('./snapshots');
    await saveSnapshots([
      { date: '2026-01', a: 100, b: 200, notes: '' },
      { date: '2026-02', a: 300, b: 400, notes: '' },
    ]);

    // writeRange called with only live-width data (4 columns: date, a, b, notes)
    expect(mockWriteRange).toHaveBeenCalledTimes(1);
    const writtenValues = mockWriteRange.mock.calls[0][1];
    expect(writtenValues[0]).toEqual(['date', 'a', 'b', 'notes']); // header
    expect(writtenValues[0]).toHaveLength(4);

    // clearRange/batchWriteRanges should NOT have been called for orphaned
    // column range (staleBelow is 0 here, so no clear path runs at all)
    expect(mockClearRange).not.toHaveBeenCalled();
    for (const call of mockBatchWriteRanges.mock.calls) {
      const ranges = call[0] as { range: string }[];
      // Should never clear column E1:E... (the orphaned column)
      for (const r of ranges) expect(r.range).not.toMatch(/!E1:/);
    }
  });

  it('stale rows below are still blanked atomically (existing behavior preserved)', async () => {
    // Sheet has 4 rows (header + 3 data rows) but we're saving only 2 data rows
    mockReadRange
      .mockResolvedValueOnce([['date', 'a', 'b', 'notes']]) // header read (4 cols)
      .mockResolvedValueOnce([['date'], ['2026-01'], ['2026-02'], ['2026-03']]); // A:A (4 rows)

    const { saveSnapshots } = await import('./snapshots');
    await saveSnapshots([
      { date: '2026-01', a: 100, b: 200, notes: '' },
      { date: '2026-02', a: 300, b: 400, notes: '' },
    ]);

    // The write+blank must be a single atomic batchWriteRanges request,
    // never two separate writeRange/clearRange calls.
    expect(mockWriteRange).not.toHaveBeenCalled();
    expect(mockClearRange).not.toHaveBeenCalled();
    expect(mockBatchWriteRanges).toHaveBeenCalledTimes(1);
    const [ranges] = mockBatchWriteRanges.mock.calls[0];
    expect(ranges[0].range).toContain('A1');
    expect(ranges[1].range).toContain('A4'); // blank from row 4
    expect(ranges[1].values).toHaveLength(1); // exactly the 1 stale row
  });
});
