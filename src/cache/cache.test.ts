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
  set: (key: string, value: any) => {
    mockStore.set(key, value);
    return Promise.resolve();
  },
  del: (key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  },
  clear: () => {
    mockStore.clear();
    return Promise.resolve();
  },
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
  getInputsHash,
  setInputsHash,
  computeInputsHash,
  holdingsSignature,
} from './db';

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
      {
        isin: 'IE001',
        ticker: 'A',
        name: '',
        color: '',
        acc: true,
        active: true,
        contribAmount: 0,
        contribInterval: 'weekly' as const,
        assetClass: '',
        region: '',
        foldInto: '',
        order: 1,
      },
    ];
    const holdings2 = [
      {
        isin: 'IE001',
        ticker: 'A',
        name: '',
        color: '',
        acc: true,
        active: false,
        contribAmount: 0,
        contribInterval: 'weekly' as const,
        assetClass: '',
        region: '',
        foldInto: '',
        order: 1,
      },
    ];
    expect(holdingsSignature(holdings1)).not.toBe(holdingsSignature(holdings2));
  });

  it('holdingsSignature includes ticker, color, and name', () => {
    const base = {
      isin: 'IE001',
      ticker: 'VWCE',
      name: 'Vanguard FTSE All-World',
      color: '#ff0000',
      acc: true,
      active: true,
      contribAmount: 0,
      contribInterval: 'weekly' as const,
      assetClass: '',
      region: '',
      foldInto: '',
      order: 1,
    };
    const diffTicker = [{ ...base, ticker: 'IWDA' }];
    const diffColor = [{ ...base, color: '#00ff00' }];
    const diffName = [{ ...base, name: 'iShares Core MSCI World' }];
    const original = [{ ...base }];

    expect(holdingsSignature(original)).not.toBe(holdingsSignature(diffTicker));
    expect(holdingsSignature(original)).not.toBe(holdingsSignature(diffColor));
    expect(holdingsSignature(original)).not.toBe(holdingsSignature(diffName));
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

    // Read from cache - no network calls needed
    const valid = await isCacheValid();
    expect(valid).toBe(true);

    const cached = await getCachedTransactions();
    expect(cached).toHaveLength(2);
    expect(cached![0].id).toBe('tx1');
    expect(cached![1].id).toBe('tx2');
  });
});
