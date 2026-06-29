// @ts-nocheck — test fixtures use partial objects; strict typing deferred
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

describe('rowToSnap locale-safe parsing (Commit 1B)', () => {
  const accts = [{ key: 'tr_portfolio' }, { key: 'n26' }];
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

  it('parses "12.345,67" (German) as 12345.67 — the regression fix', () => {
    const row = ['2026-03', '12.345,67', '100', ''];
    const snap = rowToSnap(row, hdr, accts);
    expect(snap.tr_portfolio).toBeCloseTo(12345.67);
  });

  it('both "1.234,56" (German string) and 1234.56 (number) round-trip to same value', () => {
    const row1 = ['2026-03', '1.234,56', '0', ''];
    const row2 = ['2026-03', 1234.56, 0, ''];
    const snap1 = rowToSnap(row1, hdr, accts);
    const snap2 = rowToSnap(row2, hdr, accts);
    expect(snap1.tr_portfolio).toBeCloseTo(snap2.tr_portfolio);
    expect(snap1.tr_portfolio).toBeCloseTo(1234.56);
  });
});
