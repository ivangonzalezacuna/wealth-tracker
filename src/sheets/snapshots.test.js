import { describe, it, expect } from 'vitest';
import { snapshotHeader, snapToRow, rowToSnap } from './snapshots';

describe('snapshot persistence helpers', () => {
  const accts3 = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];

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
    const accts2 = [{ key: 'a' }, { key: 'b' }];
    const result = rowToSnap(row, hdr3, accts2);

    expect(result.date).toBe('2026-01');
    expect(result.a).toBe(100);
    expect(result.b).toBe(200);
    expect(result.notes).toBe('test');
    // 'c' is not in accts2, so it should not appear
    expect(result.c).toBeUndefined();

    // New account 'd' not in the sheet header → defaults to 0
    const accts2d = [{ key: 'a' }, { key: 'b' }, { key: 'd' }];
    const result2 = rowToSnap(row, hdr3, accts2d);
    expect(result2.a).toBe(100);
    expect(result2.b).toBe(200);
    expect(result2.d).toBe(0);
  });

  it('snapshotHeader builds the correct header', () => {
    expect(snapshotHeader(accts3)).toEqual(['date', 'a', 'b', 'c', 'notes']);
  });
});
