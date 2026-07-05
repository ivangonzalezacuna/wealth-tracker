import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the sheets API and other deps before importing the module under test
vi.mock('../sheets/api', () => ({
  readRange: vi.fn(async () => []),
  writeRange: vi.fn(async () => {}),
  clearRange: vi.fn(async () => {}),
  appendRows: vi.fn(async () => {}),
  ensureSheets: vi.fn(async () => {}),
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
import { writeRange, readRange, clearRange, ensureSheets } from '../sheets/api';

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
  it('writes a header array of length 10 ending in the three new columns', async () => {
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
    const calls = (writeRange as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const hdr = lastCall[1][0]; // first row is the header
    expect(hdr).toHaveLength(10);
    expect(hdr.slice(-3)).toEqual(['annualReturnPct', 'contribAmount', 'contribInterval']);
  });
});

describe('hydrateConfigFromCache (Phase 41)', () => {
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
        ticker: 'IWDA',
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
  it('fully replaces settings - pre-existing keys not in new object are gone', async () => {
    // Seed with some initial settings
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: { oldKey: 'oldValue', costBasisMethod: 'fifo' },
    });
    expect(getSettings().oldKey).toBe('oldValue');

    // Replace with entirely new settings
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
  // In-memory localStorage stub - config.test.ts runs in the default
  // (node) vitest environment, which has no real localStorage global.
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
    hydrateConfigFromCache({ accounts: [], holdings: [], settings: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queues the id locally (never throws) when the underlying Sheets write fails', async () => {
    (writeRange as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
    const ok = await retireAccountIdsSafely(['acct_x']);
    expect(ok).toBe(false);
    // Still reported as taken immediately via the local queue, even though
    // the Settings-backed store write failed.
    expect(getRetiredAccountIds()).toContain('acct_x');
  });

  it('returns true and persists normally when the write succeeds', async () => {
    const ok = await retireAccountIdsSafely(['acct_y']);
    expect(ok).toBe(true);
    expect(getRetiredAccountIds()).toContain('acct_y');
  });

  it('flushPendingRetiredIds retries a queued id and clears the queue on success', async () => {
    (writeRange as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
    await retireAccountIdsSafely(['acct_z']);
    expect(getRetiredAccountIds()).toContain('acct_z'); // queued, not yet persisted

    // Next attempt succeeds (writeRange mock is back to its default resolved behavior)
    await flushPendingRetiredIds();
    expect(getRetiredAccountIds()).toContain('acct_z'); // now persisted via the real store
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
      ticker: 'IWDA',
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

  it('setAccounts rolls back _accounts on writeRange failure', async () => {
    hydrateConfigFromCache({
      accounts: ORIGINAL_ACCOUNTS,
      holdings: [],
      settings: {},
    });
    (writeRange as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));

    await expect(
      setAccounts([{ ...ORIGINAL_ACCOUNTS[0], id: 'new', label: 'New' }]),
    ).rejects.toThrow('network');

    expect(getAccounts()).toEqual(ORIGINAL_ACCOUNTS);
  });

  it('setHoldings rolls back _holdings on writeRange failure', async () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: ORIGINAL_HOLDINGS,
      settings: {},
    });
    (writeRange as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));

    await expect(setHoldings([{ ...ORIGINAL_HOLDINGS[0], ticker: 'VWCE' }])).rejects.toThrow(
      'network',
    );

    expect(getHoldings()).toEqual(ORIGINAL_HOLDINGS);
  });

  it('setSetting rolls back _settings on writeRange failure', async () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: ORIGINAL_SETTINGS,
    });
    (writeRange as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));

    await expect(setSetting('costBasisMethod', 'avgco')).rejects.toThrow('network');

    expect(getSettings().costBasisMethod).toBe('fifo');
  });

  it('setSettings rolls back _settings on writeRange failure (including deletes)', async () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: { costBasisMethod: 'fifo', annualReturnPct: '7' },
    });

    // Verify initial state
    expect(getSettings().costBasisMethod).toBe('fifo');

    // Make writeRange reject
    (writeRange as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      Promise.reject(new Error('network')),
    );

    let threwError = false;
    try {
      await setSettings({ costBasisMethod: 'avgco', annualReturnPct: null });
    } catch (e: unknown) {
      threwError = true;
      expect((e as Error).message).toBe('network');
    }

    expect(threwError).toBe(true);
    // Both the update and the delete should be rolled back
    expect(getSettings().costBasisMethod).toBe('fifo');
    expect(getSettings().annualReturnPct).toBe('7');
  });

  it('replaceSettings rolls back _settings on writeRange failure', async () => {
    hydrateConfigFromCache({
      accounts: [],
      holdings: [],
      settings: ORIGINAL_SETTINGS,
    });
    (writeRange as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));

    await expect(replaceSettings({ newKey: 'newValue' })).rejects.toThrow('network');

    expect(getSettings()).toEqual(ORIGINAL_SETTINGS);
  });

  it('successful write does NOT roll back', async () => {
    hydrateConfigFromCache({
      accounts: ORIGINAL_ACCOUNTS,
      holdings: [],
      settings: {},
    });
    (writeRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const updated = [{ ...ORIGINAL_ACCOUNTS[0], label: 'Updated' }];
    await setAccounts(updated);

    expect(getAccounts()[0].label).toBe('Updated');
  });
});

