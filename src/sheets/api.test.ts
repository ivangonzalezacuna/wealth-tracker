import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeForSheets, sanitizeRows, writeRange, appendRows } from './api';

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
