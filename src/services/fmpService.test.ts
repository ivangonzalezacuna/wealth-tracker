import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HoldingMetadata } from '../types';

vi.mock('../db', () => ({
  getHoldingMetadata: vi.fn(),
  upsertHoldingMetadata: vi.fn().mockResolvedValue(undefined),
  getDailyFetchCount: vi.fn(),
  recordFmpFetch: vi.fn().mockResolvedValue(undefined),
  recordFmpCacheHit: vi.fn().mockResolvedValue(undefined),
  recordFmpError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./fmp', () => ({
  buildSearchUrl: vi.fn(
    (isin: string, apiKey: string) =>
      `https://fmp.test/search?query=${isin}&apikey=${apiKey}&limit=5`,
  ),
  buildEtfInfoUrl: vi.fn(
    (symbol: string, apiKey: string) =>
      `https://fmp.test/etf/info?symbol=${symbol}&apikey=${apiKey}`,
  ),
  redactApiKey: vi.fn((url: string) => url.replace(/apikey=[^&]+/, 'apikey=***')),
  searchByIsin: vi.fn(),
  fetchEtfInfo: vi.fn(),
  validateFmpEtfInfo: vi.fn((value: unknown) => value),
  FmpError: class FmpError extends Error {},
  FmpOfflineError: class FmpOfflineError extends Error {},
  FmpAuthError: class FmpAuthError extends Error {},
}));

import {
  bulkEnrichHoldings,
  canRefreshMetadata,
  configureFmpService,
  lookupHoldingMetadata,
  refreshHoldingMetadata,
} from './fmpService';
import { fetchEtfInfo, FmpAuthError, FmpOfflineError, searchByIsin } from './fmp';
import {
  getDailyFetchCount,
  getHoldingMetadata,
  recordFmpCacheHit,
  recordFmpError,
  recordFmpFetch,
  upsertHoldingMetadata,
} from '../db';

const cachedRecord: HoldingMetadata = {
  isin: 'IE00B4L5Y983',
  symbol: 'IWDA',
  exchange: 'XETRA',
  fetchedAt: '2026-01-01T00:00:00.000Z',
  lastRefreshedAt: '2026-01-01T00:00:00.000Z',
  provider: 'fmp',
};

afterEach(() => {
  vi.clearAllMocks();
  configureFmpService({ enabled: false, apiKey: '' });
});

describe('lookupHoldingMetadata', () => {
  it('returns cached metadata without fetching', async () => {
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getHoldingMetadata).mockResolvedValue(cachedRecord);

    await expect(lookupHoldingMetadata(cachedRecord.isin)).resolves.toEqual(cachedRecord);
    expect(vi.mocked(searchByIsin)).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(vi.mocked(recordFmpCacheHit)).toHaveBeenCalledOnce();
  });

  it('fetches and persists on cache miss', async () => {
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getHoldingMetadata).mockResolvedValue(null);
    vi.mocked(getDailyFetchCount).mockResolvedValue(0);
    vi.mocked(searchByIsin).mockResolvedValue([
      {
        symbol: 'IWDA',
        name: 'World ETF',
        marketCap: 98000000000,
      },
    ]);
    vi.mocked(fetchEtfInfo).mockResolvedValue({
      symbol: 'IWDA',
      exchange: 'LSE',
      domicileCountry: 'IE',
      fundCurrency: 'USD',
      aum: 1000,
      inceptionDate: '2020-01-01',
      holdingsCount: 50,
      sectorsList: null,
      topHoldings: null,
    });

    const result = await lookupHoldingMetadata(cachedRecord.isin);

    expect(result?.symbol).toBe('IWDA');
    expect(result?.exchange).toBe('LSE');
    await Promise.resolve();
    expect(vi.mocked(upsertHoldingMetadata)).toHaveBeenCalledOnce();
    expect(vi.mocked(recordFmpFetch)).toHaveBeenCalledTimes(2);
  });

  it('returns null when disabled', async () => {
    configureFmpService({ enabled: false, apiKey: 'secret' });
    await expect(lookupHoldingMetadata(cachedRecord.isin)).resolves.toBeNull();
  });

  it('returns null when API key is missing', async () => {
    configureFmpService({ enabled: true, apiKey: '' });
    await expect(lookupHoldingMetadata(cachedRecord.isin)).resolves.toBeNull();
  });

  it('returns null when the daily limit is reached', async () => {
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getHoldingMetadata).mockResolvedValue(null);
    vi.mocked(getDailyFetchCount).mockResolvedValue(250);
    await expect(lookupHoldingMetadata(cachedRecord.isin)).resolves.toBeNull();
  });
});

