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
let getTiTelemetry: typeof import('../../db').getTiTelemetry;
let recordTiError: typeof import('../../db').recordTiError;
let recordTiFetch: typeof import('../../db').recordTiFetch;
let recordTiRequest: typeof import('../../db').recordTiRequest;

describe.sequential('tiTelemetry repository', () => {
  beforeAll(async () => {
    const db = await import('../../db');
    destroyDb = db.destroyDb;
    getDailyFetchCount = db.getDailyFetchCount;
    getTiTelemetry = db.getTiTelemetry;
    recordTiError = db.recordTiError;
    recordTiFetch = db.recordTiFetch;
    recordTiRequest = db.recordTiRequest;
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
    await expect(getTiTelemetry()).resolves.toEqual({
      lastFetchAt: '',
      lastRequestUrl: '',
      lastErrorAt: '',
      lastError: '',
      fetchCount: 0,
      cacheHitCount: 0,
      errorCount: 0,
      dailyFetchDate: '',
      dailyFetchCount: 0,
      requestLog: [],
    });
  });

  it('increments daily count on fetch and resets when the date changes', async () => {
    await recordTiFetch('2026-08-19T12:00:00.000Z', 'https://ti.test/funds/X.json?seq=1');
    await recordTiFetch('2026-08-19T12:30:00.000Z', 'https://ti.test/funds/X.json?seq=2');
    await expect(getDailyFetchCount()).resolves.toBe(2);

    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'));
    await expect(getDailyFetchCount()).resolves.toBe(0);

    await recordTiFetch('2026-08-20T09:00:00.000Z', 'https://ti.test/funds/X.json?seq=3');
    await expect(getDailyFetchCount()).resolves.toBe(1);
  });

  it('records the last error fields', async () => {
    await recordTiError('2026-08-19T12:00:00.000Z', 'Auth failed');
    await expect(getTiTelemetry()).resolves.toMatchObject({
      lastErrorAt: '2026-08-19T12:00:00.000Z',
      lastError: 'Auth failed',
      errorCount: 1,
    });
  });

  it('stores request debug entries in newest-first order', async () => {
    await recordTiRequest('2026-08-19T12:00:00.000Z', 'https://ti.test/funds/A.json', '[]');
    await recordTiRequest('2026-08-19T12:01:00.000Z', 'https://ti.test/funds/B.json', '{"ok":1}');
    await expect(getTiTelemetry()).resolves.toMatchObject({
      requestLog: [
        {
          at: '2026-08-19T12:01:00.000Z',
          url: 'https://ti.test/funds/B.json',
          response: '{"ok":1}',
        },
        {
          at: '2026-08-19T12:00:00.000Z',
          url: 'https://ti.test/funds/A.json',
          response: '[]',
        },
      ],
    });
  });
});
