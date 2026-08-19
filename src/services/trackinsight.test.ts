import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildFundUrl,
  fetchEtfInfo,
  TI_BASE_URL,
  TiError,
  TiNotFoundError,
  TiOfflineError,
  validateTiEtfInfo,
} from './trackinsight';

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildFundUrl', () => {
  it('builds the Yahoo Finance quoteSummary URL from symbol', () => {
    expect(buildFundUrl('IWDA')).toBe(
      `${TI_BASE_URL}/IWDA?modules=summaryDetail%2CfundProfile%2CtopHoldings`,
    );
  });

  it('URL-encodes the ticker and uppercases it', () => {
    expect(buildFundUrl('qqq', 'https://example.com/v10/finance/quoteSummary')).toBe(
      'https://example.com/v10/finance/quoteSummary/QQQ?modules=summaryDetail%2CfundProfile%2CtopHoldings',
    );
  });
});

const yahooSuccessResponse = {
  quoteSummary: {
    result: [
      {
        summaryDetail: {
          currency: { raw: 'USD' },
          totalAssets: { raw: 300_500_000_000 },
        },
        fundProfile: {
          domicile: 'IE',
        },
        topHoldings: {
          holdings: [
            { holdingName: 'Apple Inc', holdingPercent: { raw: 0.0752 } },
            { holdingName: 'Microsoft Corp', holdingPercent: { raw: 0.07 } },
          ],
          sectorWeightings: [{ Technology: { raw: 0.281 } }, { Healthcare: { raw: 0.122 } }],
        },
      },
    ],
    error: null,
  },
};

describe('fetchEtfInfo', () => {
  it('returns validated ETF info on success', async () => {
    mockFetch(yahooSuccessResponse);

    await expect(fetchEtfInfo('IWDA')).resolves.toMatchObject({
      symbol: 'IWDA',
      fundCurrency: 'USD',
      domicileCountry: 'IE',
      aum: 300_500_000_000,
      holdingsCount: 2,
      topHoldings: expect.arrayContaining([{ asset: 'Apple Inc', weightPercentage: '7.52%' }]),
    });
  });

  it('throws TiError when symbol is missing', async () => {
    await expect(fetchEtfInfo('')).rejects.toThrow(TiError);
  });

  it('throws TiNotFoundError on error response', async () => {
    mockFetch({
      quoteSummary: {
        result: null,
        error: {
          code: 'Not Found',
          description: 'No fundamentals data found for any of the summaryTypes',
        },
      },
    });
    await expect(fetchEtfInfo('UNKNOWN')).rejects.toThrow(TiNotFoundError);
  });

  it('throws TiError on non-404 HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Server Error', { status: 500 }));
    await expect(fetchEtfInfo('IWDA')).rejects.toThrow(TiError);
  });

  it('throws TiOfflineError on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchEtfInfo('IWDA')).rejects.toThrow(TiOfflineError);
  });

  it('throws TiError on malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(fetchEtfInfo('IWDA')).rejects.toThrow(TiError);
  });
});

describe('validateTiEtfInfo', () => {
  it('maps Yahoo Finance quoteSummary fields correctly', () => {
    const result = validateTiEtfInfo(yahooSuccessResponse, 'IWDA');
    expect(result).toMatchObject({
      symbol: 'IWDA',
      fundCurrency: 'USD',
      domicileCountry: 'IE',
      aum: 300_500_000_000,
      holdingsCount: 2,
      topHoldings: expect.arrayContaining([{ asset: 'Apple Inc', weightPercentage: '7.52%' }]),
      sectors: expect.arrayContaining([expect.objectContaining({ industry: 'Technology' })]),
    });
  });

  it('handles missing and null fields gracefully', () => {
    const result = validateTiEtfInfo(
      {
        quoteSummary: {
          result: [{ summaryDetail: {}, fundProfile: {}, topHoldings: {} }],
          error: null,
        },
      },
      'TEST',
    );
    expect(result.symbol).toBe('TEST');
    expect(result.fundCurrency).toBeUndefined();
    expect(result.aum).toBeNull();
    expect(result.domicileCountry).toBeUndefined();
    expect(result.sectors).toBeNull();
    expect(result.topHoldings).toBeNull();
  });

  it('returns an empty object for invalid raw values', () => {
    expect(validateTiEtfInfo(null)).toEqual({});
    expect(validateTiEtfInfo(undefined)).toEqual({});
    expect(validateTiEtfInfo('string')).toEqual({});
  });

  it('parses sector weightings from sectorWeightings array', () => {
    const result = validateTiEtfInfo(
      {
        quoteSummary: {
          result: [
            {
              summaryDetail: {},
              fundProfile: {},
              topHoldings: {
                holdings: [],
                sectorWeightings: [{ Technology: { raw: 0.3 } }, { Healthcare: { raw: 0.15 } }],
              },
            },
          ],
          error: null,
        },
      },
      'TEST',
    );
    expect(result.sectors).toEqual([
      { industry: 'Technology', exposure: '30.0%' },
      { industry: 'Healthcare', exposure: '15.0%' },
    ]);
  });
});
