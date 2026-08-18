/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { TxType } from '../types';

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

let destroyDb: typeof import('../db').destroyDb;
let exportDb: typeof import('../db').exportDb;
let importDb: typeof import('../db').importDb;
let saveAccounts: typeof import('../db').saveAccounts;
let saveHoldings: typeof import('../db').saveHoldings;
let setSetting: typeof import('../db').setSetting;
let upsertSnapshot: typeof import('../db').upsertSnapshot;
let insertTransaction: typeof import('../db').insertTransaction;
let loadAccounts: typeof import('../db').loadAccounts;
let loadHoldings: typeof import('../db').loadHoldings;
let loadSettings: typeof import('../db').loadSettings;
let loadSnapshots: typeof import('../db').loadSnapshots;
let loadTransactions: typeof import('../db').loadTransactions;

describe.sequential('db importDb local-preservation merge', () => {
  beforeAll(async () => {
    const db = await import('../db');
    destroyDb = db.destroyDb;
    exportDb = db.exportDb;
    importDb = db.importDb;
    saveAccounts = db.saveAccounts;
    saveHoldings = db.saveHoldings;
    setSetting = db.setSetting;
    upsertSnapshot = db.upsertSnapshot;
    insertTransaction = db.insertTransaction;
    loadAccounts = db.loadAccounts;
    loadHoldings = db.loadHoldings;
    loadSettings = db.loadSettings;
    loadSnapshots = db.loadSnapshots;
    loadTransactions = db.loadTransactions;
  });

  beforeEach(async () => {
    idbStore.clear();
    await destroyDb();
  });

  afterEach(async () => {
    await destroyDb();
  });

  it('preserves local structural edits (accounts/holdings/snapshots/settings/transactions) on import', async () => {
    await saveAccounts([
      {
        id: 'acct-main',
        label: 'Cloud Main',
        moneyType: 'investment',
        institution: 'Cloud Broker',
        country: 'Germany',
        group: 'Retirement',
        color: '#111',
        isPrimaryInvestment: true,
        order: 1,
      },
    ]);
    await saveHoldings([
      {
        isin: 'IE00B4L5Y983',
        name: 'Cloud World',
        shortName: 'CWLD',
        color: '#4a90d9',
        acc: true,
        active: true,
        assetClass: 'equity',
        region: 'global',
        foldInto: '',
        order: 1,
      },
    ]);
    await setSetting('costBasisMethod', 'fifo');
    await upsertSnapshot({ date: '2026-01', 'acct-main': 1000, notes: 'cloud' });
    await insertTransaction({
      id: 'tx-cloud',
      date: '2026-01-15',
      source: 'cloud',
      type: TxType.DEPOSIT,
      name: 'Cloud deposit',
      isin: '',
      shares: 0,
      price: 0,
      amount: 1000,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 0,
    });
    const cloudData = exportDb();
    expect(cloudData).not.toBeNull();

    await saveAccounts([
      {
        id: 'acct-main',
        label: 'Local Main Edited',
        moneyType: 'investment',
        institution: 'Local Broker',
        country: 'Spain',
        group: 'Retirement',
        color: '#222',
        isPrimaryInvestment: true,
        order: 1,
      },
      {
        id: 'acct-local',
        label: 'Local Extra',
        moneyType: 'cash',
        institution: 'Local Bank',
        country: 'Spain',
        group: 'Emergency',
        color: '#333',
        isPrimaryInvestment: false,
        order: 2,
      },
    ]);
    await saveHoldings([
      {
        isin: 'IE00B4L5Y983',
        name: 'Local World Edited',
        shortName: 'LWLD',
        color: '#6aa3e8',
        acc: true,
        active: true,
        assetClass: 'equity',
        region: 'global',
        foldInto: '',
        order: 1,
        notes: 'local holding note',
      },
      {
        isin: 'IE00BKM4GZ66',
        name: 'Local EM',
        shortName: 'LEM',
        color: '#e8a838',
        acc: true,
        active: true,
        assetClass: 'equity',
        region: 'emerging',
        foldInto: '',
        order: 2,
      },
    ]);
    await setSetting('costBasisMethod', 'hifo');
    await upsertSnapshot({ date: '2026-02', 'acct-main': 1100, notes: 'local-only snapshot' });
    await insertTransaction({
      id: 'tx-local',
      date: '2026-02-15',
      source: 'local',
      type: TxType.DEPOSIT,
      name: 'Local deposit',
      isin: '',
      shares: 0,
      price: 0,
      amount: 200,
      fee: 0,
      tax: 0,
      currency: 'EUR',
      fxRate: 0,
    });

    await importDb(cloudData!);

    const accounts = await loadAccounts();
    const holdings = await loadHoldings();
    const settings = await loadSettings();
    const snapshots = await loadSnapshots();
    const txs = await loadTransactions();

    expect(accounts.find((a) => a.id === 'acct-main')?.label).toBe('Local Main Edited');
    expect(accounts.find((a) => a.id === 'acct-main')?.country).toBe('Spain');
    expect(accounts.find((a) => a.id === 'acct-main')?.group).toBe('Retirement');
    expect(accounts.find((a) => a.id === 'acct-local')?.group).toBe('Emergency');
    expect(accounts.some((a) => a.id === 'acct-local')).toBe(true);

    expect(holdings.find((h) => h.isin === 'IE00B4L5Y983')?.name).toBe('Local World Edited');
    expect(holdings.find((h) => h.isin === 'IE00B4L5Y983')?.notes).toBe('local holding note');
    expect(holdings.some((h) => h.isin === 'IE00BKM4GZ66')).toBe(true);
    expect(holdings.find((h) => h.isin === 'IE00B4L5Y983')?.notes).toBe('local holding note');

    expect(settings.costBasisMethod).toBe('hifo');

    expect(snapshots.some((s) => s.date === '2026-01')).toBe(true);
    expect(snapshots.some((s) => s.date === '2026-02')).toBe(true);

    expect(txs.some((t) => t.id === 'tx-cloud')).toBe(true);
    expect(txs.some((t) => t.id === 'tx-local')).toBe(true);
  });
});
