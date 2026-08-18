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

vi.mock('../db/repositories/fxTelemetry', () => ({
  recordFxFetch: vi.fn().mockResolvedValue(undefined),
  recordFxError: vi.fn().mockResolvedValue(undefined),
  recordFxCacheHit: vi.fn().mockResolvedValue(undefined),
  recordFxPrefetch: vi.fn().mockResolvedValue(undefined),
}));

import {
  lookupRate,
  lookupMonthEndRate,
  lastDayOfMonth,
  configureFxService,
  prefetchMonthEndRates,
} from './fxRateService';
import { fetchRate, FrankfurterOfflineError, FrankfurterError } from './frankfurter';
import { getRate, upsertRate } from '../db/repositories/fxRates';
import {
  recordFxFetch,
  recordFxError,
  recordFxCacheHit,
  recordFxPrefetch,
} from '../db/repositories/fxTelemetry';
import type { FxRateRecord } from '../types';

const mockFetchRate = vi.mocked(fetchRate);
const mockGetRate = vi.mocked(getRate);
const mockUpsertRate = vi.mocked(upsertRate);
const mockRecordFxFetch = vi.mocked(recordFxFetch);
const mockRecordFxError = vi.mocked(recordFxError);
const mockRecordFxCacheHit = vi.mocked(recordFxCacheHit);
const mockRecordFxPrefetch = vi.mocked(recordFxPrefetch);

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
  // Always re-enable the integration after each test so disabled-state tests
  // don't leak into subsequent ones.
  configureFxService({ enabled: true });
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

// ── configureFxService ─────────────────────────────────────────────

describe('configureFxService', () => {
  it('returns null for all pairs when disabled', async () => {
    configureFxService({ enabled: false });

    const result = await lookupRate('USD', 'EUR', '2024-01-15');
    expect(result).toBeNull();
    expect(mockGetRate).not.toHaveBeenCalled();
    expect(mockFetchRate).not.toHaveBeenCalled();
  });

  it('returns null for identity pair (base === target) when disabled', async () => {
    configureFxService({ enabled: false });

    const result = await lookupRate('EUR', 'EUR', '2024-01-15');
    expect(result).toBeNull();
  });

  it('resumes normal operation when re-enabled', async () => {
    configureFxService({ enabled: false });
    configureFxService({ enabled: true });

    mockGetRate.mockResolvedValue(CACHED_RECORD);
    const result = await lookupRate('USD', 'EUR', '2024-01-15');
    expect(result).toEqual(CACHED_RECORD);
  });
});

// ── telemetry recording ────────────────────────────────────────────

describe('telemetry recording', () => {
  it('records a cache hit when the rate is served from cache', async () => {
    mockGetRate.mockResolvedValue(CACHED_RECORD);

    await lookupRate('USD', 'EUR', '2024-01-15');

    await Promise.resolve(); // flush microtasks
    expect(mockRecordFxCacheHit).toHaveBeenCalledOnce();
    expect(mockRecordFxFetch).not.toHaveBeenCalled();
    expect(mockRecordFxError).not.toHaveBeenCalled();
  });

  it('records a fetch when the rate is fetched live', async () => {
    mockGetRate.mockResolvedValue(null);
    const fetched: FxRateRecord = { ...CACHED_RECORD, fetchedAt: new Date().toISOString() };
    mockFetchRate.mockResolvedValue(fetched);

    await lookupRate('USD', 'EUR', '2024-01-15');

    await Promise.resolve(); // flush microtasks
    expect(mockRecordFxFetch).toHaveBeenCalledOnce();
    expect(mockRecordFxCacheHit).not.toHaveBeenCalled();
    expect(mockRecordFxError).not.toHaveBeenCalled();
  });

  it('records an error on provider failure', async () => {
    mockGetRate.mockResolvedValue(null);
    mockFetchRate.mockRejectedValue(new FrankfurterOfflineError('Network down'));

    await lookupRate('USD', 'EUR', '2024-01-15');

    expect(mockRecordFxError).toHaveBeenCalledOnce();
    expect(mockRecordFxFetch).not.toHaveBeenCalled();
    expect(mockRecordFxCacheHit).not.toHaveBeenCalled();
  });

  it('does not record telemetry for identity (base === target) lookups', async () => {
    await lookupRate('EUR', 'EUR', '2024-01-15');

    await Promise.resolve();
    expect(mockRecordFxCacheHit).not.toHaveBeenCalled();
    expect(mockRecordFxFetch).not.toHaveBeenCalled();
    expect(mockRecordFxError).not.toHaveBeenCalled();
  });
});

describe('prefetchMonthEndRates', () => {
  it('skips when no non-target currencies are provided', async () => {
    const result = await prefetchMonthEndRates(['EUR', 'eur'], 'EUR', '2024-01');
    expect(result).toEqual({
      needed: false,
      disabled: false,
      attempted: 0,
      resolved: 0,
      failed: 0,
    });
    expect(mockRecordFxPrefetch).not.toHaveBeenCalled();
  });

  it('returns disabled when integration is off', async () => {
    configureFxService({ enabled: false });
    const result = await prefetchMonthEndRates(['USD'], 'EUR', '2024-01');
    expect(result).toEqual({
      needed: true,
      disabled: true,
      attempted: 0,
      resolved: 0,
      failed: 0,
    });
    expect(mockFetchRate).not.toHaveBeenCalled();
    expect(mockRecordFxPrefetch).not.toHaveBeenCalled();
  });

  it('records attempt/success/failure counters', async () => {
    mockGetRate.mockResolvedValue(null);
    mockFetchRate
      .mockResolvedValueOnce({ ...CACHED_RECORD, date: '2024-01-31', effectiveDate: '2024-01-31' })
      .mockRejectedValueOnce(new FrankfurterOfflineError('offline'));
    const result = await prefetchMonthEndRates(['USD', 'DKK'], 'EUR', '2024-01');
    expect(result).toEqual({
      needed: true,
      disabled: false,
      attempted: 2,
      resolved: 1,
      failed: 1,
    });
    await Promise.resolve();
    expect(mockRecordFxPrefetch).toHaveBeenCalledWith(2, 1, 1);
  });
});
