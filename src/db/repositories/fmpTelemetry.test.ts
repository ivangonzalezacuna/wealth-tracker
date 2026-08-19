/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
let getDailyFetchCount: typeof import('../../db').getDailyFetchCount;
let getFmpTelemetry: typeof import('../../db').getFmpTelemetry;
let recordFmpError: typeof import('../../db').recordFmpError;
let recordFmpFetch: typeof import('../../db').recordFmpFetch;

describe.sequential('fmpTelemetry repository', () => {
  beforeAll(async () => {
    const db = await import('../../db');
    destroyDb = db.destroyDb;
    getDailyFetchCount = db.getDailyFetchCount;
    getFmpTelemetry = db.getFmpTelemetry;
    recordFmpError = db.recordFmpError;
    recordFmpFetch = db.recordFmpFetch;
  });

  beforeEach(async () => {
    idbStore.clear();
    await destroyDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await destroyDb();
  });

  it('returns zero daily fetch count for a fresh DB', async () => {
    await expect(getDailyFetchCount()).resolves.toBe(0);
  });

  it('returns a zeroed telemetry record for a fresh DB', async () => {
    await expect(getFmpTelemetry()).resolves.toEqual({
      lastFetchAt: '',
      lastRequestUrl: '',
      lastErrorAt: '',
      lastError: '',
      fetchCount: 0,
      cacheHitCount: 0,
      errorCount: 0,
      dailyFetchDate: '',
      dailyFetchCount: 0,
    });
  });

  it('increments daily count on fetch and resets when the date changes', async () => {
    await recordFmpFetch('2026-08-19T12:00:00.000Z', 'https://fmp.test?a=1');
    await recordFmpFetch('2026-08-19T12:30:00.000Z', 'https://fmp.test?a=2');
    await expect(getDailyFetchCount()).resolves.toBe(2);

    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'));
    await expect(getDailyFetchCount()).resolves.toBe(0);

    await recordFmpFetch('2026-08-20T09:00:00.000Z', 'https://fmp.test?a=3');
    await expect(getDailyFetchCount()).resolves.toBe(1);
  });

  it('records the last error fields', async () => {
    await recordFmpError('2026-08-19T12:00:00.000Z', 'Auth failed');
    await expect(getFmpTelemetry()).resolves.toMatchObject({
      lastErrorAt: '2026-08-19T12:00:00.000Z',
      lastError: 'Auth failed',
      errorCount: 1,
    });
  });
});
