import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeForSheets,
  sanitizeRows,
  writeRange,
  appendRows,
  ensureSheets,
  resetConfirmedTabsCache,
} from './api';

// Mock auth module
vi.mock('../auth/google', () => ({
  getToken: vi.fn().mockResolvedValue('fake-token'),
}));

// Provide VITE_GOOGLE_SHEET_ID for import.meta.env
vi.stubEnv('VITE_GOOGLE_SHEET_ID', 'test-sheet-id');

describe('sanitizeForSheets', () => {
  it('escapes string starting with =', () => {
    expect(sanitizeForSheets('=1+1')).toBe("'=1+1");
  });

  it('escapes string starting with +', () => {
    expect(sanitizeForSheets('+cmd')).toBe("'+cmd");
  });

  it('escapes string starting with -', () => {
    expect(sanitizeForSheets('-5% correction')).toBe("'-5% correction");
  });

  it('escapes string starting with @', () => {
    expect(sanitizeForSheets('@mention')).toBe("'@mention");
  });

  it('leaves normal strings unchanged', () => {
    expect(sanitizeForSheets('iShares Core MSCI World UCITS ETF USD (Acc)')).toBe(
      'iShares Core MSCI World UCITS ETF USD (Acc)',
    );
  });

  it('leaves negative numbers (typeof number) unchanged', () => {
    const result = sanitizeForSheets(-42.5);
    expect(result).toBe(-42.5);
    expect(typeof result).toBe('number');
  });

  it('leaves booleans unchanged', () => {
    expect(sanitizeForSheets(true)).toBe(true);
  });

  it('leaves empty string unchanged', () => {
    expect(sanitizeForSheets('')).toBe('');
  });
});

describe('sanitizeRows', () => {
  it('sanitizes only string cells in a 2D array', () => {
    const input: (string | number | boolean)[][] = [
      ['=SUM(A1)', -5, 'normal', true],
      ['+attack', 42, '@user', false],
    ];
    const result = sanitizeRows(input);
    expect(result).toEqual([
      ["'=SUM(A1)", -5, 'normal', true],
      ["'+attack", 42, "'@user", false],
    ]);
  });

  it('returns a new array (pure, no mutation)', () => {
    const input: (string | number | boolean)[][] = [['=foo']];
    const result = sanitizeRows(input);
    expect(result).not.toBe(input);
    expect(input[0][0]).toBe('=foo');
  });
});

describe('writeRange integration', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sanitizes string cells in the JSON body', async () => {
    await writeRange('Sheet1!A1', [['=SUM(A1:A9)', -5, 'normal']]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.values).toEqual([["'=SUM(A1:A9)", -5, 'normal']]);
  });
});

describe('appendRows integration', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sanitizes string cells in the JSON body', async () => {
    await appendRows('Sheet1!A1', [['+cmd', 100, '@test']]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.values).toEqual([["'+cmd", 100, "'@test"]]);
  });
});

describe('ensureSheets - confirmed tabs cache', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function metadataResponse(tabNames: string[]) {
    return {
      ok: true,
      json: () =>
        Promise.resolve({
          sheets: tabNames.map((title) => ({ properties: { title } })),
        }),
    };
  }

  function batchUpdateOk() {
    return { ok: true, json: () => Promise.resolve({}) };
  }

  beforeEach(() => {
    resetConfirmedTabsCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('first call fetches metadata; second call for same tab skips fetch', async () => {
    fetchMock.mockResolvedValue(metadataResponse(['Accounts', 'Holdings']));

    await ensureSheets(['Accounts']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstUrl).toContain('sheets.googleapis.com/v4/spreadsheets/');

    // Second call for the same tab - no fetch
    await ensureSheets(['Accounts']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches all tabs from metadata response, not just requested ones', async () => {
    fetchMock.mockResolvedValue(metadataResponse(['Accounts', 'Holdings', 'Settings']));

    // Only ask about Accounts, but the response contains Holdings and Settings too
    await ensureSheets(['Accounts']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Holdings was in the metadata response, so no additional fetch needed
    await ensureSheets(['Holdings']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same for Settings
    await ensureSheets(['Settings']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('only fetches metadata once when some tabs already confirmed', async () => {
    fetchMock.mockResolvedValue(metadataResponse(['Accounts', 'Holdings']));

    // First call confirms Accounts
    await ensureSheets(['Accounts']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call asks for Accounts (cached) + ConfigHistory (not cached)
    // Only one metadata fetch should fire (for the uncached tab)
    fetchMock.mockResolvedValue(metadataResponse(['Accounts', 'Holdings', 'ConfigHistory']));
    await ensureSheets(['Accounts', 'ConfigHistory']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches newly created tabs after batchUpdate', async () => {
    // Metadata does not include NewTab
    fetchMock.mockResolvedValueOnce(metadataResponse(['Accounts']));
    // batchUpdate succeeds
    fetchMock.mockResolvedValueOnce(batchUpdateOk());

    await ensureSheets(['NewTab']);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Verify batchUpdate was called
    const batchCall = fetchMock.mock.calls[1];
    expect(batchCall[0]).toContain(':batchUpdate');
    const body = JSON.parse(batchCall[1].body);
    expect(body.requests[0].addSheet.properties.title).toBe('NewTab');

    // Subsequent call for NewTab should not re-fetch
    await ensureSheets(['NewTab']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not poison cache on failed metadata fetch; retries on next call', async () => {
    // First call: metadata fetch fails (simulating 429)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });

    await expect(ensureSheets(['Accounts'])).rejects.toThrow(
      'Cannot read spreadsheet metadata: 429',
    );

    // Cache should not contain Accounts - next call should retry
    fetchMock.mockResolvedValueOnce(metadataResponse(['Accounts']));
    await ensureSheets(['Accounts']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
