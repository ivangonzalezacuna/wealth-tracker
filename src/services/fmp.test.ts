import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildEtfInfoUrl,
  buildSearchUrl,
  fetchEtfInfo,
  FMP_BASE_URL,
  FmpAuthError,
  FmpError,
  FmpOfflineError,
  redactApiKey,
  searchByIsin,
  validateFmpEtfInfo,
} from './fmp';

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

describe('searchByIsin', () => {
  it('returns search results on success', async () => {
    mockFetch([
      {
        symbol: 'IWDA',
        name: 'iShares Core MSCI World',
        currency: 'USD',
        stockExchange: 'XETRA',
        exchangeShortName: 'XETRA',
      },
    ]);

    await expect(searchByIsin('IE00B4L5Y983', 'secret')).resolves.toEqual([
      {
        symbol: 'IWDA',
        name: 'iShares Core MSCI World',
        currency: 'USD',
        stockExchange: 'XETRA',
        exchangeShortName: 'XETRA',
      },
    ]);
  });

  it('returns an empty array on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not found', { status: 404 }));
    await expect(searchByIsin('IE00B4L5Y983', 'secret')).resolves.toEqual([]);
  });

  it('throws FmpAuthError on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Denied', { status: 401 }));
    await expect(searchByIsin('IE00B4L5Y983', 'secret')).rejects.toThrow(FmpAuthError);
  });

  it('throws FmpOfflineError on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(searchByIsin('IE00B4L5Y983', 'secret')).rejects.toThrow(FmpOfflineError);
  });

  it('throws FmpError on malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(searchByIsin('IE00B4L5Y983', 'secret')).rejects.toThrow(FmpError);
  });
});

describe('fetchEtfInfo', () => {
  it('returns validated ETF info on success', async () => {
    mockFetch([
      {
        symbol: 'IWDA',
        exchange: 'XETRA',
        domicileCountry: 'IE',
        fundCurrency: 'USD',
        aum: 1230000000,
        inceptionDate: '2009-09-25',
        holdingsCount: 1500,
        sectorsList: [{ industry: 'Technology', exposure: '20.5' }],
        topHoldings: [{ asset: 'Microsoft', weightPercentage: '4.1' }],
      },
    ]);

    await expect(fetchEtfInfo('IWDA', 'secret')).resolves.toEqual({
      symbol: 'IWDA',
      exchange: 'XETRA',
      domicileCountry: 'IE',
      fundCurrency: 'USD',
      aum: 1230000000,
      inceptionDate: '2009-09-25',
      holdingsCount: 1500,
      sectorsList: [{ industry: 'Technology', exposure: '20.5' }],
      topHoldings: [{ asset: 'Microsoft', weightPercentage: '4.1' }],
    });
  });

  it('throws FmpError on empty array response', async () => {
    mockFetch([]);
    await expect(fetchEtfInfo('IWDA', 'secret')).rejects.toThrow(FmpError);
  });

  it('throws FmpAuthError on 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Denied', { status: 403 }));
    await expect(fetchEtfInfo('IWDA', 'secret')).rejects.toThrow(FmpAuthError);
  });
});

describe('URL builders', () => {
  it('builds the search URL with query and apikey', () => {
    expect(buildSearchUrl('IE00B4L5Y983', 'secret')).toBe(
      `${FMP_BASE_URL}/v3/search?query=IE00B4L5Y983&apikey=secret&limit=5`,
    );
  });

  it('builds the ETF info URL with symbol and apikey', () => {
    expect(buildEtfInfoUrl('IWDA', 'secret')).toBe(
      `${FMP_BASE_URL}/v3/etf/info?symbol=IWDA&apikey=secret`,
    );
  });

  it('redacts the apikey in logged URLs', () => {
    expect(redactApiKey(buildSearchUrl('IE00B4L5Y983', 'secret'))).toBe(
      `${FMP_BASE_URL}/v3/search?query=IE00B4L5Y983&apikey=***&limit=5`,
    );
  });
});

describe('validateFmpEtfInfo', () => {
  it('handles missing and null fields gracefully', () => {
    expect(validateFmpEtfInfo({ symbol: 'IWDA', aum: null, topHoldings: null })).toEqual({
      symbol: 'IWDA',
      exchange: undefined,
      domicileCountry: undefined,
      fundCurrency: undefined,
      aum: null,
      inceptionDate: null,
      holdingsCount: null,
      sectorsList: null,
      topHoldings: null,
    });
  });

  it('returns an empty object for invalid raw values', () => {
    expect(validateFmpEtfInfo(null)).toEqual({});
  });
});
