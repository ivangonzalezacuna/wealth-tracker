import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db module and sync engine before importing the module under test
vi.mock('../db', () => ({
  loadAccounts: vi.fn(async () => []),
  saveAccounts: vi.fn(async () => {}),
  loadHoldings: vi.fn(async () => []),
  saveHoldings: vi.fn(async () => {}),
  loadSettings: vi.fn(async () => ({})),
  setSetting: vi.fn(async () => {}),
  replaceAllSettings: vi.fn(async () => {}),
  logConfigChange: vi.fn(async () => {}),
}));

vi.mock('../sync/engine', () => ({
  scheduleUpload: vi.fn(),
}));

vi.mock('../config', () => ({
  CONFIG: {
    accounts: [],
    holdings: [],
    projection: {},
    targetAllocation: {},
    reinvestmentRules: {},
  },
}));

import {
  parseAccounts,
  setAccounts,
  setHoldings,
  setSetting,
  setSettings,
  hydrateConfigFromCache,
  getAccounts,
  getHoldings,
  getSettings,
  isConfigLoaded,
  replaceSettings,
  getRetiredAccountIds,
  retireAccountIds,
  retireAccountIdsSafely,
  flushPendingRetiredIds,
} from './config';
import {
  saveAccounts as dbSaveAccounts,
  saveHoldings as dbSaveHoldings,
  setSetting as dbSetSetting,
  replaceAllSettings as dbReplaceAllSettings,
} from '../db';

describe('parseAccounts', () => {
  it('legacy sheet (no new columns) defaults to annualReturnPct:0, contribAmount:0, contribInterval:monthly', () => {
    const rows: (string | number | boolean)[][] = [
      ['id', 'moneyType', 'institution', 'label', 'color', 'isPrimaryInvestment', 'order'],
      ['acct1', 'investment', 'TR', 'Main', '#111', true, 1],
      ['acct2', 'cash', 'N26', 'Cash', '#222', false, 2],
    ];
    const accounts = parseAccounts(rows);
    expect(accounts).toHaveLength(2);
    for (const a of accounts) {
      expect(a.annualReturnPct).toBe(0);
      expect(a.contribAmount).toBe(0);
      expect(a.contribInterval).toBe('monthly');
    }
  });

  it('new-format sheet parses annualReturnPct, contribAmount, contribInterval correctly', () => {
    const rows: (string | number | boolean)[][] = [
      [
        'id',
        'moneyType',
        'institution',
        'label',
        'color',
        'isPrimaryInvestment',
        'order',
        'annualReturnPct',
        'contribAmount',
        'contribInterval',
      ],
      ['acct1', 'investment', 'TR', 'Main', '#111', true, 1, 5, 200, 'quarterly'],
    ];
    const accounts = parseAccounts(rows);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].annualReturnPct).toBe(5);
    expect(accounts[0].contribAmount).toBe(200);
    expect(accounts[0].contribInterval).toBe('quarterly');
  });

  it('coerces an invalid contribInterval string to monthly', () => {
    const rows: (string | number | boolean)[][] = [
      [
        'id',
        'moneyType',
        'institution',
        'label',
        'color',
        'isPrimaryInvestment',
        'order',
        'annualReturnPct',
        'contribAmount',
        'contribInterval',
      ],
      ['acct1', 'investment', 'TR', 'Main', '#111', true, 1, 7, 100, 'daily'],
    ];
    const accounts = parseAccounts(rows);
    expect(accounts[0].contribInterval).toBe('monthly');
  });
});

describe('setAccounts', () => {
  beforeEach(() => {
    vi.mocked(dbSaveAccounts).mockReset().mockResolvedValue(undefined);
    hydrateConfigFromCache({ accounts: [], holdings: [], settings: {} });
  });

  it('persists accounts via dbSaveAccounts', async () => {
    const accounts = [
      {
        id: 'acct1',
        moneyType: 'investment',
        institution: 'TR',
        label: 'Main',
        color: '#111',
        isPrimaryInvestment: true,
        order: 1,
        annualReturnPct: 7,
        contribAmount: 50,
        contribInterval: 'monthly' as const,
      },
    ];
    await setAccounts(accounts);
    expect(dbSaveAccounts).toHaveBeenCalledWith(accounts);
  });
});

