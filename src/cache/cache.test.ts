/**
 * Tests for the cache layer: delta merge, aggregate caching,
 * cache invalidation on version bump, and cold-boot from cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transaction } from '../types';

// ── Mock idb-keyval (in-memory store) ────────────────────────────
const mockStore = new Map<string, any>();

vi.mock('idb-keyval', () => ({
  createStore: () => 'mock-store',
  get: (key: string) => Promise.resolve(mockStore.get(key)),
  set: (key: string, value: any) => { mockStore.set(key, value); return Promise.resolve(); },
  del: (key: string) => { mockStore.delete(key); return Promise.resolve(); },
  clear: () => { mockStore.clear(); return Promise.resolve(); },
}));

// ── Import modules under test ────────────────────────────────────
import {
  CACHE_VERSION,
  isCacheValid,
  clearCache,
  getCachedTransactions,
  setCachedTransactions,
  getCachedAggregates,
  setCachedAggregates,
  getSyncCursor,
  setSyncCursor,
  getInputsHash,
  setInputsHash,
  computeInputsHash,
  holdingsSignature,
} from './db';
import { mergeDelta } from './sync';

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

// ── Test suite ───────────────────────────────────────────────────

describe('Cache: delta merge', () => {
  it('merges new tail rows without duplicates and advances cursor', () => {
    const cached = [
      makeTx('tx1', '2024-01-15'),
      makeTx('tx2', '2024-02-15'),
      makeTx('tx3', '2024-03-15'),
    ];
    const delta = [
      makeTx('tx3', '2024-03-15'), // duplicate — should be skipped
      makeTx('tx4', '2024-04-15'),
      makeTx('tx5', '2024-05-15'),
    ];

    const result = mergeDelta(cached, delta);

    expect(result.merged).toHaveLength(5);
    expect(result.newCount).toBe(2);
    expect(result.cursor.rowCount).toBe(5);
    expect(result.cursor.lastDate).toBe('2024-05-15');
    // Verify no duplicates
    const ids = result.merged.map(t => t.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('handles empty delta (no new rows)', () => {
    const cached = [makeTx('tx1', '2024-01-15')];
    const delta: Transaction[] = [];

    const result = mergeDelta(cached, delta);

    expect(result.merged).toHaveLength(1);
    expect(result.newCount).toBe(0);
    expect(result.cursor.rowCount).toBe(1);
  });

  it('handles empty cache (first sync)', () => {
    const cached: Transaction[] = [];
    const delta = [makeTx('tx1', '2024-01-15'), makeTx('tx2', '2024-02-15')];

    const result = mergeDelta(cached, delta);

    expect(result.merged).toHaveLength(2);
    expect(result.newCount).toBe(2);
    expect(result.cursor.lastDate).toBe('2024-02-15');
  });

  it('maintains date sort order after merge', () => {
    const cached = [makeTx('tx1', '2024-03-01')];
    const delta = [makeTx('tx2', '2024-01-01'), makeTx('tx3', '2024-05-01')];

    const result = mergeDelta(cached, delta);

    expect(result.merged[0].date).toBe('2024-01-01');
    expect(result.merged[1].date).toBe('2024-03-01');
    expect(result.merged[2].date).toBe('2024-05-01');
  });
});

describe('Cache: aggregate cache with inputsHash', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('recomputes when transaction count changes', () => {
    const hash1 = computeInputsHash(10, '2024-03-15', 'avgco', 'sig1');
    const hash2 = computeInputsHash(11, '2024-04-15', 'avgco', 'sig1');
    expect(hash1).not.toBe(hash2);
  });

  it('recomputes when costBasisMethod changes', () => {
    const hash1 = computeInputsHash(10, '2024-03-15', 'avgco', 'sig1');
    const hash2 = computeInputsHash(10, '2024-03-15', 'fifo', 'sig1');
    expect(hash1).not.toBe(hash2);
  });

  it('recomputes when holdings change', () => {
    const hash1 = computeInputsHash(10, '2024-03-15', 'avgco', 'sig1');
    const hash2 = computeInputsHash(10, '2024-03-15', 'avgco', 'sig2');
    expect(hash1).not.toBe(hash2);
  });

  it('does NOT recompute when nothing changed (same hash)', () => {
    const hash1 = computeInputsHash(10, '2024-03-15', 'avgco', 'sig1');
    const hash2 = computeInputsHash(10, '2024-03-15', 'avgco', 'sig1');
    expect(hash1).toBe(hash2);
  });

  it('holdingsSignature changes when holdings config changes', () => {
    const holdings1 = [
      { isin: 'IE001', ticker: 'A', name: '', color: '', acc: true, active: true, contribAmount: 0, interval: 'weekly' as const, assetClass: '', region: '', foldInto: '', order: 1 },
    ];
    const holdings2 = [
      { isin: 'IE001', ticker: 'A', name: '', color: '', acc: true, active: false, contribAmount: 0, interval: 'weekly' as const, assetClass: '', region: '', foldInto: '', order: 1 },
    ];
    expect(holdingsSignature(holdings1)).not.toBe(holdingsSignature(holdings2));
  });

  it('stores and retrieves aggregates from cache', async () => {
    // Set schema version so cache is valid
    mockStore.set('meta:schemaVersion', CACHE_VERSION);

    const fakePd = { etfs: {}, totalInv: 1000 } as any;
    await setCachedAggregates(fakePd);
    const result = await getCachedAggregates();
    expect(result).toEqual(fakePd);
  });

  it('stores and retrieves inputsHash', async () => {
    mockStore.set('meta:schemaVersion', CACHE_VERSION);

    await setInputsHash('test-hash-123');
    const result = await getInputsHash();
    expect(result).toBe('test-hash-123');
  });
});

describe('Cache: version invalidation', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('treats cache as invalid when schema version mismatches', async () => {
    mockStore.set('meta:schemaVersion', CACHE_VERSION - 1);
    const valid = await isCacheValid();
    expect(valid).toBe(false);
  });

  it('treats cache as valid when schema version matches', async () => {
    mockStore.set('meta:schemaVersion', CACHE_VERSION);
    const valid = await isCacheValid();
    expect(valid).toBe(true);
  });

  it('returns null for cached data when version mismatches (forces full resync)', async () => {
    mockStore.set('meta:schemaVersion', CACHE_VERSION - 1);
    mockStore.set('transactions', [makeTx('tx1', '2024-01-01')]);

    const txs = await getCachedTransactions();
    expect(txs).toBeNull();
  });

  it('clearCache removes all entries', async () => {
    mockStore.set('meta:schemaVersion', CACHE_VERSION);
    mockStore.set('transactions', [makeTx('tx1', '2024-01-01')]);
    mockStore.set('meta:syncCursor', { lastDate: '2024-01-01', rowCount: 1 });

    await clearCache();

    expect(mockStore.size).toBe(0);
  });
});

describe('Cache: cold boot from cache (offline)', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('serves transactions from cache without network when valid', async () => {
    // Simulate a populated cache
    mockStore.set('meta:schemaVersion', CACHE_VERSION);
    const txs = [makeTx('tx1', '2024-01-15'), makeTx('tx2', '2024-02-15')];
    mockStore.set('transactions', txs);

    // Read from cache — no network/Sheets calls needed
    const valid = await isCacheValid();
    expect(valid).toBe(true);

    const cached = await getCachedTransactions();
    expect(cached).toHaveLength(2);
    expect(cached![0].id).toBe('tx1');
    expect(cached![1].id).toBe('tx2');
  });

  it('sync cursor is preserved across sessions', async () => {
    mockStore.set('meta:schemaVersion', CACHE_VERSION);
    await setSyncCursor({ lastDate: '2024-06-01', rowCount: 50 });

    const cursor = await getSyncCursor();
    expect(cursor).toEqual({ lastDate: '2024-06-01', rowCount: 50 });
  });
});
