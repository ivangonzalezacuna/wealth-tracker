/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { TxType } from '../types';

const wasmAssetPath = vi.hoisted(() => {
  const cwd = (globalThis as typeof globalThis & { process: { cwd(): string } }).process.cwd();
  return `${cwd.replaceAll('\\', '/')}/node_modules/sql.js/dist/sql-wasm-browser.wasm`;
});

vi.mock('sql.js/dist/sql-wasm-browser.wasm?url', () => ({ default: wasmAssetPath }));

const idbStore = new Map<string, Uint8Array>();
let failNextWrite = false;

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
                  if (failNextWrite) {
                    failNextWrite = false;
                    throw new Error('Simulated storage failure');
                  }
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
let getDb: typeof import('../db').getDb;
let persistDb: typeof import('../db').persistDb;
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

describe('db importDb local-preservation merge', () => {
  beforeAll(async () => {
    const db = await import('../db');
    destroyDb = db.destroyDb;
    getDb = db.getDb;
    persistDb = db.persistDb;
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
    failNextWrite = false;
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

  it('keeps local-only rows but not local config when preserveLocalConfig is false', async () => {
    await setSetting('costBasisMethod', 'fifo');
    await upsertSnapshot({ date: '2026-01', 'acct-main': 1000 });
    const cloudData = exportDb();

    await setSetting('costBasisMethod', 'hifo');
    await upsertSnapshot({ date: '2026-02', 'acct-main': 1100 });
    await importDb(cloudData!, { preserveLocalConfig: false });

    expect((await loadSettings()).costBasisMethod).toBe('fifo');
    expect((await loadSnapshots()).map((s) => s.date)).toEqual(['2026-01', '2026-02']);
  });

  it('persists applied schema migrations so later loads see the upgraded schema', async () => {
    const db = await getDb();
    db.run('ALTER TABLE accounts DROP COLUMN closed_periods_json');
    db.run("UPDATE meta SET value = '14' WHERE key = 'schema_version'");
    await persistDb(db);

    const oldSchema = idbStore.get('main.db');
    expect(oldSchema).toBeDefined();
    await destroyDb();
    idbStore.set('main.db', oldSchema!);

    const migratedDb = await getDb();
    expect(
      migratedDb.exec("SELECT value FROM meta WHERE key = 'schema_version'")[0].values[0][0],
    ).toBe('16');
    expect(
      migratedDb
        .exec('PRAGMA table_info(accounts)')[0]
        .values.some((row) => row[1] === 'closed_periods_json'),
    ).toBe(true);
    expect(Array.from(idbStore.get('main.db')!)).toEqual(Array.from(migratedDb.export()));
  });

  it('round-trips closure periods through config save, binary import and restore', async () => {
    const { saveAccountConfiguration, restoreAllData } = await import('../db');
    await saveAccounts([{ id: 'spain', label: 'Spain', moneyType: 'investment' }]);
    await upsertSnapshot({ date: '2026-01', spain: 10000 });
    await upsertSnapshot({ date: '2026-02', spain: 0 });
    const accounts = [
      {
        id: 'spain',
        label: 'Spain',
        moneyType: 'investment',
        closedPeriods: [{ closedFromMonth: '2026-02' }],
      },
    ];
    await saveAccountConfiguration(accounts, { monthly_contrib_budget: '0' });
    const data = exportDb()!;
    await importDb(data, { preserveLocalTransactions: false });
    expect((await loadAccounts())[0].closedPeriods).toEqual(accounts[0].closedPeriods);
    await restoreAllData({
      accounts,
      holdings: [],
      settings: {},
      snapshots: await loadSnapshots(),
      transactions: [],
    });
    expect((await loadAccounts())[0].closedPeriods).toEqual(accounts[0].closedPeriods);
  });

  it('protects closure evidence from snapshot deletion and residual values', async () => {
    const { saveAccountConfiguration, saveSnapshots } = await import('../db');
    await saveAccounts([{ id: 'spain', label: 'Spain', moneyType: 'investment' }]);
    await upsertSnapshot({ date: '2026-02', spain: 0 });
    await saveAccountConfiguration(
      [
        {
          id: 'spain',
          label: 'Spain',
          moneyType: 'investment',
          closedPeriods: [{ closedFromMonth: '2026-02' }],
        },
      ],
      {},
    );
    await expect(saveSnapshots([])).rejects.toThrow('explicit zero');
    await expect(upsertSnapshot({ date: '2026-03', spain: 1 })).rejects.toThrow('nonzero');
    expect((await loadSnapshots()).length).toBe(1);
  });

  it('converts all history exactly once and rejects stale previews without altering data', async () => {
    const { convertEtfValuations } = await import('../db');
    const { valuationMigrationFingerprint } = await import('../model/valuationMigration');
    await saveAccounts([{ id: 'spain', label: 'Spain', moneyType: 'investment' }]);
    await upsertSnapshot({ date: '2026-01', spain: 10000, etf_IE00B4L5Y983: 10000 });
    const fingerprint = valuationMigrationFingerprint(await loadAccounts(), await loadSnapshots());
    const assignments = [{ month: '2026-01', isin: 'IE00B4L5Y983', allocations: { spain: 10000 } }];
    await expect(convertEtfValuations(assignments, 'stale')).rejects.toThrow('changed');
    expect((await loadSnapshots())[0].etf_IE00B4L5Y983).toBe(10000);
    await convertEtfValuations(assignments, fingerprint, [
      { month: '2026-01', accountId: 'spain', complete: true },
    ]);
    expect((await loadSettings()).etf_valuation_schema).toBe('account-v1');
    expect((await loadSnapshots())[0]['position:spain:IE00B4L5Y983']).toBe(10000);
    expect((await loadSnapshots())[0].etf_IE00B4L5Y983).toBeUndefined();
    expect((await loadSnapshots())[0]['position_coverage:spain']).toBe(1);
    await expect(convertEtfValuations(assignments, fingerprint)).rejects.toThrow('already');
    await expect(
      upsertSnapshot({ date: '2026-02', spain: 10000, etf_IE00B4L5Y983: 10000 }),
    ).rejects.toThrow('legacy');
  });

  it('atomically reviews migrated historical completeness without changing values or notes', async () => {
    const { reviewEtfCoverage } = await import('../db');
    const { valuationMigrationFingerprint } = await import('../model/valuationMigration');
    await saveAccounts([{ id: 'france', label: 'France', moneyType: 'investment' }]);
    await setSetting('etf_valuation_schema', 'account-v1');
    await upsertSnapshot({
      date: '2026-01',
      france: 7000,
      'position:france:IE00B4L5Y983': 6000,
      notes: 'Transfer',
    });
    let fingerprint = valuationMigrationFingerprint(await loadAccounts(), await loadSnapshots());
    const coverage = [{ month: '2026-01', accountId: 'france', complete: true }];
    await expect(reviewEtfCoverage(coverage, 'stale')).rejects.toThrow('changed');
    expect((await loadSnapshots())[0]['position_coverage:france']).toBeUndefined();
    await reviewEtfCoverage(coverage, fingerprint);
    expect((await loadSnapshots())[0]).toMatchObject({
      france: 7000,
      'position:france:IE00B4L5Y983': 6000,
      'position_coverage:france': 1,
      notes: 'Transfer',
    });
    fingerprint = valuationMigrationFingerprint(await loadAccounts(), await loadSnapshots());
    await reviewEtfCoverage([{ ...coverage[0], complete: null }], fingerprint);
    expect((await loadSnapshots())[0]['position_coverage:france']).toBeUndefined();
  });

  it('rejects future-schema database imports without swapping the live database', async () => {
    const db = await getDb();
    db.run("UPDATE meta SET value = '999' WHERE key = 'schema_version'");
    const future = exportDb()!;
    db.run("UPDATE meta SET value = '16' WHERE key = 'schema_version'");
    await expect(importDb(future)).rejects.toThrow('newer app');
    expect(
      (await getDb()).exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0],
    ).toBe('16');
  });

  it('keeps live and durable data unchanged when lifecycle persistence fails', async () => {
    const { saveAccountConfiguration } = await import('../db');
    await saveAccounts([
      { id: 'spain', label: 'Spain', moneyType: 'investment', isPrimaryInvestment: true },
    ]);
    await setSetting('monthly_contrib_budget', '500');
    await upsertSnapshot({ date: '2026-02', spain: 0 });
    const before = Array.from(idbStore.get('main.db')!);
    failNextWrite = true;
    await expect(
      saveAccountConfiguration(
        [
          {
            id: 'spain',
            label: 'Spain',
            moneyType: 'investment',
            closedPeriods: [{ closedFromMonth: '2026-02' }],
          },
        ],
        { monthly_contrib_budget: '0' },
      ),
    ).rejects.toThrow('Simulated storage failure');
    expect((await loadAccounts())[0].isPrimaryInvestment).toBe(true);
    expect((await loadAccounts())[0].closedPeriods).toBeUndefined();
    expect((await loadSettings()).monthly_contrib_budget).toBe('500');
    expect(Array.from(idbStore.get('main.db')!)).toEqual(before);
  });

  it('rejects a merged legacy snapshot after account-linked activation without replacing live data', async () => {
    await saveAccounts([{ id: 'spain', label: 'Spain', moneyType: 'investment' }]);
    await setSetting('etf_valuation_schema', 'account-v1');
    const cloud = exportDb()!;
    const db = await getDb();
    // Simulate an old client retaining a local-only legacy month.
    db.run("DELETE FROM settings WHERE key='etf_valuation_schema'");
    await upsertSnapshot({ date: '2026-01', spain: 100, etf_IE00B4L5Y983: 100 });
    await expect(importDb(cloud, { preserveLocalConfig: false })).rejects.toThrow('legacy');
    expect((await loadSnapshots())[0].etf_IE00B4L5Y983).toBe(100);
    expect((await loadSettings()).etf_valuation_schema).toBeUndefined();
  });

  it('prevents settings from activating legacy data or downgrading linked data', async () => {
    const { replaceAllSettings, deleteSetting } = await import('../db');
    await saveAccounts([{ id: 'spain', label: 'Spain', moneyType: 'investment' }]);
    await upsertSnapshot({ date: '2026-01', spain: 100, etf_IE00B4L5Y983: 100 });
    await expect(setSetting('etf_valuation_schema', 'account-v1')).rejects.toThrow('legacy');
    expect((await loadSettings()).etf_valuation_schema).toBeUndefined();
    (await getDb()).run('DELETE FROM snapshots');
    await setSetting('etf_valuation_schema', 'account-v1');
    await expect(deleteSetting('etf_valuation_schema')).rejects.toThrow('cannot');
    await expect(replaceAllSettings({})).rejects.toThrow('cannot');
    await expect(setSetting('etf_valuation_schema', 'future')).rejects.toThrow('cannot');
  });

  it('does not downgrade an activated database during cloud replacement', async () => {
    await saveAccounts([{ id: 'spain', label: 'Spain', moneyType: 'investment' }]);
    await upsertSnapshot({ date: '2026-01', spain: 100, etf_IE00B4L5Y983: 100 });
    const legacy = exportDb()!;
    (await getDb()).run('DELETE FROM snapshots');
    await setSetting('etf_valuation_schema', 'account-v1');
    await expect(
      importDb(legacy, { preserveLocalTransactions: false, preserveLocalConfig: false }),
    ).rejects.toThrow('reviewed backup');
    expect((await loadSettings()).etf_valuation_schema).toBe('account-v1');
    expect(await loadSnapshots()).toEqual([]);
  });

  it('protects historical case-insensitive account balances from deletion', async () => {
    const { saveAccountConfiguration } = await import('../db');
    await saveAccounts([{ id: 'spain', label: 'Spain', moneyType: 'investment' }]);
    await upsertSnapshot({ date: '2026-01', SPAIN: 1000 });
    await expect(saveAccountConfiguration([], {})).rejects.toThrow('financial history');
    expect((await loadAccounts())[0].id).toBe('spain');
  });
});