describe('refreshHoldingMetadata', () => {
  it('returns null and records auth errors', async () => {
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getDailyFetchCount).mockResolvedValue(0);
    vi.mocked(searchByIsin).mockRejectedValue(new FmpAuthError(403));

    await expect(refreshHoldingMetadata(cachedRecord.isin)).resolves.toBeNull();
    await Promise.resolve();
    expect(vi.mocked(recordFmpError)).toHaveBeenCalledOnce();
  });

  it('returns null on offline errors', async () => {
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getDailyFetchCount).mockResolvedValue(0);
    vi.mocked(searchByIsin).mockRejectedValue(new FmpOfflineError('offline'));
    await expect(refreshHoldingMetadata(cachedRecord.isin)).resolves.toBeNull();
  });

  it('returns null on unexpected errors', async () => {
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getDailyFetchCount).mockResolvedValue(0);
    vi.mocked(searchByIsin).mockRejectedValue(new Error('boom'));
    await expect(refreshHoldingMetadata(cachedRecord.isin)).resolves.toBeNull();
  });
});

describe('canRefreshMetadata', () => {
  it('returns false when disabled', async () => {
    configureFmpService({ enabled: false, apiKey: 'secret' });
    await expect(canRefreshMetadata(cachedRecord.isin)).resolves.toBe(false);
  });

  it('returns false when the daily limit is reached', async () => {
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getDailyFetchCount).mockResolvedValue(250);
    await expect(canRefreshMetadata(cachedRecord.isin)).resolves.toBe(false);
  });

  it('returns true when no cache exists', async () => {
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getDailyFetchCount).mockResolvedValue(0);
    vi.mocked(getHoldingMetadata).mockResolvedValue(null);
    await expect(canRefreshMetadata(cachedRecord.isin)).resolves.toBe(true);
  });

  it('returns false when metadata was refreshed less than one hour ago', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getDailyFetchCount).mockResolvedValue(0);
    vi.mocked(getHoldingMetadata).mockResolvedValue({
      ...cachedRecord,
      lastRefreshedAt: '2026-08-19T11:30:00.000Z',
    });
    await expect(canRefreshMetadata(cachedRecord.isin)).resolves.toBe(false);
    vi.useRealTimers();
  });

  it('returns true when metadata was refreshed more than one hour ago', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getDailyFetchCount).mockResolvedValue(0);
    vi.mocked(getHoldingMetadata).mockResolvedValue({
      ...cachedRecord,
      lastRefreshedAt: '2026-08-19T10:30:00.000Z',
    });
    await expect(canRefreshMetadata(cachedRecord.isin)).resolves.toBe(true);
    vi.useRealTimers();
  });
});

describe('bulkEnrichHoldings', () => {
  it('stops early when the daily limit is reached', async () => {
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getDailyFetchCount).mockResolvedValue(250);
    const progress = vi.fn();

    await expect(bulkEnrichHoldings(['A', 'B'], progress)).resolves.toEqual({
      enriched: 0,
      failed: 0,
      skipped: 2,
    });
    expect(progress).not.toHaveBeenCalled();
  });

  it('skips already-cached ISINs and reports progress', async () => {
    configureFmpService({ enabled: true, apiKey: 'secret' });
    vi.mocked(getDailyFetchCount).mockResolvedValue(0);
    vi.mocked(getHoldingMetadata).mockResolvedValueOnce(cachedRecord).mockResolvedValueOnce(null);
    vi.mocked(searchByIsin).mockResolvedValue([
      {
        symbol: 'EIMI',
        name: 'EM ETF',
        marketCap: null,
      },
    ]);
    vi.mocked(fetchEtfInfo).mockResolvedValue({
      symbol: 'EIMI',
      exchange: 'LSE',
      domicileCountry: 'IE',
      fundCurrency: 'USD',
      aum: null,
      inceptionDate: null,
      holdingsCount: null,
      sectorsList: null,
      topHoldings: null,
    });
    const progress = vi.fn();

    await expect(
      bulkEnrichHoldings([cachedRecord.isin, 'IE00BKM4GZ66'], progress),
    ).resolves.toEqual({
      enriched: 1,
      failed: 0,
      skipped: 1,
    });
    expect(progress).toHaveBeenCalledWith(1, 2);
    expect(progress).toHaveBeenCalledWith(2, 2);
  });
});
