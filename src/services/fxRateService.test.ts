import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────
// Both the fetcher and the cache repository are mocked so tests run
// without a real IndexedDB / sql.js environment.

vi.mock('./frankfurter', () => ({
  fetchRate: vi.fn(),
  FrankfurterOfflineError: class FrankfurterOfflineError extends Error {
    constructor(msg?: string) {
      super(msg ?? 'Network unavailable');
      this.name = 'FrankfurterOfflineError';
    }
  },
  FrankfurterError: class FrankfurterError extends Error {
    constructor(msg?: string) {
      super(msg);
      this.name = 'FrankfurterError';
    }
  },
}));

vi.mock('../db/repositories/fxRates', () => ({
  getRate: vi.fn(),
  upsertRate: vi.fn().mockResolvedValue(undefined),
}));

import { lookupRate, lookupMonthEndRate, lastDayOfMonth } from './fxRateService';
import { fetchRate, FrankfurterOfflineError, FrankfurterError } from './frankfurter';
import { getRate, upsertRate } from '../db/repositories/fxRates';
import type { FxRateRecord } from '../types';

const mockFetchRate = vi.mocked(fetchRate);
const mockGetRate = vi.mocked(getRate);
const mockUpsertRate = vi.mocked(upsertRate);

const CACHED_RECORD: FxRateRecord = {
  base: 'USD',
  target: 'EUR',
  date: '2024-01-15',
  rate: 0.92,
  effectiveDate: '2024-01-15',
  fetchedAt: '2024-01-16T08:00:00.000Z',
};

afterEach(() => {
  vi.clearAllMocks();
});

// ── lastDayOfMonth ─────────────────────────────────────────────────

describe('lastDayOfMonth', () => {
  it('returns last day of January', () => {
    expect(lastDayOfMonth('2024-01')).toBe('2024-01-31');
  });

  it('returns last day of February in a non-leap year', () => {
    expect(lastDayOfMonth('2023-02')).toBe('2023-02-28');
  });

  it('returns last day of February in a leap year', () => {
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29');
  });

  it('returns last day of April (30 days)', () => {
    expect(lastDayOfMonth('2024-04')).toBe('2024-04-30');
  });

  it('returns last day of December', () => {
    expect(lastDayOfMonth('2024-12')).toBe('2024-12-31');
  });

  it('returns null for an invalid format', () => {
    expect(lastDayOfMonth('2024-1')).toBeNull();
    expect(lastDayOfMonth('bad-input')).toBeNull();
    expect(lastDayOfMonth('')).toBeNull();
  });
});

// ── lookupRate ─────────────────────────────────────────────────────

describe('lookupRate', () => {
  it('returns a cached record without fetching', async () => {
    mockGetRate.mockResolvedValue(CACHED_RECORD);

    const result = await lookupRate('USD', 'EUR', '2024-01-15');

    expect(result).toEqual(CACHED_RECORD);
    expect(mockFetchRate).not.toHaveBeenCalled();
  });

  it('fetches and caches on cache miss', async () => {
    mockGetRate.mockResolvedValue(null);
    const fetched: FxRateRecord = { ...CACHED_RECORD, fetchedAt: new Date().toISOString() };
    mockFetchRate.mockResolvedValue(fetched);

    const result = await lookupRate('USD', 'EUR', '2024-01-15');

    expect(mockFetchRate).toHaveBeenCalledWith('USD', 'EUR', '2024-01-15');
    expect(result).toEqual(fetched);
    // upsertRate is called async without await; flush microtasks
    await Promise.resolve();
    expect(mockUpsertRate).toHaveBeenCalledWith(fetched);
  });

  it('returns null (not throws) when provider is offline', async () => {
    mockGetRate.mockResolvedValue(null);
    mockFetchRate.mockRejectedValue(new FrankfurterOfflineError());

    const result = await lookupRate('USD', 'EUR', '2024-01-15');
    expect(result).toBeNull();
  });

  it('returns null (not throws) on provider HTTP error', async () => {
    mockGetRate.mockResolvedValue(null);
    mockFetchRate.mockRejectedValue(new FrankfurterError('HTTP 429'));

    const result = await lookupRate('USD', 'EUR', '2024-01-15');
    expect(result).toBeNull();
  });

  it('returns an identity record immediately when base === target', async () => {
    const result = await lookupRate('EUR', 'EUR', '2024-01-15');
    expect(result).not.toBeNull();
    expect(result!.rate).toBe(1);
    expect(mockGetRate).not.toHaveBeenCalled();
    expect(mockFetchRate).not.toHaveBeenCalled();
  });

  it('re-throws unexpected (non-FrankfurterError) errors', async () => {
    mockGetRate.mockResolvedValue(null);
    mockFetchRate.mockRejectedValue(new Error('Totally unexpected'));

    await expect(lookupRate('USD', 'EUR', '2024-01-15')).rejects.toThrow('Totally unexpected');
  });

  it('continues to fetch even when getRate throws', async () => {
    mockGetRate.mockRejectedValue(new Error('DB unavailable'));
    const fetched: FxRateRecord = { ...CACHED_RECORD };
    mockFetchRate.mockResolvedValue(fetched);

    const result = await lookupRate('USD', 'EUR', '2024-01-15');
    expect(result).toEqual(fetched);
  });
});

// ── lookupMonthEndRate ─────────────────────────────────────────────

describe('lookupMonthEndRate', () => {
  it('resolves to the last day of the month and delegates to lookupRate', async () => {
    mockGetRate.mockResolvedValue(null);
    const fetched: FxRateRecord = {
      ...CACHED_RECORD,
      date: '2024-01-31',
      effectiveDate: '2024-01-31',
    };
    mockFetchRate.mockResolvedValue(fetched);

    const result = await lookupMonthEndRate('USD', 'EUR', '2024-01');

    expect(mockFetchRate).toHaveBeenCalledWith('USD', 'EUR', '2024-01-31');
    expect(result).toEqual(fetched);
  });

  it('returns null for an invalid yearMonth format', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await lookupMonthEndRate('USD', 'EUR', 'bad-month');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(mockFetchRate).not.toHaveBeenCalled();
  });

  it('handles leap-year February correctly', async () => {
    mockGetRate.mockResolvedValue(null);
    const fetched: FxRateRecord = {
      ...CACHED_RECORD,
      date: '2024-02-29',
      effectiveDate: '2024-02-29',
    };
    mockFetchRate.mockResolvedValue(fetched);

    await lookupMonthEndRate('USD', 'EUR', '2024-02');
    expect(mockFetchRate).toHaveBeenCalledWith('USD', 'EUR', '2024-02-29');
  });
});
