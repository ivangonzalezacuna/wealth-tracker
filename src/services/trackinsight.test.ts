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
  it('builds the fund URL from an ISIN', () => {
    expect(buildFundUrl('IE00B4L5Y983')).toBe(`${TI_BASE_URL}/funds/IE00B4L5Y983.json`);
  });

  it('URL-encodes the ISIN', () => {
    expect(buildFundUrl('IE00B4L5Y983', 'https://example.com')).toBe(
      'https://example.com/funds/IE00B4L5Y983.json',
    );
  });
});

describe('fetchEtfInfo', () => {
  it('returns validated ETF info on success (root-level fields)', async () => {
    mockFetch({
      currency: 'USD',
      domicile: 'IE',
      total_assets: 79000000000,
      inception_date: '2009-09-25',
      total_holdings: 1500,
      main_exchange: 'XETRA',
      weight_distribution: [{ name: 'Technology', weight: 22.5 }],
      top_holdings: [{ name: 'Microsoft', weight: 4.1 }],
    });

    await expect(fetchEtfInfo('IE00B4L5Y983')).resolves.toMatchObject({
      fundCurrency: 'USD',
      domicileCountry: 'IE',
      aum: 79000000000,
      inceptionDate: '2009-09-25',
      holdingsCount: 1500,
      exchange: 'XETRA',
      sectors: [{ industry: 'Technology', exposure: '22.5' }],
      topHoldings: [{ asset: 'Microsoft', weightPercentage: '4.1' }],
    });
  });

  it('unwraps a fund wrapper object', async () => {
    mockFetch({
      fund: {
        currency: 'EUR',
        domicile: 'LU',
        total_assets: 5000000000,
        inception_date: '2015-03-10',
        total_holdings: 400,
        main_exchange: 'EURONEXT',
      },
    });

    await expect(fetchEtfInfo('LU0290358497')).resolves.toMatchObject({
      fundCurrency: 'EUR',
      domicileCountry: 'LU',
      aum: 5000000000,
      exchange: 'EURONEXT',
    });
  });

  it('throws TiNotFoundError on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    await expect(fetchEtfInfo('UNKNOWN')).rejects.toThrow(TiNotFoundError);
  });

  it('throws TiError on non-404 HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Server Error', { status: 500 }));
    await expect(fetchEtfInfo('IE00B4L5Y983')).rejects.toThrow(TiError);
  });

  it('throws TiOfflineError on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchEtfInfo('IE00B4L5Y983')).rejects.toThrow(TiOfflineError);
  });

  it('throws TiError on malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(fetchEtfInfo('IE00B4L5Y983')).rejects.toThrow(TiError);
  });
});

describe('validateTiEtfInfo', () => {
  it('maps root-level fields correctly', () => {
    const result = validateTiEtfInfo({
      currency: 'USD',
      domicile: 'IE',
      total_assets: 1000,
      inception_date: '2020-01-01',
      total_holdings: 50,
      main_exchange: 'LSE',
      weight_distribution: [{ name: 'Financials', weight: 10 }],
      top_holdings: [{ name: 'Apple', weight: 5 }],
    });
    expect(result).toEqual({
      symbol: undefined,
      exchange: 'LSE',
      domicileCountry: 'IE',
      fundCurrency: 'USD',
      aum: 1000,
      inceptionDate: '2020-01-01',
      holdingsCount: 50,
      sectors: [{ industry: 'Financials', exposure: '10' }],
      topHoldings: [{ asset: 'Apple', weightPercentage: '5' }],
    });
  });

  it('falls back to alternative field names', () => {
    const result = validateTiEtfInfo({
      fund_currency: 'CHF',
      domicile_country: 'CH',
      aum: 500,
      nb_holdings: 300,
      exchange: 'SIX',
    });
    expect(result.fundCurrency).toBe('CHF');
    expect(result.domicileCountry).toBe('CH');
    expect(result.aum).toBe(500);
    expect(result.holdingsCount).toBe(300);
    expect(result.exchange).toBe('SIX');
  });

  it('handles missing and null fields gracefully', () => {
    const result = validateTiEtfInfo({ currency: 'USD', total_assets: null });
    expect(result.fundCurrency).toBe('USD');
    expect(result.aum).toBeNull();
    expect(result.exchange).toBeUndefined();
    expect(result.sectors).toBeNull();
    expect(result.topHoldings).toBeNull();
  });

  it('returns an empty object for invalid raw values', () => {
    expect(validateTiEtfInfo(null)).toEqual({});
    expect(validateTiEtfInfo(undefined)).toEqual({});
    expect(validateTiEtfInfo('string')).toEqual({});
  });

  it('handles null inception_date', () => {
    const result = validateTiEtfInfo({ inception_date: null });
    expect(result.inceptionDate).toBeNull();
  });

  it('filters out empty sector and holding entries', () => {
    const result = validateTiEtfInfo({
      weight_distribution: [
        { name: '', weight: 0 },
        { name: 'Tech', weight: 30 },
      ],
      top_holdings: [
        { name: '', weight: '' },
        { name: 'Microsoft', weight: 5 },
      ],
    });
    expect(result.sectors).toEqual([{ industry: 'Tech', exposure: '30' }]);
    expect(result.topHoldings).toEqual([{ asset: 'Microsoft', weightPercentage: '5' }]);
  });
});