describe('hydrateConfigFromCache', () => {
  it('sets getAccounts/getHoldings/getSettings and marks isConfigLoaded true', () => {
    const accounts = [
      {
        id: 'a1',
        moneyType: 'investment',
        institution: 'TR',
        label: 'Main',
        color: '#000',
        isPrimaryInvestment: true,
        order: 1,
      },
    ];
    const holdings = [
      {
        isin: 'IE00B4L5Y983',
        shortName: 'IWDA',
        name: 'iShares MSCI World',
        color: '#4a90d9',
        acc: true,
        active: true,
        contribAmount: 100,
        contribInterval: 'weekly' as const,
        assetClass: 'equity',
        region: 'developed',
        foldInto: '',
        order: 1,
      },
    ];
    const settings = { costBasisMethod: 'fifo' };

    hydrateConfigFromCache({ accounts, holdings, settings });

    expect(getAccounts()).toEqual(accounts);
    expect(getHoldings()).toEqual(holdings);
    expect(getSettings()).toEqual(settings);
    expect(isConfigLoaded()).toBe(true);
  });

  it('empty config still sets isConfigLoaded to true', () => {
    hydrateConfigFromCache({ accounts: [], holdings: [], settings: {} });

    expect(getAccounts()).toEqual([]);
    expect(getHoldings()).toEqual([]);
    expect(getSettings()).toEqual({});
    expect(isConfigLoaded()).toBe(true);
  });
});

describe('replaceSettings', () => {
  beforeEach(() => {
    vi.mocked(dbReplaceAllSettings).mockReset().mockResolvedValue(undefined);
  });

  it('fully replaces settings - pre-existing keys not in new object are gone', async () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: { oldKey: 'oldValue', costBasisMethod: 'fifo' },
    });
    expect(getSettings().oldKey).toBe('oldValue');

    await replaceSettings({ costBasisMethod: 'avgco', newKey: 'newValue' });

    const result = getSettings();
    expect(result.costBasisMethod).toBe('avgco');
    expect(result.newKey).toBe('newValue');
    expect(result.oldKey).toBeUndefined();
  });

  it('getSettings() returns exactly the new object after replace', async () => {
    const newSettings = { costBasisMethod: 'fifo', targetNetWorth: '100000' };
    await replaceSettings(newSettings);

    expect(getSettings()).toEqual(newSettings);
  });
});

describe('getRetiredAccountIds / retireAccountIds', () => {
  beforeEach(() => {
    vi.mocked(dbSetSetting).mockReset().mockResolvedValue(undefined);
  });

  it('returns [] when no retired ids are stored', () => {
    hydrateConfigFromCache({ accounts: [], holdings: [], settings: {} });
    expect(getRetiredAccountIds()).toEqual([]);
  });

  it('round-trips retired ids through settings', async () => {
    hydrateConfigFromCache({ accounts: [], holdings: [], settings: {} });
    await retireAccountIds(['old_acct_1', 'old_acct_2']);
    expect(getRetiredAccountIds()).toEqual(expect.arrayContaining(['old_acct_1', 'old_acct_2']));
    expect(getRetiredAccountIds()).toHaveLength(2);
  });

  it('deduplicates ids', async () => {
    hydrateConfigFromCache({ accounts: [], holdings: [], settings: {} });
    await retireAccountIds(['dup']);
    await retireAccountIds(['dup', 'new']);
    const ids = getRetiredAccountIds();
    expect(ids.filter((id) => id === 'dup')).toHaveLength(1);
    expect(ids).toContain('new');
  });

  it('returns [] on malformed JSON in settings', () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: { retired_account_ids: 'not-json' },
    });
    expect(getRetiredAccountIds()).toEqual([]);
  });

  it('does nothing when passed an empty array', async () => {
    hydrateConfigFromCache({ accounts: [], holdings: [], settings: {} });
    await retireAccountIds([]);
    expect(getRetiredAccountIds()).toEqual([]);
  });
});