describe('setAccounts trailing-row clear (Phase 58)', () => {
  const mkAccount = (id: string) => ({
    id,
    moneyType: 'cash',
    institution: 'N26',
    label: id,
    color: '#000',
    isPrimaryInvestment: false,
    order: 1,
    annualReturnPct: 0,
    contribAmount: 0,
    contribInterval: 'monthly' as const,
  });

  beforeEach(() => {
    vi.mocked(writeRange).mockReset().mockResolvedValue(undefined);
    vi.mocked(readRange).mockReset().mockResolvedValue([]);
    vi.mocked(clearRange).mockReset().mockResolvedValue(undefined);
    hydrateConfigFromCache({ accounts: [], holdings: [], settings: {} });
  });

  it('calls clearRange when the sheet had more rows than the new list', async () => {
    // Sheet previously had 6 rows (1 header + 5 data rows)
    vi.mocked(readRange).mockResolvedValueOnce([['a1'], ['a2'], ['a3'], ['a4'], ['a5'], ['hdr']]);
    const accounts = [mkAccount('a1'), mkAccount('a2')]; // 3 rows total (hdr + 2)
    await setAccounts(accounts);

    expect(clearRange).toHaveBeenCalledTimes(1);
    // values.length = 3, existingHeight = 6 -> clear A4:J6
    expect(clearRange).toHaveBeenCalledWith('Accounts!A4:J6');
  });

  it('does NOT call clearRange when the sheet had fewer or equal rows', async () => {
    // Sheet had 2 rows, writing 3 (add case)
    vi.mocked(readRange).mockResolvedValueOnce([['hdr'], ['a1']]);
    await setAccounts([mkAccount('a1'), mkAccount('a2')]);

    expect(clearRange).not.toHaveBeenCalled();
  });

  it('treats readRange error as existingHeight=0 - no clearRange, no propagated error', async () => {
    vi.mocked(readRange).mockRejectedValueOnce(new Error('empty sheet'));
    await setAccounts([mkAccount('a1')]);

    expect(clearRange).not.toHaveBeenCalled();
    // Should not throw - the account was saved
    expect(getAccounts()).toHaveLength(1);
  });
});

describe('setHoldings trailing-row clear (Phase 58)', () => {
  const mkHolding = (isin: string) => ({
    isin,
    ticker: isin.slice(0, 4),
    name: isin,
    color: '#000',
    acc: true,
    active: true,
    contribAmount: 100,
    contribInterval: 'weekly' as const,
    assetClass: 'equity',
    region: 'developed',
    foldInto: '',
    order: 1,
  });

  beforeEach(() => {
    vi.mocked(writeRange).mockReset().mockResolvedValue(undefined);
    vi.mocked(readRange).mockReset().mockResolvedValue([]);
    vi.mocked(clearRange).mockReset().mockResolvedValue(undefined);
    hydrateConfigFromCache({ accounts: [], holdings: [], settings: {} });
  });

  it('calls clearRange when the sheet had more rows than the new list', async () => {
    // Sheet previously had 5 rows (1 hdr + 4 data)
    vi.mocked(readRange).mockResolvedValueOnce([['h'], ['h'], ['h'], ['h'], ['h']]);
    const holdings = [mkHolding('IE001'), mkHolding('IE002')]; // 3 rows total
    await setHoldings(holdings);

    expect(clearRange).toHaveBeenCalledTimes(1);
    // values.length = 3, existingHeight = 5 -> clear A4:L5
    expect(clearRange).toHaveBeenCalledWith('Holdings!A4:L5');
  });

  it('does NOT call clearRange when the sheet had fewer or equal rows', async () => {
    vi.mocked(readRange).mockResolvedValueOnce([['hdr'], ['h1']]);
    await setHoldings([mkHolding('IE001'), mkHolding('IE002')]);

    expect(clearRange).not.toHaveBeenCalled();
  });

  it('treats readRange error as existingHeight=0 - no clearRange, no propagated error', async () => {
    vi.mocked(readRange).mockRejectedValueOnce(new Error('empty'));
    await setHoldings([mkHolding('IE001')]);

    expect(clearRange).not.toHaveBeenCalled();
    expect(getHoldings()).toHaveLength(1);
  });
});
