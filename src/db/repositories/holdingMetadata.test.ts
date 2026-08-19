/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HoldingMetadata } from '../../types';

vi.mock('sql.js/dist/sql-wasm-browser.wasm?url', () => ({
  default:
    '/home/runner/work/wealth-tracker/wealth-tracker/node_modules/sql.js/dist/sql-wasm-browser.wasm',
}));

const idbStore = new Map<string, Uint8Array>();

if (!(globalThis as { indexedDB?: unknown }).indexedDB) {
  (globalThis as { indexedDB: any }).indexedDB = {
    open() {
      const req: {
        result: any;
        error: unknown;
        onsuccess?: () => void;
        onerror?: () => void;
        onupgradeneeded?: () => void;
      } = {
        result: {
          createObjectStore() {},
          close() {},
          transaction() {
            const tx: {
              objectStore: () => {
                get: (key: string) => any;
                put: (data: Uint8Array, key: string) => void;
                delete: (key: string) => void;
              };
              oncomplete?: () => void;
              onerror?: () => void;
              error: unknown;
            } = {
              objectStore: () => ({
                get: (key: string) => {
                  const getReq: {
                    result: Uint8Array | null;
                    onsuccess?: () => void;
                    onerror?: () => void;
                  } = { result: idbStore.get(key) ?? null };
                  queueMicrotask(() => getReq.onsuccess?.());
                  return getReq;
                },
                put: (data: Uint8Array, key: string) => {
                  idbStore.set(key, data);
                },
                delete: (key: string) => {
                  idbStore.delete(key);
                },
              }),
              error: null,
            };
            queueMicrotask(() => tx.oncomplete?.());
            return tx;
          },
        },
        error: null,
      };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

let destroyDb: typeof import('../../db').destroyDb;
let getAllHoldingMetadata: typeof import('../../db').getAllHoldingMetadata;
let getHoldingMetadata: typeof import('../../db').getHoldingMetadata;
let upsertHoldingMetadata: typeof import('../../db').upsertHoldingMetadata;
let deleteHoldingMetadata: typeof import('../../db').deleteHoldingMetadata;
let clearAllHoldingMetadata: typeof import('../../db').clearAllHoldingMetadata;

const sample: HoldingMetadata = {
  isin: 'IE00B4L5Y983',
  symbol: 'IWDA',
  exchange: 'XETRA',
  domicileCountry: 'IE',
  fundCurrency: 'USD',
  aum: 1230000000,
  inceptionDate: '2009-09-25',
  holdingsCount: 1500,
  sectors: [{ industry: 'Technology', exposure: '20.5' }],
  topHoldings: [{ asset: 'Microsoft', weightPercentage: '4.1' }],
  fetchedAt: '2026-08-19T12:00:00.000Z',
  lastRefreshedAt: '2026-08-19T12:00:00.000Z',
  provider: 'fmp',
};

describe.sequential('holdingMetadata repository', () => {
  beforeAll(async () => {
    const db = await import('../../db');
    destroyDb = db.destroyDb;
    getAllHoldingMetadata = db.getAllHoldingMetadata;
    getHoldingMetadata = db.getHoldingMetadata;
    upsertHoldingMetadata = db.upsertHoldingMetadata;
    deleteHoldingMetadata = db.deleteHoldingMetadata;
    clearAllHoldingMetadata = db.clearAllHoldingMetadata;
  });

  beforeEach(async () => {
    idbStore.clear();
    await destroyDb();
  });

  afterEach(async () => {
    await destroyDb();
  });

  it('round-trips all fields', async () => {
    await upsertHoldingMetadata(sample);
    await expect(getHoldingMetadata(sample.isin)).resolves.toEqual(sample);
  });

  it('stores nullable fields and restores them as null or undefined', async () => {
    await upsertHoldingMetadata({
      ...sample,
      symbol: undefined,
      exchange: undefined,
      domicileCountry: undefined,
      fundCurrency: undefined,
      aum: null,
      inceptionDate: null,
      holdingsCount: null,
      sectors: null,
      topHoldings: null,
    });

    await expect(getHoldingMetadata(sample.isin)).resolves.toEqual({
      ...sample,
      symbol: undefined,
      exchange: undefined,
      domicileCountry: undefined,
      fundCurrency: undefined,
      aum: null,
      inceptionDate: null,
      holdingsCount: null,
      sectors: null,
      topHoldings: null,
    });
  });

  it('returns all rows', async () => {
    await upsertHoldingMetadata(sample);
    await upsertHoldingMetadata({ ...sample, isin: 'IE00BKM4GZ66', symbol: 'EIMI' });
    await expect(getAllHoldingMetadata()).resolves.toHaveLength(2);
  });

  it('deletes a single row', async () => {
    await upsertHoldingMetadata(sample);
    await deleteHoldingMetadata(sample.isin);
    await expect(getHoldingMetadata(sample.isin)).resolves.toBeNull();
  });

  it('clears all rows', async () => {
    await upsertHoldingMetadata(sample);
    await clearAllHoldingMetadata();
    await expect(getAllHoldingMetadata()).resolves.toEqual([]);
  });
});
