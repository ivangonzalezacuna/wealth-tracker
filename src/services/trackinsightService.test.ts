import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HoldingMetadata } from '../types';

vi.mock('../db', () => ({
  getHoldingMetadata: vi.fn(),
  upsertHoldingMetadata: vi.fn().mockResolvedValue(undefined),
  recordTiFetch: vi.fn().mockResolvedValue(undefined),
  recordTiRequest: vi.fn().mockResolvedValue(undefined),
  recordTiCacheHit: vi.fn().mockResolvedValue(undefined),
  recordTiError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./trackinsight', () => ({
  buildFundUrl: vi.fn((isin: string) => `https://ti.test/funds/${isin}.json`),
  fetchEtfInfo: vi.fn(),
  validateTiEtfInfo: vi.fn((value: unknown) => value),
  TiError: class TiError extends Error {},
  TiOfflineError: class TiOfflineError extends Error {},
  TiNotFoundError: class TiNotFoundError extends Error {},
}));

import {
  bulkEnrichHoldings,
  canRefreshMetadata,
  configureTiService,
  lookupHoldingMetadata,
  refreshHoldingMetadata,
} from './trackinsightService';
import { fetchEtfInfo, TiOfflineError } from './trackinsight';
import {
  getHoldingMetadata,
  recordTiCacheHit,
  recordTiError,
  recordTiFetch,
  recordTiRequest,
  upsertHoldingMetadata,
} from '../db';

const cachedRecord: HoldingMetadata = {
  isin: 'IE00B4L5Y983',
  symbol: 'IWDA',
  exchange: 'XETRA',
  fetchedAt: '2026-01-01T00:00:00.000Z',
  lastRefreshedAt: '2026-01-01T00:00:00.000Z',
  provider: 'trackinsight',
};

afterEach(() => {
  vi.clearAllMocks();
  configureTiService({ enabled: false });
});

describe('lookupHoldingMetadata', () => {
  it('returns cached metadata without fetching', async () => {
    configureTiService({ enabled: true });
    vi.mocked(getHoldingMetadata).mockResolvedValue(cachedRecord);

    await expect(lookupHoldingMetadata(cachedRecord.isin)).resolves.toEqual(cachedRecord);
    expect(vi.mocked(fetchEtfInfo)).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(vi.mocked(recordTiCacheHit)).toHaveBeenCalledOnce();
  });

  it('fetches and persists on cache miss', async () => {
    configureTiService({ enabled: true });
    vi.mocked(getHoldingMetadata).mockResolvedValue(null);
    vi.mocked(fetchEtfInfo).mockResolvedValue({
      symbol: undefined,
      exchange: 'LSE',
      domicileCountry: 'IE',
      fundCurrency: 'USD',
      aum: 1000,
      inceptionDate: '2020-01-01',
      holdingsCount: 50,
      sectors: null,
      topHoldings: null,
    });

    const result = await lookupHoldingMetadata(cachedRecord.isin);

    expect(result?.exchange).toBe('LSE');
    expect(result?.provider).toBe('trackinsight');
    await Promise.resolve();
    expect(vi.mocked(upsertHoldingMetadata)).toHaveBeenCalledOnce();
    expect(vi.mocked(recordTiFetch)).toHaveBeenCalledOnce();
    expect(vi.mocked(recordTiRequest)).toHaveBeenCalledOnce();
  });

  it('returns null when disabled', async () => {
    configureTiService({ enabled: false });
    await expect(lookupHoldingMetadata(cachedRecord.isin)).resolves.toBeNull();
  });
});

describe('refreshHoldingMetadata', () => {
  it('returns null and records offline errors', async () => {
    configureTiService({ enabled: true });
    vi.mocked(fetchEtfInfo).mockRejectedValue(new TiOfflineError('offline'));
    await expect(refreshHoldingMetadata(cachedRecord.isin)).resolves.toBeNull();
    await Promise.resolve();
    expect(vi.mocked(recordTiError)).toHaveBeenCalledOnce();
  });

  it('returns null on unexpected errors', async () => {
    configureTiService({ enabled: true });
    vi.mocked(fetchEtfInfo).mockRejectedValue(new Error('boom'));
    await expect(refreshHoldingMetadata(cachedRecord.isin)).resolves.toBeNull();
  });
});

describe('canRefreshMetadata', () => {
  it('returns false when disabled', async () => {
    configureTiService({ enabled: false });
    await expect(canRefreshMetadata(cachedRecord.isin)).resolves.toBe(false);
  });

  it('returns true when no cache exists', async () => {
    configureTiService({ enabled: true });
    vi.mocked(getHoldingMetadata).mockResolvedValue(null);
    await expect(canRefreshMetadata(cachedRecord.isin)).resolves.toBe(true);
  });

  it('returns false when metadata was refreshed less than one hour ago', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
    configureTiService({ enabled: true });
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
    configureTiService({ enabled: true });
    vi.mocked(getHoldingMetadata).mockResolvedValue({
      ...cachedRecord,
      lastRefreshedAt: '2026-08-19T10:30:00.000Z',
    });
    await expect(canRefreshMetadata(cachedRecord.isin)).resolves.toBe(true);
    vi.useRealTimers();
  });
});

describe('bulkEnrichHoldings', () => {
  it('skips already-cached ISINs and reports progress', async () => {
    configureTiService({ enabled: true });
    vi.mocked(getHoldingMetadata).mockResolvedValueOnce(cachedRecord).mockResolvedValueOnce(null);
    vi.mocked(fetchEtfInfo).mockResolvedValue({
      symbol: undefined,
      exchange: 'LSE',
      domicileCountry: 'IE',
      fundCurrency: 'USD',
      aum: null,
      inceptionDate: null,
      holdingsCount: null,
      sectors: null,
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

  it('returns all skipped when disabled', async () => {
    configureTiService({ enabled: false });
    await expect(bulkEnrichHoldings(['A', 'B'])).resolves.toEqual({
      enriched: 0,
      failed: 0,
      skipped: 2,
    });
  });
});