describe('retireAccountIdsSafely / flushPendingRetiredIds (failed-write resilience)', () => {
  function stubLocalStorage(): Storage {
    const store = new Map<string, string>();
    const stub = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: () => null,
      get length() {
        return store.size;
      },
    } as Storage;
    vi.stubGlobal('localStorage', stub);
    return stub;
  }

  beforeEach(() => {
    stubLocalStorage();
    vi.mocked(dbSetSetting).mockReset().mockResolvedValue(undefined);
    hydrateConfigFromCache({ accounts: [], holdings: [], settings: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queues the id locally (never throws) when the underlying DB write fails', async () => {
    vi.mocked(dbSetSetting).mockRejectedValueOnce(new Error('db error'));
    const ok = await retireAccountIdsSafely(['acct_x']);
    expect(ok).toBe(false);
    expect(getRetiredAccountIds()).toContain('acct_x');
  });

  it('returns true and persists normally when the write succeeds', async () => {
    const ok = await retireAccountIdsSafely(['acct_y']);
    expect(ok).toBe(true);
    expect(getRetiredAccountIds()).toContain('acct_y');
  });

  it('flushPendingRetiredIds retries a queued id and clears the queue on success', async () => {
    vi.mocked(dbSetSetting).mockRejectedValueOnce(new Error('db error'));
    await retireAccountIdsSafely(['acct_z']);
    expect(getRetiredAccountIds()).toContain('acct_z');

    // Next attempt succeeds
    await flushPendingRetiredIds();
    expect(getRetiredAccountIds()).toContain('acct_z');
    expect(localStorage.getItem('wt_pending_retired_ids')).toBe('[]');
  });

  it('flushPendingRetiredIds is a no-op when nothing is queued', async () => {
    await expect(flushPendingRetiredIds()).resolves.toBeUndefined();
  });
});

describe('rollback on failure', () => {
  const ORIGINAL_ACCOUNTS = [
    {
      id: 'orig',
      moneyType: 'cash',
      institution: 'N26',
      label: 'Original',
      color: '#000',
      isPrimaryInvestment: false,
      order: 1,
      annualReturnPct: 0,
      contribAmount: 0,
      contribInterval: 'monthly' as const,
    },
  ];
  const ORIGINAL_HOLDINGS = [
    {
      isin: 'IE00B4L5Y983',
      shortName: 'IWDA',
      name: 'iShares MSCI World',
      color: '#4a90d9',
      acc: true,
      active: true,
      contribAmount: 100,
      contribInterval: 'weekly' as const,
      assetClass: 'equity',
      region: 'developed',
      foldInto: '',
      order: 1,
    },
  ];
  const ORIGINAL_SETTINGS = { costBasisMethod: 'fifo', annualReturnPct: '7' };

  beforeEach(() => {
    vi.mocked(dbSaveAccounts).mockReset().mockResolvedValue(undefined);
    vi.mocked(dbSaveHoldings).mockReset().mockResolvedValue(undefined);
    vi.mocked(dbSetSetting).mockReset().mockResolvedValue(undefined);
    vi.mocked(dbReplaceAllSettings).mockReset().mockResolvedValue(undefined);
  });

  it('setAccounts rolls back _accounts on dbSaveAccounts failure', async () => {
    hydrateConfigFromCache({
      accounts: ORIGINAL_ACCOUNTS,
      holdings: [],
      settings: {},
    });
    vi.mocked(dbSaveAccounts).mockRejectedValueOnce(new Error('db error'));

    await expect(
      setAccounts([{ ...ORIGINAL_ACCOUNTS[0], id: 'new', label: 'New' }]),
    ).rejects.toThrow('db error');

    expect(getAccounts()).toEqual(ORIGINAL_ACCOUNTS);
  });

  it('setHoldings rolls back _holdings on dbSaveHoldings failure', async () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: ORIGINAL_HOLDINGS,
      settings: {},
    });
    vi.mocked(dbSaveHoldings).mockRejectedValueOnce(new Error('db error'));

    await expect(setHoldings([{ ...ORIGINAL_HOLDINGS[0], shortName: 'VWCE' }])).rejects.toThrow(
      'db error',
    );

    expect(getHoldings()).toEqual(ORIGINAL_HOLDINGS);
  });

  it('setSetting rolls back _settings on dbSetSetting failure', async () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: ORIGINAL_SETTINGS,
    });
    vi.mocked(dbSetSetting).mockRejectedValueOnce(new Error('db error'));

    await expect(setSetting('costBasisMethod', 'avgco')).rejects.toThrow('db error');

    expect(getSettings().costBasisMethod).toBe('fifo');
  });

  it('setSettings rolls back _settings on dbReplaceAllSettings failure (including deletes)', async () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: { costBasisMethod: 'fifo', annualReturnPct: '7' },
    });

    expect(getSettings().costBasisMethod).toBe('fifo');

    vi.mocked(dbReplaceAllSettings).mockRejectedValueOnce(new Error('db error'));

    let threwError = false;
    try {
      await setSettings({ costBasisMethod: 'avgco', annualReturnPct: null });
    } catch (e: unknown) {
      threwError = true;
      expect((e as Error).message).toBe('db error');
    }

    expect(threwError).toBe(true);
    expect(getSettings().costBasisMethod).toBe('fifo');
    expect(getSettings().annualReturnPct).toBe('7');
  });

  it('replaceSettings rolls back _settings on dbReplaceAllSettings failure', async () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: ORIGINAL_SETTINGS,
    });
    vi.mocked(dbReplaceAllSettings).mockRejectedValueOnce(new Error('db error'));

    await expect(replaceSettings({ newKey: 'newValue' })).rejects.toThrow('db error');

    expect(getSettings()).toEqual(ORIGINAL_SETTINGS);
  });

  it('successful write does NOT roll back', async () => {
    hydrateConfigFromCache({
      accounts: ORIGINAL_ACCOUNTS,
      holdings: [],
      settings: {},
    });
    vi.mocked(dbSaveAccounts).mockResolvedValueOnce(undefined);

    const updated = [{ ...ORIGINAL_ACCOUNTS[0], label: 'Updated' }];
    await setAccounts(updated);

    expect(getAccounts()[0].label).toBe('Updated');
  });
});
